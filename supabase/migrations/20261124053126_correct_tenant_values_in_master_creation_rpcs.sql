do $migration$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.create_supplier_with_audit(uuid,text,text,text,text,text,text,uuid)'::regprocedure);
  v_def := replace(v_def,
    'name, contact_person, phone, email, address, notes, created_by, updated_by',
    'name, contact_person, phone, email, address, notes, tenant_id, created_by, updated_by');
  v_def := replace(v_def,
    '    p_tenant_id,
    p_actor_user_id
  )',
    '    p_tenant_id,
    p_actor_user_id,
    p_actor_user_id
  )');
  execute v_def;

  v_def := pg_get_functiondef('public.create_purchase_category_with_audit(uuid,text,text,uuid)'::regprocedure);
  v_def := replace(v_def,
    '    p_tenant_id,
    p_actor_user_id
  )',
    '    p_tenant_id,
    p_actor_user_id,
    p_actor_user_id
  )');
  execute v_def;

  v_def := pg_get_functiondef('public.create_warehouse_with_audit(uuid,text,text,text,uuid)'::regprocedure);
  v_def := replace(v_def,
    'nullif(btrim(coalesce(p_description, '''')), ''''), p_actor_user_id, p_actor_user_id)',
    'nullif(btrim(coalesce(p_description, '''')), ''''), p_tenant_id, p_actor_user_id, p_actor_user_id)');
  execute v_def;
end
$migration$;
