alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type = any (array['receipt','sale_dispatch','purchase_return']::text[]));

alter table public.inventory_lots
  add column if not exists is_returned boolean not null default false,
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by uuid references auth.users(id);

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded',
'project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_receipt.cancelled',
'purchase_payment.requested','purchase_payment.paid','purchase_payment.cancelled','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created','lot.marked_problematic','lot.restored_normal','lot.cancelled','lot.returned',
'customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized','sales.ba_document_uploaded',
'sales_expense_master.created','sales_expense_master.updated','sales.expenses_generated','expense.sales_ba_draft_created',
'expense.sales_ba_submitted','sales_expense_period.closed','sales.settlement_received','sales.invoice_deduction_created','sales.invoice_deduction_updated'
]::text[]));

create or replace function public.return_purchase_lot_with_audit(
  p_lot_id uuid,
  p_actor_user_id uuid,
  p_weight_kg numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_lot public.inventory_lots%rowtype;
  v_payment_status text;
  v_available numeric;
  v_remaining numeric;
  v_reason text;
begin
  v_reason := left(btrim(coalesce(p_reason,'')),1000);
  if p_lot_id is null or p_actor_user_id is null or p_weight_kg is null or p_weight_kg <= 0 then
    raise exception 'Lot dan berat Return harus valid';
  end if;
  if length(v_reason) < 3 then raise exception 'Alasan Return wajib diisi'; end if;

  select * into v_lot from public.inventory_lots where id=p_lot_id for update;
  if not found then raise exception 'Purchase Lot tidak ditemukan'; end if;
  if v_lot.is_cancelled then raise exception 'Lot yang dibatalkan tidak dapat di-Return'; end if;
  if v_lot.is_returned then raise exception 'Lot sudah di-Return seluruhnya'; end if;

  select p.status into v_payment_status
  from public.purchase_payment_requests p
  where p.receipt_id=v_lot.source_receipt_id and p.tenant_id=v_lot.tenant_id
  order by p.requested_at desc limit 1;
  if v_payment_status is distinct from 'Lunas' then
    raise exception 'Return hanya dapat dilakukan untuk Purchase Lot yang sudah lunas';
  end if;

  select coalesce(sum(
    case when movement_type in ('sale_dispatch','purchase_return') then -weight_kg else weight_kg end
  ),0) into v_available
  from public.inventory_movements where lot_id=v_lot.id;

  if v_available <= 0 then raise exception 'Lot tidak memiliki stok tersisa untuk di-Return'; end if;
  if p_weight_kg > v_available then raise exception 'Berat Return melebihi stok Lot yang tersedia'; end if;

  insert into public.inventory_movements(
    movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,
    weight_kg,value,value_unit,created_by,tenant_id
  ) values (
    'purchase_return',v_lot.source_receipt_id,v_lot.id,v_lot.project_id,v_lot.warehouse_id,v_lot.category_id,
    p_weight_kg,v_lot.grade_value,v_lot.grade_unit,p_actor_user_id,v_lot.tenant_id
  );

  v_remaining := v_available-p_weight_kg;
  if v_remaining <= 0.0001 then
    update public.inventory_lots set is_returned=true,returned_at=now(),returned_by=p_actor_user_id where id=v_lot.id;
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
  values(
    p_actor_user_id,'lot.returned','inventory_lot',v_lot.id::text,
    jsonb_build_object('available_weight_kg',v_available,'is_returned',v_lot.is_returned),
    jsonb_build_object('returned_weight_kg',p_weight_kg,'remaining_weight_kg',greatest(v_remaining,0),
      'is_returned',v_remaining<=0.0001,'reason',v_reason,'movement_type','purchase_return'),
    v_lot.tenant_id
  );
  return v_lot.id;
end;
$function$;

revoke all on function public.return_purchase_lot_with_audit(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.return_purchase_lot_with_audit(uuid,uuid,numeric,text) to service_role;
