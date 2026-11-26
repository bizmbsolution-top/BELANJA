-- Supplier return credits: decision and optional offset on a later receipt.
-- Credits are created only for returns Posted after this migration.
create table if not exists public.purchase_return_supplier_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  purchase_return_id uuid not null references public.purchase_returns(id) on delete restrict,
  purchase_return_item_id uuid not null unique references public.purchase_return_items(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  source_purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  source_lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  returned_weight_kg numeric(18,3) not null check (returned_weight_kg > 0),
  unit_price_per_kg numeric(18,2) not null check (unit_price_per_kg > 0),
  credit_amount numeric(18,2) not null check (credit_amount > 0),
  remaining_amount numeric(18,2) not null check (remaining_amount >= 0),
  decision text not null default 'pending' check (decision in ('pending','replacement','refund')),
  status text not null default 'pending_decision'
    check (status in ('pending_decision','available','partially_used','used','refund_pending','refunded')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null
);

create index if not exists purchase_return_supplier_credits_supplier_status_idx
  on public.purchase_return_supplier_credits(tenant_id,supplier_id,status);
create index if not exists purchase_return_supplier_credits_return_idx
  on public.purchase_return_supplier_credits(tenant_id,purchase_return_id);

create table if not exists public.purchase_receipt_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  receipt_id uuid not null unique references public.purchase_receipts(id) on delete restrict,
  supplier_credit_id uuid not null references public.purchase_return_supplier_credits(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists purchase_receipt_credit_allocations_credit_idx
  on public.purchase_receipt_credit_allocations(tenant_id,supplier_credit_id);

alter table public.purchase_receipts
  add column if not exists gross_purchase_amount numeric(18,2),
  add column if not exists supplier_credit_amount numeric(18,2) not null default 0,
  add column if not exists net_purchase_amount numeric(18,2);

alter table public.purchase_payment_requests
  drop constraint if exists purchase_payment_requests_amount_check;
alter table public.purchase_payment_requests
  add constraint purchase_payment_requests_amount_check check (amount >= 0);
alter table public.purchase_payment_requests
  drop constraint if exists purchase_payment_requests_payment_method_check;
alter table public.purchase_payment_requests
  add constraint purchase_payment_requests_payment_method_check
  check (payment_method is null or payment_method in ('Transfer','Supplier Credit'));

alter table public.purchase_return_supplier_credits enable row level security;
alter table public.purchase_receipt_credit_allocations enable row level security;

create or replace function public.create_purchase_return_supplier_credits_after_post()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status and new.status = 'Posted' then
    insert into public.purchase_return_supplier_credits(
      tenant_id,purchase_return_id,purchase_return_item_id,supplier_id,
      source_purchase_request_id,source_lot_id,returned_weight_kg,
      unit_price_per_kg,credit_amount,remaining_amount,created_by
    )
    select
      i.tenant_id,i.purchase_return_id,i.id,l.supplier_id,l.purchase_request_id,l.id,
      i.weight_kg,l.purchase_price_per_kg,
      round(i.weight_kg*l.purchase_price_per_kg,2),
      round(i.weight_kg*l.purchase_price_per_kg,2),
      new.posted_by
    from public.purchase_return_items i
    join public.inventory_lots l on l.id=i.lot_id and l.tenant_id=i.tenant_id
    where i.purchase_return_id=new.id
      and round(i.weight_kg*l.purchase_price_per_kg,2)>0
    on conflict (purchase_return_item_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_create_purchase_return_supplier_credits on public.purchase_returns;
create trigger trg_create_purchase_return_supplier_credits
after update of status on public.purchase_returns
for each row execute function public.create_purchase_return_supplier_credits_after_post();

create or replace function public.set_purchase_return_supplier_credit_decision_with_audit(
  p_credit_id uuid,
  p_decision text,
  p_actor_user_id uuid,
  p_tenant_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credit public.purchase_return_supplier_credits%rowtype;
begin
  if p_decision not in ('replacement','refund') then
    raise exception 'Pilih Penggantian Barang atau Pengembalian Uang';
  end if;
  select * into v_credit
  from public.purchase_return_supplier_credits
  where id=p_credit_id and tenant_id=p_tenant_id
  for update;
  if not found then raise exception 'Kredit Return tidak ditemukan'; end if;
  if not exists (
    select 1 from public.purchase_returns r
    where r.id=v_credit.purchase_return_id and r.tenant_id=p_tenant_id and r.status='Posted'
  ) then raise exception 'Kredit hanya dapat diputuskan untuk Return Posted'; end if;
  if v_credit.remaining_amount < v_credit.credit_amount
     or exists(select 1 from public.purchase_receipt_credit_allocations a where a.supplier_credit_id=v_credit.id) then
    raise exception 'Kredit yang sudah digunakan tidak dapat diubah keputusannya';
  end if;

  update public.purchase_return_supplier_credits
  set decision=p_decision,
      status=case when p_decision='replacement' then 'available' else 'refund_pending' end,
      decided_at=now(),decided_by=p_actor_user_id
  where id=v_credit.id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
  values(
    p_actor_user_id,'purchase_return.credit_decision_set','purchase_return',v_credit.purchase_return_id::text,
    jsonb_build_object('credit_id',v_credit.id,'decision',v_credit.decision,'status',v_credit.status),
    jsonb_build_object('credit_id',v_credit.id,'decision',p_decision,
      'status',case when p_decision='replacement' then 'available' else 'refund_pending' end,
      'credit_amount',v_credit.credit_amount),p_tenant_id
  );
  return v_credit.id;
end;
$$;

create or replace function public.complete_purchase_receipt_with_supplier_credit_and_split_with_audit(
  p_receipt_id uuid,
  p_actor_user_id uuid,
  p_accepted_weight_kg numeric,
  p_rejected_weight_kg numeric,
  p_rejection_reason text,
  p_supplier_credit_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_request public.purchase_requests%rowtype;
  v_credit public.purchase_return_supplier_credits%rowtype;
  v_payment_id uuid;
  v_lot_id uuid;
  v_lot_code text;
  v_total_weight numeric;
  v_gross_cost numeric;
  v_credit_applied numeric := 0;
  v_net_cost numeric;
  v_reason text := left(btrim(coalesce(p_rejection_reason,'')),1000);
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if not found or v_receipt.status<>'Draft' then raise exception 'Receipt is not editable'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='weight') then raise exception 'Weight evidence required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='value') then raise exception 'Value evidence required'; end if;
  select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id for update;
  if not found or v_request.status<>'Menunggu Barang' then raise exception 'Purchase request is not open'; end if;
  v_total_weight:=case when v_receipt.weight_unit='ton' then v_receipt.weight*1000 else v_receipt.weight end;
  if p_accepted_weight_kg is null or p_rejected_weight_kg is null or p_accepted_weight_kg<0 or p_rejected_weight_kg<0
    or abs(v_total_weight-p_accepted_weight_kg-p_rejected_weight_kg)>0.0001
    or p_accepted_weight_kg+p_rejected_weight_kg<=0 then
    raise exception 'Berat diterima dan ditolak harus sama dengan berat aktual';
  end if;
  if p_rejected_weight_kg>0 and length(v_reason)<3 then raise exception 'Alasan barang ditolak wajib diisi'; end if;

  update public.purchase_receipts set
    status=case when p_accepted_weight_kg>0 then 'Diterima' else 'Ditolak' end,
    decision_reason=case when p_accepted_weight_kg=0 then v_reason else null end,
    received_weight_kg=v_total_weight,accepted_weight_kg=p_accepted_weight_kg,
    rejected_weight_kg=p_rejected_weight_kg,rejection_reason=case when p_rejected_weight_kg>0 then v_reason else null end,
    completed_at=now(),completed_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id
  where id=p_receipt_id;

  if p_accepted_weight_kg>0 then
    v_gross_cost:=round(p_accepted_weight_kg*v_request.price_per_kg,2);
    if p_supplier_credit_id is not null then
      select * into v_credit
      from public.purchase_return_supplier_credits
      where id=p_supplier_credit_id and tenant_id=v_receipt.tenant_id
      for update;
      if not found or v_credit.decision<>'replacement'
        or v_credit.status not in ('available','partially_used')
        or v_credit.remaining_amount<=0 then
        raise exception 'Kredit Return tidak tersedia untuk Penggantian Barang';
      end if;
      if v_credit.supplier_id<>v_request.supplier_id then
        raise exception 'Kredit Return hanya dapat digunakan untuk Supplier yang sama';
      end if;
      v_credit_applied:=least(v_credit.remaining_amount,v_gross_cost);
    end if;
    v_net_cost:=v_gross_cost-v_credit_applied;

    update public.purchase_requests set status='Selesai',updated_at=now(),updated_by=p_actor_user_id where id=v_request.id;
    insert into public.inventory_lots(
      source_receipt_id,purchase_request_id,supplier_id,inbound_date,project_id,warehouse_id,category_id,
      initial_weight_kg,grade_value,grade_unit,purchase_price_per_kg,total_purchase_cost,created_by
    ) values(
      p_receipt_id,v_request.id,v_request.supplier_id,v_receipt.receipt_date,v_request.project_id,v_request.warehouse_id,v_request.category_id,
      p_accepted_weight_kg,v_receipt.value,v_receipt.value_unit,v_request.price_per_kg,v_gross_cost,p_actor_user_id
    ) returning id,code into v_lot_id,v_lot_code;

    insert into public.inventory_movements(movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_by)
      values('receipt',p_receipt_id,v_lot_id,v_request.project_id,v_request.warehouse_id,v_request.category_id,p_accepted_weight_kg,v_receipt.value,v_receipt.value_unit,p_actor_user_id);

    insert into public.purchase_payment_requests(
      receipt_id,amount,status,requested_by,paid_amount,paid_at,paid_by,payment_method,payment_note,tenant_id
    ) values(
      p_receipt_id,v_net_cost,
      case when v_net_cost=0 then 'Lunas' else 'Menunggu Pembayaran' end,
      p_actor_user_id,
      case when v_net_cost=0 then 0 else null end,
      case when v_net_cost=0 then now() else null end,
      case when v_net_cost=0 then p_actor_user_id else null end,
      case when v_net_cost=0 then 'Supplier Credit' else null end,
      case when v_net_cost=0 then 'Dilunasi menggunakan kredit Return Supplier' else null end,
      v_receipt.tenant_id
    ) returning id into v_payment_id;

    update public.purchase_receipts set
      gross_purchase_amount=v_gross_cost,
      supplier_credit_amount=v_credit_applied,
      net_purchase_amount=v_net_cost
    where id=p_receipt_id;

    if v_credit_applied>0 then
      insert into public.purchase_receipt_credit_allocations(
        tenant_id,receipt_id,supplier_credit_id,amount,created_by
      ) values(v_receipt.tenant_id,p_receipt_id,v_credit.id,v_credit_applied,p_actor_user_id);
      update public.purchase_return_supplier_credits
      set remaining_amount=remaining_amount-v_credit_applied,
          status=case when remaining_amount-v_credit_applied<=0.0001 then 'used' else 'partially_used' end
      where id=v_credit.id;
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
      values(p_actor_user_id,'purchase_receipt.credit_applied','purchase_receipt',p_receipt_id::text,
        jsonb_build_object('supplier_credit_id',v_credit.id,'gross_amount',v_gross_cost,
          'credit_applied',v_credit_applied,'net_amount',v_net_cost),v_receipt.tenant_id);
    end if;

    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
      values(p_actor_user_id,'lot.created','inventory_lot',v_lot_id::text,
        jsonb_build_object('code',v_lot_code,'source_receipt_id',p_receipt_id,'initial_weight_kg',p_accepted_weight_kg,
          'grade_value',v_receipt.value,'grade_unit',v_receipt.value_unit,'purchase_price_per_kg',v_request.price_per_kg,
          'total_purchase_cost',v_gross_cost),v_receipt.tenant_id);
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
      values(p_actor_user_id,
        case when v_net_cost=0 then 'purchase_payment.paid' else 'purchase_payment.requested' end,
        'purchase_payment_request',v_payment_id::text,
        jsonb_build_object('receipt_id',p_receipt_id,'gross_amount',v_gross_cost,
          'supplier_credit_amount',v_credit_applied,'amount',v_net_cost),v_receipt.tenant_id);
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
    values(p_actor_user_id,'purchase_receipt.inspected','purchase_receipt',p_receipt_id::text,
      jsonb_build_object('received_weight_kg',v_total_weight,'accepted_weight_kg',p_accepted_weight_kg,
        'rejected_weight_kg',p_rejected_weight_kg,'rejection_reason',case when p_rejected_weight_kg>0 then v_reason else null end,
        'lot_id',v_lot_id,'payment_request_id',v_payment_id,'gross_purchase_amount',v_gross_cost,
        'supplier_credit_amount',v_credit_applied,'net_purchase_amount',v_net_cost),v_receipt.tenant_id);
  return coalesce(v_payment_id,p_receipt_id);
end;
$$;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated',
'expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted',
'expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed',
'fund_request.corrected','fund_request_document.uploaded','purchase_request.created','purchase_receipt.created',
'purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_receipt.cancelled',
'purchase_payment.requested','purchase_payment.paid','purchase_payment.cancelled','purchase_receipt_document.uploaded',
'purchase_payment_document.uploaded','lot.created','lot.marked_problematic','lot.restored_normal','lot.cancelled',
'lot.returned','lot.quarantined','customer.created','customer.updated','sales_draft.created','sales.dispatched',
'sales.finalized','sales.ba_document_uploaded','sales_expense_master.created','sales_expense_master.updated',
'sales.expenses_generated','expense.sales_ba_draft_created','expense.sales_ba_submitted','sales_expense_period.closed',
'sales.settlement_received','sales.invoice_deduction_created','sales.invoice_deduction_updated',
'purchase_return.draft_created','purchase_return.posted','purchase_return.cancelled',
'purchase_return.credit_decision_set','purchase_receipt.credit_applied'
]::text[]));
