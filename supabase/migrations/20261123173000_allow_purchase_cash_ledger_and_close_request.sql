alter table public.project_cash_ledger
  drop constraint if exists project_cash_ledger_source_check;

alter table public.project_cash_ledger
  add constraint project_cash_ledger_source_check
  check (num_nonnulls(fund_request_id, expense_id, purchase_payment_request_id) = 1);

create or replace function public.complete_purchase_receipt_with_audit(
  p_receipt_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
set search_path='public','pg_temp'
as $$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_request public.purchase_requests%rowtype;
  v_payment_id uuid;
  v_weight_kg numeric;
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if not found or v_receipt.status<>'Draft' then raise exception 'Receipt is not editable'; end if;
  if p_decision not in ('Diterima','Ditolak') then raise exception 'Invalid decision'; end if;
  if p_decision='Ditolak' and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Rejection reason required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='weight') then raise exception 'Weight evidence required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='value') then raise exception 'Value evidence required'; end if;
  select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id for update;
  if not found or v_request.status<>'Menunggu Barang' then raise exception 'Purchase request is not open'; end if;

  update public.purchase_receipts
  set status=p_decision, decision_reason=case when p_decision='Ditolak' then left(btrim(p_reason),1000) else null end,
      completed_at=now(), completed_by=p_actor_user_id, updated_at=now(), updated_by=p_actor_user_id
  where id=p_receipt_id;

  if p_decision='Diterima' then
    v_weight_kg:=case when v_receipt.weight_unit='ton' then v_receipt.weight*1000 else v_receipt.weight end;
    update public.purchase_requests set status='Selesai',updated_at=now(),updated_by=p_actor_user_id where id=v_request.id;
    insert into public.inventory_movements(movement_type,receipt_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_by)
    values('receipt',p_receipt_id,v_request.project_id,v_request.warehouse_id,v_request.category_id,v_weight_kg,v_receipt.value,v_receipt.value_unit,p_actor_user_id);
    insert into public.purchase_payment_requests(receipt_id,amount,requested_by)
    values(p_receipt_id,round(v_weight_kg*v_request.price_per_kg,2),p_actor_user_id) returning id into v_payment_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.accepted','purchase_receipt',p_receipt_id::text,
      jsonb_build_object('weight_kg',v_weight_kg,'value',v_receipt.value,'payment_request_id',v_payment_id,'payment_amount',round(v_weight_kg*v_request.price_per_kg,2)));
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_payment.requested','purchase_payment_request',v_payment_id::text,
      jsonb_build_object('receipt_id',p_receipt_id,'amount',round(v_weight_kg*v_request.price_per_kg,2)));
  else
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.rejected','purchase_receipt',p_receipt_id::text,jsonb_build_object('reason',left(btrim(p_reason),1000)));
  end if;
  return v_payment_id;
end;
$$;
