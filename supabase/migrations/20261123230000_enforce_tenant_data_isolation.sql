begin;

do $$
declare
  t text;
  tenant_uuid uuid;
  owner_uuid uuid;
  table_names text[] := array[
    'audit_logs','customer_warehouse_addresses','customers','expense_categories',
    'expense_documents','expense_payment_documents','expenses','fund_request_documents',
    'fund_requests','inventory_lots','inventory_movements','project_cash_ledger',
    'projects','purchase_categories','purchase_payment_documents','purchase_payment_requests',
    'purchase_receipt_documents','purchase_receipts','purchase_requests','sales_expense_masters',
    'sales_expense_period_closings','sales_invoice_deduction_components','sales_order_documents',
    'sales_order_expense_items','sales_order_lot_allocations','sales_order_settlement_deductions',
    'sales_order_settlements','sales_orders','suppliers','units_of_measure',
    'user_access_profiles','user_permission_overrides','user_work_scopes',
    'warehouse_projects','warehouses'
  ];
begin
  select id into tenant_uuid from public.tenants where slug='mbsolutions';
  select user_id into owner_uuid from public.platform_owners limit 1;
  if tenant_uuid is null or owner_uuid is null then
    raise exception 'Platform Owner and MBSolutions tenant must be bootstrapped first';
  end if;

  foreach t in array table_names loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)',t);
    if t='user_access_profiles' then
      execute format('update public.%I set tenant_id=$1 where tenant_id is null and user_id not in (select user_id from public.platform_owners)',t) using tenant_uuid;
    else
      execute format('update public.%I set tenant_id=$1 where tenant_id is null',t) using tenant_uuid;
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id)',t||'_tenant_id_idx',t);
  end loop;

  insert into public.tenant_memberships(tenant_id,user_id,tenant_role,is_active,created_by)
  select tenant_uuid,p.user_id,
         case when 'Superadmin'=any(p.roles) then 'superadmin' else 'member' end,
         p.is_active,owner_uuid
  from public.user_access_profiles p
  where not exists(select 1 from public.platform_owners po where po.user_id=p.user_id)
  on conflict(tenant_id,user_id) do update
    set is_active=excluded.is_active,tenant_role=excluded.tenant_role,updated_at=now();
end $;

do $
declare t record;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema='public' and column_name='tenant_id'
      and table_name not in ('tenants','platform_owners','tenant_memberships','tenant_health_snapshots','platform_audit_logs','user_access_profiles')
  loop
    execute format('alter table public.%I alter column tenant_id set not null',t.table_name);
  end loop;
end $;

do $
declare
  t text;
  policy_base text;
  table_names text[] := array[
    'audit_logs','customer_warehouse_addresses','customers','expense_categories',
    'expense_documents','expense_payment_documents','expenses','fund_request_documents',
    'fund_requests','inventory_lots','inventory_movements','project_cash_ledger',
    'projects','purchase_categories','purchase_payment_documents','purchase_payment_requests',
    'purchase_receipt_documents','purchase_receipts','purchase_requests','sales_expense_masters',
    'sales_expense_period_closings','sales_invoice_deduction_components','sales_order_documents',
    'sales_order_expense_items','sales_order_lot_allocations','sales_order_settlement_deductions',
    'sales_order_settlements','sales_orders','suppliers','units_of_measure',
    'user_access_profiles','user_permission_overrides','user_work_scopes',
    'warehouse_projects','warehouses'
  ];
begin
  foreach t in array table_names loop
    execute format('alter table public.%I enable row level security',t);
    policy_base := t || '_tenant_member';
    execute format('drop policy if exists %I on public.%I',policy_base||'_select',t);
    execute format('drop policy if exists %I on public.%I',policy_base||'_insert',t);
    execute format('drop policy if exists %I on public.%I',policy_base||'_update',t);
    execute format('drop policy if exists %I on public.%I',policy_base||'_delete',t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists(select 1 from public.tenant_memberships m join public.tenants tn on tn.id=m.tenant_id where m.user_id=(select auth.uid()) and m.tenant_id=%I.tenant_id and m.is_active=true and tn.status=''active''))',
      policy_base||'_select',t,t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists(select 1 from public.tenant_memberships m join public.tenants tn on tn.id=m.tenant_id where m.user_id=(select auth.uid()) and m.tenant_id=%I.tenant_id and m.is_active=true and tn.status=''active''))',
      policy_base||'_insert',t,t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists(select 1 from public.tenant_memberships m join public.tenants tn on tn.id=m.tenant_id where m.user_id=(select auth.uid()) and m.tenant_id=%I.tenant_id and m.is_active=true and tn.status=''active'')) with check (exists(select 1 from public.tenant_memberships m join public.tenants tn on tn.id=m.tenant_id where m.user_id=(select auth.uid()) and m.tenant_id=%I.tenant_id and m.is_active=true and tn.status=''active''))',
      policy_base||'_update',t,t,t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (exists(select 1 from public.tenant_memberships m join public.tenants tn on tn.id=m.tenant_id where m.user_id=(select auth.uid()) and m.tenant_id=%I.tenant_id and m.is_active=true and tn.status=''active''))',
      policy_base||'_delete',t,t);
  end loop;
end $$;

