-- Cancel an accepted purchase receipt while its payment is still pending.
alter table public.purchase_receipts drop constraint if exists purchase_receipts_status_check;
alter table public.purchase_receipts add constraint purchase_receipts_status_check
  check (status = any (array['Draft','Diterima','Ditolak','Dibatalkan']::text[]));

alter table public.purchase_payment_requests drop constraint if exists purchase_payment_requests_status_check;
alter table public.purchase_payment_requests add constraint purchase_payment_requests_status_check
  check (status = any (array['Menunggu Pembayaran','Lunas','Dibatalkan']::text[]));

alter table public.inventory_lots
  add column if not exists is_cancelled boolean not null default false,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id);

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded',
'project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_receipt.cancelled',
'purchase_payment.requested','purchase_payment.paid','purchase_payment.cancelled','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created','lot.marked_problematic','lot.restored_normal','lot.cancelled',
'customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized','sales.ba_document_uploaded',
'sales_expense_master.created','sales_expense_master.updated','sales.expenses_generated','expense.sales_ba_draft_created','expense.sales_ba_submitted','sales_expense_period.closed','sales.settlement_received','sales.invoice_deduction_created','sales.invoice_deduction_updated'
]::text[]));

create or replace function public.cancel_received_purchase_with_audit(
  p_payment_request_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_payment public.purchase_payment_requests%rowtype;
  v_receipt public.purchase_receipts%rowtype;
  v_request public.purchase_requests%rowtype;
  v_lot public.inventory_lots%rowtype;
begin
  if length(btrim(coalesce(p_reason,''))) < 3 or length(btrim(p_reason)) > 1000 then
    raise exception 'Alasan pembatalan wajib diisi (3-1000 karakter)';
  end if;
  select * into v_payment from public.purchase_payment_requests where id = p_payment_request_id for update;
  if not found or v_payment.status <> 'Menunggu Pembayaran' then
    raise exception 'Hanya pengajuan Menunggu Pembayaran yang dapat dibatalkan';
  end if;
  select * into v_receipt from public.purchase_receipts where id = v_payment.receipt_id for update;
  if not found or v_receipt.status <> 'Diterima' then
    raise exception 'Penerimaan tidak lagi berstatus Diterima';
  end if;
  select * into v_request from public.purchase_requests where id = v_receipt.purchase_request_id for update;
  select * into v_lot from public.inventory_lots where source_receipt_id = v_receipt.id for update;
  if not found then raise exception 'Purchase Lot tidak ditemukan'; end if;
  if exists (select 1 from public.inventory_movements where lot_id = v_lot.id and movement_type = 'sale_dispatch') then
    raise exception 'Lot sudah pernah dikirim untuk penjualan dan tidak dapat dibatalkan';
  end if;
  if v_payment.status = 'Lunas' or coalesce(v_payment.paid_amount,0) > 0 then
    raise exception 'Pembayaran sudah dilakukan; pembatalan tidak diizinkan';
  end if;
  update public.purchase_payment_requests set status = 'Dibatalkan' where id = v_payment.id;
  update public.purchase_receipts set status = 'Dibatalkan', decision_reason = left(btrim(p_reason),1000),
    updated_at = now(), updated_by = p_actor_user_id where id = v_receipt.id;
  update public.purchase_requests set status = 'Dibatalkan', updated_at = now(), updated_by = p_actor_user_id where id = v_request.id;
  update public.inventory_lots set is_cancelled = true, cancellation_reason = left(btrim(p_reason),1000),
    cancelled_at = now(), cancelled_by = p_actor_user_id where id = v_lot.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values (p_actor_user_id,'purchase_receipt.cancelled','purchase_receipt',v_receipt.id::text,
    jsonb_build_object('receipt_status',v_receipt.status,'payment_status',v_payment.status,'request_status',v_request.status,'lot_id',v_lot.id),
    jsonb_build_object('receipt_status','Dibatalkan','payment_status','Dibatalkan','request_status','Dibatalkan',
      'lot_id',v_lot.id,'lot_code',v_lot.code,'reason',left(btrim(p_reason),1000)));
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values (p_actor_user_id,'purchase_payment.cancelled','purchase_payment_request',v_payment.id::text,
    jsonb_build_object('status',v_payment.status,'amount',v_payment.amount),
    jsonb_build_object('status','Dibatalkan','amount',v_payment.amount,'reason',left(btrim(p_reason),1000)));
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values (p_actor_user_id,'lot.cancelled','inventory_lot',v_lot.id::text,
    jsonb_build_object('is_cancelled',false),
    jsonb_build_object('is_cancelled',true,'reason',left(btrim(p_reason),1000),'source_receipt_id',v_receipt.id));
  return v_receipt.id;
end;
$function$;

revoke execute on function public.cancel_received_purchase_with_audit(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_received_purchase_with_audit(uuid,uuid,text) to service_role;
