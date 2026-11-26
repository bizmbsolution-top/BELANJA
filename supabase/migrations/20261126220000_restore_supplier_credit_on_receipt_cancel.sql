-- Restore supplier credit when a received purchase is cancelled before any cash payment.
alter table public.purchase_receipt_credit_allocations
  add column if not exists is_reversed boolean not null default false,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id) on delete set null,
  add column if not exists reversal_reason text;
create index if not exists purchase_receipt_credit_allocations_active_credit_idx
  on public.purchase_receipt_credit_allocations(tenant_id,supplier_credit_id) where is_reversed=false;

create or replace function public.set_purchase_return_supplier_credit_decision_with_audit(p_credit_id uuid,p_decision text,p_actor_user_id uuid,p_tenant_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_credit public.purchase_return_supplier_credits%rowtype;
begin
 if p_decision not in ('replacement','refund') then raise exception 'Pilih Penggantian Barang atau Pengembalian Uang'; end if;
 select * into v_credit from public.purchase_return_supplier_credits where id=p_credit_id and tenant_id=p_tenant_id for update;
 if not found then raise exception 'Kredit Return tidak ditemukan'; end if;
 if not exists(select 1 from public.purchase_returns r where r.id=v_credit.purchase_return_id and r.tenant_id=p_tenant_id and r.status='Posted') then raise exception 'Kredit hanya dapat diputuskan untuk Return Posted'; end if;
 if v_credit.remaining_amount<v_credit.credit_amount or exists(select 1 from public.purchase_receipt_credit_allocations a where a.supplier_credit_id=v_credit.id and a.is_reversed=false) then raise exception 'Kredit yang sudah digunakan tidak dapat diubah keputusannya'; end if;
 update public.purchase_return_supplier_credits set decision=p_decision,status=case when p_decision='replacement' then 'available' else 'refund_pending' end,decided_at=now(),decided_by=p_actor_user_id where id=v_credit.id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
 values(p_actor_user_id,'purchase_return.credit_decision_set','purchase_return',v_credit.purchase_return_id::text,jsonb_build_object('credit_id',v_credit.id,'decision',v_credit.decision,'status',v_credit.status),jsonb_build_object('credit_id',v_credit.id,'decision',p_decision,'status',case when p_decision='replacement' then 'available' else 'refund_pending' end,'credit_amount',v_credit.credit_amount),p_tenant_id);
 return v_credit.id;
end; $$;

create or replace function public.cancel_received_purchase_with_audit(p_payment_request_id uuid,p_actor_user_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_payment public.purchase_payment_requests%rowtype; v_receipt public.purchase_receipts%rowtype;
 v_request public.purchase_requests%rowtype; v_lot public.inventory_lots%rowtype;
 v_allocation public.purchase_receipt_credit_allocations%rowtype; v_credit public.purchase_return_supplier_credits%rowtype;
begin
 if length(btrim(coalesce(p_reason,'')))<3 or length(btrim(p_reason))>1000 then raise exception 'Alasan pembatalan wajib diisi (3-1000 karakter)'; end if;
 select * into v_payment from public.purchase_payment_requests where id=p_payment_request_id for update;
 if not found or not (v_payment.status='Menunggu Pembayaran' or (v_payment.status='Lunas' and v_payment.payment_method='Supplier Credit' and coalesce(v_payment.paid_amount,0)=0)) then
  raise exception 'Hanya pembayaran menunggu atau yang lunas sepenuhnya dengan Kredit Supplier yang dapat dibatalkan';
 end if;
 select * into v_receipt from public.purchase_receipts where id=v_payment.receipt_id for update;
 if not found or v_receipt.status<>'Diterima' then raise exception 'Penerimaan tidak lagi berstatus Diterima'; end if;
 select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id for update;
 select * into v_lot from public.inventory_lots where source_receipt_id=v_receipt.id for update;
 if not found then raise exception 'Purchase Lot tidak ditemukan'; end if;
 if exists(select 1 from public.inventory_movements where lot_id=v_lot.id and movement_type='sale_dispatch') then raise exception 'Lot sudah pernah dikirim untuk penjualan dan tidak dapat dibatalkan'; end if;
 if coalesce(v_payment.paid_amount,0)>0 then raise exception 'Pembayaran tunai sudah dilakukan; pembatalan tidak diizinkan'; end if;
 select * into v_allocation from public.purchase_receipt_credit_allocations where receipt_id=v_receipt.id and is_reversed=false for update;
 if found then
  select * into v_credit from public.purchase_return_supplier_credits where id=v_allocation.supplier_credit_id and tenant_id=v_receipt.tenant_id for update;
  if not found then raise exception 'Catatan Kredit Supplier tidak ditemukan untuk pemulihan'; end if;
  update public.purchase_return_supplier_credits
  set remaining_amount=least(credit_amount,remaining_amount+v_allocation.amount),
      status=case when least(credit_amount,remaining_amount+v_allocation.amount)>=credit_amount-0.0001 then 'available' else 'partially_used' end
  where id=v_credit.id;
  update public.purchase_receipt_credit_allocations set is_reversed=true,reversed_at=now(),reversed_by=p_actor_user_id,reversal_reason=left(btrim(p_reason),1000) where id=v_allocation.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,'purchase_receipt.credit_reversed','purchase_receipt',v_receipt.id::text,jsonb_build_object('supplier_credit_id',v_credit.id,'amount',v_allocation.amount,'is_reversed',false),jsonb_build_object('supplier_credit_id',v_credit.id,'amount',v_allocation.amount,'is_reversed',true,'reason',left(btrim(p_reason),1000)));
 end if;
 update public.purchase_payment_requests set status='Dibatalkan' where id=v_payment.id;
 update public.purchase_receipts set status='Dibatalkan',decision_reason=left(btrim(p_reason),1000),updated_at=now(),updated_by=p_actor_user_id where id=v_receipt.id;
 update public.purchase_requests set status='Dibatalkan',updated_at=now(),updated_by=p_actor_user_id where id=v_request.id;
 update public.inventory_lots set is_cancelled=true,cancellation_reason=left(btrim(p_reason),1000),cancelled_at=now(),cancelled_by=p_actor_user_id where id=v_lot.id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'purchase_receipt.cancelled','purchase_receipt',v_receipt.id::text,jsonb_build_object('receipt_status',v_receipt.status,'payment_status',v_payment.status,'request_status',v_request.status,'lot_id',v_lot.id),jsonb_build_object('receipt_status','Dibatalkan','payment_status','Dibatalkan','request_status','Dibatalkan','lot_id',v_lot.id,'lot_code',v_lot.code,'reason',left(btrim(p_reason),1000)));
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'purchase_payment.cancelled','purchase_payment_request',v_payment.id::text,jsonb_build_object('status',v_payment.status,'amount',v_payment.amount),jsonb_build_object('status','Dibatalkan','amount',v_payment.amount,'reason',left(btrim(p_reason),1000)));
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'lot.cancelled','inventory_lot',v_lot.id::text,jsonb_build_object('is_cancelled',false),jsonb_build_object('is_cancelled',true,'reason',left(btrim(p_reason),1000),'source_receipt_id',v_receipt.id));
 return v_receipt.id;
end; $$;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated','expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded','purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_receipt.cancelled','purchase_payment.requested','purchase_payment.paid','purchase_payment.cancelled','purchase_receipt_document.uploaded','purchase_payment_document.uploaded','lot.created','lot.marked_problematic','lot.restored_normal','lot.cancelled','lot.returned','lot.quarantined','customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized','sales.ba_document_uploaded','sales_expense_master.created','sales_expense_master.updated','sales.expenses_generated','expense.sales_ba_draft_created','expense.sales_ba_submitted','sales_expense_period.closed','sales.settlement_received','sales.invoice_deduction_created','sales.invoice_deduction_updated','purchase_return.draft_created','purchase_return.posted','purchase_return.cancelled','purchase_return.credit_decision_set','purchase_receipt.credit_applied','purchase_receipt.credit_reversed'
]::text[]));