drop policy if exists tenant_memberships_self_select on public.tenant_memberships;
create policy tenant_memberships_self_select on public.tenant_memberships
for select to authenticated using(user_id=(select auth.uid()));

drop policy if exists platform_owners_self_select on public.platform_owners;
create policy platform_owners_self_select on public.platform_owners
for select to authenticated using(user_id=(select auth.uid()));

drop policy if exists tenants_platform_owner_select on public.tenants;
create policy tenants_platform_owner_select on public.tenants
for select to authenticated using(exists(select 1 from public.platform_owners po where po.user_id=(select auth.uid())));

drop policy if exists tenants_member_select on public.tenants;
create policy tenants_member_select on public.tenants
for select to authenticated using(exists(select 1 from public.tenant_memberships m where m.user_id=(select auth.uid()) and m.tenant_id=tenants.id and m.is_active=true));

drop policy if exists tenant_health_platform_owner_select on public.tenant_health_snapshots;
create policy tenant_health_platform_owner_select on public.tenant_health_snapshots
for select to authenticated using(exists(select 1 from public.platform_owners po where po.user_id=(select auth.uid())));

drop policy if exists platform_audit_platform_owner_select on public.platform_audit_logs;
create policy platform_audit_platform_owner_select on public.platform_audit_logs
for select to authenticated using(exists(select 1 from public.platform_owners po where po.user_id=(select auth.uid())));

create or replace function public.enforce_tenant_row_isolation()
returns trigger language plpgsql
set search_path=pg_catalog,public
as $$
declare
  v_row jsonb;
  v_key text;
  v_actor_text text;
  v_actor_id uuid;
  v_actor_tenant uuid;
  v_actor_is_platform_owner boolean:=false;
  v_parent record;
  v_parent_tenant uuid;
  v_value text;
begin
  v_row:=to_jsonb(new);
  if tg_op='UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  foreach v_key in array array[
    'created_by','updated_by','actor_user_id','requested_by','uploaded_by',
    'completed_by','paid_by','executed_by','cancelled_by','submitted_by',
    'received_by','closed_by','finalized_by','dispatched_by','posted_by'
  ] loop
    v_actor_text:=v_row->>v_key;
    if v_actor_text is not null and v_actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor_id:=v_actor_text::uuid;
      select m.tenant_id into v_actor_tenant
      from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
      where m.user_id=v_actor_id and m.is_active=true and t.status='active'
      order by m.created_at limit 1;
      if v_actor_tenant is not null then exit; end if;
      select exists(select 1 from public.platform_owners po where po.user_id=v_actor_id)
      into v_actor_is_platform_owner;
      if v_actor_is_platform_owner then exit; end if;
    end if;
  end loop;

  if new.tenant_id is null and v_actor_tenant is not null then new.tenant_id:=v_actor_tenant; end if;

  for v_parent in
    select parent_ns.nspname parent_schema,parent_table.relname parent_table,
      parent_column.attname parent_column,child_column.attname child_column
    from pg_constraint fk
    join pg_class child_table on child_table.oid=fk.conrelid
    join pg_class parent_table on parent_table.oid=fk.confrelid
    join pg_namespace parent_ns on parent_ns.oid=parent_table.relnamespace
    join pg_attribute child_column on child_column.attrelid=fk.conrelid and child_column.attnum=fk.conkey[1]
    join pg_attribute parent_column on parent_column.attrelid=fk.confrelid and parent_column.attnum=fk.confkey[1]
    where fk.contype='f' and fk.conrelid=tg_relid
      and array_length(fk.conkey,1)=1 and array_length(fk.confkey,1)=1
      and parent_ns.nspname='public'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=parent_table.relname and c.column_name='tenant_id')
  loop
    v_value:=v_row->>v_parent.child_column;
    if v_value is not null then
      execute format('select tenant_id from %I.%I where %I::text=$1 limit 1',v_parent.parent_schema,v_parent.parent_table,v_parent.parent_column)
      into v_parent_tenant using v_value;
      if v_parent_tenant is not null then
        if new.tenant_id is null then new.tenant_id:=v_parent_tenant;
        elsif new.tenant_id<>v_parent_tenant then raise exception 'Cross-tenant relationship rejected for %.%',tg_table_schema,tg_table_name;
        end if;
      end if;
    end if;
  end loop;

  if new.tenant_id is null then raise exception 'tenant_id is required and could not be resolved for %.%',tg_table_schema,tg_table_name; end if;
  if v_actor_tenant is not null and v_actor_tenant<>new.tenant_id then raise exception 'Actor is not a member of the target tenant'; end if;
  if v_actor_tenant is null and not v_actor_is_platform_owner and tg_op='INSERT' then
    raise exception 'A tenant member or Platform Owner must create tenant records';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_tenant_row_isolation() from public,anon,authenticated;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and c.relname not in ('tenants','platform_owners','tenant_memberships','tenant_health_snapshots','platform_audit_logs')
      and exists(select 1 from information_schema.columns col where col.table_schema='public' and col.table_name=c.relname and col.column_name='tenant_id')
  loop
    execute format('drop trigger if exists enforce_tenant_row_isolation on public.%I',t.relname);
    execute format('create trigger enforce_tenant_row_isolation before insert or update on public.%I for each row execute function public.enforce_tenant_row_isolation()',t.relname);
  end loop;
end $$;

commit;
