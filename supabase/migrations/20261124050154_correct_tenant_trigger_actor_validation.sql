create or replace function public.enforce_tenant_row_isolation()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_row jsonb;
  v_old jsonb;
  v_key text;
  v_actor_text text;
  v_actor_id uuid;
  v_actor_tenant uuid;
  v_actor_is_platform_owner boolean := false;
  v_actor_is_member boolean := false;
  v_parent record;
  v_parent_tenant uuid;
  v_entity_table text;
  v_membership_count integer;
  v_membership_tenant uuid;
begin
  v_row := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id is immutable';
    end if;
  end if;

  if new.tenant_id is not null then v_actor_tenant := new.tenant_id; end if;

  for v_parent in
    select parent_ns.nspname as parent_schema, parent_table.relname as parent_table,
      parent_column.attname as parent_column, child_column.attname as child_column
    from pg_constraint fk
    join pg_class child_table on child_table.oid = fk.conrelid
    join pg_class parent_table on parent_table.oid = fk.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent_table.relnamespace
    join pg_attribute child_column on child_column.attrelid = fk.conrelid and child_column.attnum = fk.conkey[1]
    join pg_attribute parent_column on parent_column.attrelid = fk.confrelid and parent_column.attnum = fk.confkey[1]
    where fk.contype = 'f' and fk.conrelid = tg_relid
      and array_length(fk.conkey,1) = 1 and array_length(fk.confkey,1) = 1
      and parent_ns.nspname = 'public'
      and exists (select 1 from information_schema.columns c
        where c.table_schema = parent_ns.nspname and c.table_name = parent_table.relname and c.column_name = 'tenant_id')
  loop
    v_actor_text := v_row ->> v_parent.child_column;
    if v_actor_text is not null then
      execute format('select tenant_id from %I.%I where %I::text = $1 limit 1',
        v_parent.parent_schema, v_parent.parent_table, v_parent.parent_column)
        into v_parent_tenant using v_actor_text;
      if v_parent_tenant is not null then
        if v_actor_tenant is null then v_actor_tenant := v_parent_tenant;
        elsif v_actor_tenant <> v_parent_tenant then
          raise exception 'Cross-tenant relationship rejected for %.%', tg_table_schema, tg_table_name;
        end if;
      end if;
    end if;
  end loop;

  if v_actor_tenant is null and tg_table_schema = 'public' and tg_table_name = 'audit_logs' then
    v_entity_table := case new.entity_type
      when 'customer' then 'customers'
      when 'expense' then 'expenses'
      when 'expense_document' then 'expense_documents'
      when 'expense_payment_document' then 'expense_payment_documents'
      when 'fund_request' then 'fund_requests'
      when 'fund_request_document' then 'fund_request_documents'
      when 'inventory_lot' then 'inventory_lots'
      when 'project' then 'projects'
      when 'purchase_category' then 'purchase_categories'
      when 'purchase_payment_document' then 'purchase_payment_documents'
      when 'purchase_payment_request' then 'purchase_payment_requests'
      when 'purchase_receipt' then 'purchase_receipts'
      when 'purchase_receipt_document' then 'purchase_receipt_documents'
      when 'purchase_request' then 'purchase_requests'
      when 'sales_expense_closing' then 'sales_expense_period_closings'
      when 'sales_expense_master' then 'sales_expense_masters'
      when 'sales_order' then 'sales_orders'
      when 'sales_order_settlement' then 'sales_order_settlements'
      when 'supplier' then 'suppliers'
      when 'warehouse' then 'warehouses'
      else null end;
    if v_entity_table is not null and new.entity_id is not null then
      execute format('select tenant_id from public.%I where id::text = $1 limit 1', v_entity_table)
        into v_actor_tenant using new.entity_id;
    end if;
  end if;

  if tg_op = 'INSERT' then
    foreach v_key in array array['created_by','actor_user_id','updated_by','requested_by','uploaded_by',
      'completed_by','paid_by','executed_by','cancelled_by','submitted_by','received_by','closed_by',
      'finalized_by','dispatched_by','posted_by'] loop
      v_actor_text := v_row ->> v_key;
      if v_actor_text is not null and v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_actor_id := v_actor_text::uuid; exit;
      end if;
    end loop;
  else
    foreach v_key in array array['updated_by','actor_user_id','requested_by','uploaded_by','completed_by',
      'paid_by','executed_by','cancelled_by','submitted_by','received_by','closed_by','finalized_by',
      'dispatched_by','posted_by'] loop
      v_actor_text := v_row ->> v_key;
      if v_actor_text is distinct from (v_old ->> v_key) and v_actor_text is not null
        and v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_actor_id := v_actor_text::uuid; exit;
      end if;
    end loop;
  end if;

  if v_actor_id is not null then
    select exists(select 1 from public.platform_owners po where po.user_id = v_actor_id)
      into v_actor_is_platform_owner;

    if v_actor_tenant is null then
      select count(*), (array_agg(m.tenant_id))[1] into v_membership_count, v_membership_tenant
      from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_actor_id and m.is_active = true and t.status = 'active';
      if v_membership_count = 1 then v_actor_tenant := v_membership_tenant;
      elsif v_membership_count > 1 then
        raise exception 'Tenant context is ambiguous for this user; provide tenant_id explicitly';
      end if;
    end if;

    if v_actor_tenant is not null then
      select exists(select 1 from public.tenant_memberships m
        join public.tenants t on t.id = m.tenant_id
        where m.user_id = v_actor_id and m.tenant_id = v_actor_tenant
          and m.is_active = true and t.status = 'active')
        into v_actor_is_member;
      if not v_actor_is_member and not v_actor_is_platform_owner then
        raise exception 'Actor is not an active member of the target tenant';
      end if;
    elsif not v_actor_is_platform_owner then
      raise exception 'A tenant member or Platform Owner must create tenant records';
    end if;
  end if;

  if new.tenant_id is null then
    if v_actor_tenant is null then
      raise exception 'tenant_id is required and could not be resolved for %.%', tg_table_schema, tg_table_name;
    end if;
    new.tenant_id := v_actor_tenant;
  elsif v_actor_tenant is not null and v_actor_tenant <> new.tenant_id then
    raise exception 'Actor is not a member of the target tenant';
  end if;

  if tg_op = 'INSERT' and v_actor_id is null and not v_actor_is_platform_owner then
    raise exception 'A tenant member or Platform Owner must create tenant records';
  end if;
  return new;
end;
$function$;
