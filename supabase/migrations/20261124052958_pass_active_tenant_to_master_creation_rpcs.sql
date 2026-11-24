do $migration$
declare
  r record;
  v_def text;
  v_before text;
  v_sig text;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_expense_category_with_audit','create_purchase_category_with_audit',
      'create_project_with_audit','create_supplier_with_audit','create_uom_with_audit',
      'create_warehouse_with_audit','save_customer_with_addresses_with_audit',
      'save_sales_expense_master_with_audit'
    )
    and not (p.proargnames @> array['p_tenant_id'])
  loop
    v_def := pg_get_functiondef(r.oid);
    v_before := v_def;
    v_def := replace(v_def, E')\n RETURNS', E', p_tenant_id uuid)\n RETURNS');
    v_def := replace(v_def, 'created_by,updated_by)', 'tenant_id,created_by,updated_by)');
    v_def := replace(v_def, 'created_by, updated_by)', 'tenant_id, created_by, updated_by)');
    v_def := replace(v_def, 'created_by, updated_by
  ) values', 'tenant_id, created_by, updated_by
  ) values');
    v_def := replace(v_def, 'p_actor_user_id,p_actor_user_id)', 'p_tenant_id,p_actor_user_id,p_actor_user_id)');
    v_def := replace(v_def, 'p_actor_user_id,
    p_actor_user_id', 'p_tenant_id,
    p_actor_user_id,
    p_actor_user_id');
    v_def := replace(v_def, 'audit_logs(actor_user_id', 'audit_logs(tenant_id,actor_user_id');
    v_def := replace(v_def, 'audit_logs (
    actor_user_id', 'audit_logs (
    tenant_id,
    actor_user_id');
    v_def := replace(v_def, 'audit_logs (actor_user_id', 'audit_logs (tenant_id, actor_user_id');
    v_def := replace(v_def, 'values(p_actor_user_id,', 'values(p_tenant_id,p_actor_user_id,');
    v_def := replace(v_def, 'values (
    p_actor_user_id,', 'values (
    p_tenant_id,
    p_actor_user_id,');
    if r.proname = 'create_warehouse_with_audit' then
      v_def := replace(v_def, 'nullif(btrim(coalesce(p_description, '''')), ''''), p_actor_user_id, p_actor_user_id)',
        'nullif(btrim(coalesce(p_description, '''')), ''''), p_tenant_id, p_actor_user_id, p_actor_user_id)');
    end if;
    if r.proname = 'save_customer_with_addresses_with_audit' then
      v_def := replace(v_def, 'where id=p_customer_id for update', 'where id=p_customer_id and tenant_id=p_tenant_id for update');
      v_def := replace(v_def, 'where id=p_customer_id returning id', 'where id=p_customer_id and tenant_id=p_tenant_id returning id');
      v_def := replace(v_def, 'where id=v_item.id and customer_id=v_id', 'where id=v_item.id and customer_id=v_id and tenant_id=p_tenant_id');
      v_def := replace(v_def, 'where customer_id=v_id and is_active', 'where customer_id=v_id and tenant_id=p_tenant_id and is_active');
    elsif r.proname = 'save_sales_expense_master_with_audit' then
      v_def := replace(v_def, 'where id=p_master_id for update', 'where id=p_master_id and tenant_id=p_tenant_id for update');
      v_def := replace(v_def, 'where id=p_master_id returning *', 'where id=p_master_id and tenant_id=p_tenant_id returning *');
      v_def := replace(v_def, 'where id=p_expense_category_id and is_active', 'where id=p_expense_category_id and tenant_id=p_tenant_id and is_active');
    end if;
    if v_def = v_before or position('p_tenant_id uuid' in v_def)=0 then
      raise exception 'Tenant rewrite incomplete for %', r.proname;
    end if;
    execute v_def;
    v_sig := format('public.%I(%s)', r.proname, r.args);
    execute 'revoke all on function ' || v_sig || ' from public, anon, authenticated, service_role';
    v_sig := format('public.%I(%s, uuid)', r.proname, r.args);
    execute 'revoke all on function ' || v_sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || v_sig || ' to service_role';
  end loop;
  v_def := pg_get_functiondef('public.enforce_tenant_row_isolation()'::regprocedure);
  v_before := v_def;
  v_def := replace(v_def,
    'when ''customer'' then ''customers''',
    E'when ''expense_category'' then ''expense_categories''\n      when ''uom'' then ''units_of_measure''\n      when ''customer'' then ''customers''');
  if v_def <> v_before then execute v_def; end if;
end
$migration$;
