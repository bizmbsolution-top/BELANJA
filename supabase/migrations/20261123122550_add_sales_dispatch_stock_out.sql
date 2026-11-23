alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type = any (array['receipt'::text,'sale_dispatch'::text]));

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created','customer.created','customer.updated','sales_draft.created','sales.dispatched'
]));

-- Include completed sales dispatches when validating available stock for new drafts.
create or replace function public.create_sales_draft_with_audit(
  p_actor_user_id uuid, p_customer_id uuid, p_project_id uuid, p_destination text,
  p_sale_price_per_kg numeric, p_notes text, p_allocations jsonb
) returns uuid
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_alloc record;
  v_lot public.inventory_lots%rowtype;
  v_available numeric;
  v_unit_cost numeric;
  v_count integer;
begin
  if not exists(select 1 from public.customers where id=p_customer_id and is_active) then raise exception 'Customer unavailable'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and is_active) then raise exception 'Project unavailable'; end if;
  if length(btrim(coalesce(p_destination,''))) not between 2 and 500 then raise exception 'Invalid destination'; end if;
  if p_sale_price_per_kg is null or p_sale_price_per_kg<=0 then raise exception 'Invalid sale price'; end if;
  if jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<1 or jsonb_array_length(p_allocations)>100 then raise exception 'Select at least one Lot'; end if;
  select count(*) into v_count from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric);
  if v_count <> (select count(distinct x.lot_id) from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric)) then raise exception 'Duplicate Lot selection'; end if;

  perform l.id from public.inventory_lots l
  join (select distinct x.lot_id from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric)) s on s.lot_id=l.id
  order by l.id for update of l;

  for v_alloc in
    select x.lot_id,x.weight_kg from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric) order by x.lot_id
  loop
    if v_alloc.weight_kg is null or v_alloc.weight_kg<=0 then raise exception 'Invalid allocated weight'; end if;
    select * into v_lot from public.inventory_lots where id=v_alloc.lot_id;
    if not found or v_lot.project_id<>p_project_id then raise exception 'Lot does not belong to selected Project'; end if;
    if not exists(select 1 from public.warehouse_projects where project_id=p_project_id and warehouse_id=v_lot.warehouse_id) then raise exception 'Lot Warehouse is not assigned to Project'; end if;
    select coalesce(sum(case when movement_type in ('sale_dispatch','issue','transfer_out') then -weight_kg else weight_kg end),0)
      into v_available from public.inventory_movements where lot_id=v_lot.id;
    if v_alloc.weight_kg>v_available then raise exception 'Allocated weight exceeds available Lot stock'; end if;
  end loop;

  insert into public.sales_orders(customer_id,project_id,destination,sale_price_per_kg,notes,created_by,updated_by)
  values(p_customer_id,p_project_id,btrim(p_destination),p_sale_price_per_kg,
    nullif(left(btrim(coalesce(p_notes,'')),1000),''),p_actor_user_id,p_actor_user_id)
  returning id into v_id;

  for v_alloc in
    select x.lot_id,x.weight_kg from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric) order by x.lot_id
  loop
    select * into v_lot from public.inventory_lots where id=v_alloc.lot_id;
    v_unit_cost := v_lot.total_purchase_cost / v_lot.initial_weight_kg;
    insert into public.sales_order_lot_allocations(
      sales_order_id,lot_id,source_warehouse_id,category_id,allocated_weight_kg,
      grade_value,grade_unit,purchase_cost_per_kg,allocated_purchase_cost,created_by
    ) values (
      v_id,v_lot.id,v_lot.warehouse_id,v_lot.category_id,v_alloc.weight_kg,
      v_lot.grade_value,v_lot.grade_unit,v_unit_cost,
      round(v_unit_cost*v_alloc.weight_kg,2),p_actor_user_id
    );
  end loop;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'sales_draft.created','sales_order',v_id::text,
    jsonb_build_object('customer_id',p_customer_id,'project_id',p_project_id,'destination',btrim(p_destination),
      'sale_price_per_kg',p_sale_price_per_kg,'allocations',p_allocations));
  return v_id;
end;
$function$;

create or replace function public.confirm_sales_dispatch_with_audit(
  p_sales_order_id uuid, p_actor_user_id uuid
) returns uuid
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_order public.sales_orders%rowtype;
  v_alloc record;
  v_available numeric;
  v_total_weight numeric := 0;
  v_total_cost numeric := 0;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_order.status <> 'Draft' then raise exception 'Only Draft sales can be dispatched'; end if;

  perform l.id
  from public.inventory_lots l
  join (select distinct lot_id from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id) a on a.lot_id=l.id
  order by l.id for update of l;

  if not exists(select 1 from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id) then
    raise exception 'Sales order has no Lot allocations';
  end if;

  for v_alloc in
    select a.*, l.project_id, l.warehouse_id as lot_warehouse_id
    from public.sales_order_lot_allocations a
    join public.inventory_lots l on l.id=a.lot_id
    where a.sales_order_id=p_sales_order_id
    order by a.lot_id
  loop
    if v_alloc.project_id<>v_order.project_id or v_alloc.lot_warehouse_id<>v_alloc.source_warehouse_id then
      raise exception 'Lot allocation source data mismatch';
    end if;
    select coalesce(sum(case when movement_type in ('sale_dispatch','issue','transfer_out') then -weight_kg else weight_kg end),0)
      into v_available from public.inventory_movements where lot_id=v_alloc.lot_id;
    if v_alloc.allocated_weight_kg>v_available then
      raise exception 'Allocated weight exceeds available Lot stock';
    end if;
    v_total_weight := v_total_weight + v_alloc.allocated_weight_kg;
    v_total_cost := v_total_cost + v_alloc.allocated_purchase_cost;
  end loop;

  insert into public.inventory_movements(
    movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,
    weight_kg,value,value_unit,created_by
  )
  select 'sale_dispatch',null,a.lot_id,v_order.project_id,a.source_warehouse_id,
    a.category_id,a.allocated_weight_kg,a.grade_value,a.grade_unit,p_actor_user_id
  from public.sales_order_lot_allocations a
  where a.sales_order_id=p_sales_order_id
  order by a.lot_id;

  update public.sales_orders
  set status='Dikirim',dispatched_weight_kg=v_total_weight,
      dispatched_purchase_cost=round(v_total_cost,2),dispatched_at=now(),
      dispatched_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id
  where id=p_sales_order_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,'sales.dispatched','sales_order',p_sales_order_id::text,
    jsonb_build_object('status','Draft'),
    jsonb_build_object('status','Dikirim','dispatched_weight_kg',v_total_weight,
      'dispatched_purchase_cost',round(v_total_cost,2),'allocations',
      (select jsonb_agg(jsonb_build_object('lot_id',lot_id,'weight_kg',allocated_weight_kg) order by lot_id)
       from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id)));
  return p_sales_order_id;
end;
$function$;

revoke all on function public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb) to service_role;
revoke all on function public.confirm_sales_dispatch_with_audit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_sales_dispatch_with_audit(uuid,uuid) to service_role;
