do $$
declare v_def text;
begin
  select pg_get_functiondef('public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'in (''sale_dispatch'',''issue'',''transfer_out'')', 'in (''sale_dispatch'',''issue'',''transfer_out'',''purchase_return'')');
  execute v_def;
  select pg_get_functiondef('public.confirm_sales_dispatch_with_audit(uuid,uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'in (''sale_dispatch'',''issue'',''transfer_out'')', 'in (''sale_dispatch'',''issue'',''transfer_out'',''purchase_return'')');
  execute v_def;
end $$;