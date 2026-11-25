alter table public.inventory_lots
  add column if not exists is_problematic boolean not null default false,
  add column if not exists problematic_reason text,
  add column if not exists problematic_at timestamptz,
  add column if not exists problematic_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_lots_problematic_by_fkey'
      and conrelid = 'public.inventory_lots'::regclass
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_problematic_by_fkey
      foreign key (problematic_by) references auth.users(id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_lots_problematic_reason_check'
      and conrelid = 'public.inventory_lots'::regclass
  ) then
    alter table public.inventory_lots
      add constraint inventory_lots_problematic_reason_check
      check (not is_problematic or length(btrim(coalesce(problematic_reason, ''))) >= 3);
  end if;
end $$;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (
  action = any (array[
    'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
    'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
    'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
    'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated',
    'expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted',
    'expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed',
    'fund_request.corrected','fund_request_document.uploaded','purchase_request.created','purchase_receipt.created',
    'purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested',
    'purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded','lot.created',
    'lot.marked_problematic','lot.restored_normal','customer.created','customer.updated','sales_draft.created',
    'sales.dispatched','sales.finalized','sales.ba_document_uploaded','sales_expense_master.created',
    'sales_expense_master.updated','sales.expenses_generated','expense.sales_ba_draft_created',
    'expense.sales_ba_submitted','sales_expense_period.closed','sales.settlement_received',
    'sales.invoice_deduction_created','sales.invoice_deduction_updated'
  ]::text[])
);

create or replace function public.set_inventory_lot_problem_status_with_audit(
  p_lot_id uuid,
  p_actor_user_id uuid,
  p_is_problematic boolean,
  p_reason text
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lot public.inventory_lots%rowtype;
  v_action text;
  v_reason text;
begin
  v_reason := left(btrim(coalesce(p_reason, '')), 1000);
  if p_actor_user_id is null or p_lot_id is null or p_is_problematic is null then
    raise exception 'Invalid lot status request';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Reason is required';
  end if;

  select * into v_lot
  from public.inventory_lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'Lot not found';
  end if;
  if v_lot.is_problematic = p_is_problematic then
    raise exception 'Lot status is already set';
  end if;
  if not exists (
    select 1
    from public.purchase_payment_requests p
    where p.receipt_id = v_lot.source_receipt_id
      and p.tenant_id = v_lot.tenant_id
      and p.status = 'Lunas'
  ) then
    raise exception 'Only fully paid Lots can change problem status';
  end if;

  update public.inventory_lots
  set is_problematic = p_is_problematic,
      problematic_reason = case when p_is_problematic then v_reason else null end,
      problematic_at = case when p_is_problematic then now() else null end,
      problematic_by = case when p_is_problematic then p_actor_user_id else null end
  where id = p_lot_id;

  v_action := case when p_is_problematic then 'lot.marked_problematic' else 'lot.restored_normal' end;
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, before_data, after_data, tenant_id
  ) values (
    p_actor_user_id,
    v_action,
    'inventory_lot',
    p_lot_id::text,
    jsonb_build_object('is_problematic', v_lot.is_problematic, 'problematic_reason', v_lot.problematic_reason),
    jsonb_build_object('is_problematic', p_is_problematic, 'reason', v_reason),
    v_lot.tenant_id
  );

  return p_lot_id;
end;
$function$;

revoke all on function public.set_inventory_lot_problem_status_with_audit(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_inventory_lot_problem_status_with_audit(uuid, uuid, boolean, text) to service_role;

create or replace function public.create_sales_draft_with_audit(
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_project_id uuid,
  p_destination text,
  p_sale_price_per_kg numeric,
  p_notes text,
  p_allocations jsonb
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
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
    if v_lot.is_problematic then raise exception 'Lot is marked Bermasalah and cannot be added to Sales'; end if;
    if not exists (
      select 1 from public.purchase_payment_requests p
      where p.receipt_id = v_lot.source_receipt_id
        and p.tenant_id = v_lot.tenant_id
        and p.status = 'Lunas'
    ) then raise exception 'Lot is not fully paid and cannot be added to Sales'; end if;
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
