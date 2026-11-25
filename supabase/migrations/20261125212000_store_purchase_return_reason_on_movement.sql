alter table public.inventory_movements add column if not exists reason text;
do $$
declare v_def text;
begin
 select pg_get_functiondef('public.return_purchase_lot_with_audit(uuid,uuid,numeric,text)'::regprocedure) into v_def;
 v_def := replace(v_def,
   'weight_kg,value,value_unit,created_by,tenant_id',
   'weight_kg,value,value_unit,created_by,reason,tenant_id');
 v_def := replace(v_def,
   'p_weight_kg,v_lot.grade_value,v_lot.grade_unit,p_actor_user_id,v_lot.tenant_id',
   'p_weight_kg,v_lot.grade_value,v_lot.grade_unit,p_actor_user_id,v_reason,v_lot.tenant_id');
 execute v_def;
end $$;