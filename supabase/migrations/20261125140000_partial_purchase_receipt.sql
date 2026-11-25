create or replace function public.complete_purchase_receipt_with_split_with_audit(
  p_receipt_id uuid,
  p_actor_user_id uuid,
  p_accepted_weight_kg numeric,
  p_rejected_weight_kg numeric,
  p_rejection_reason text
) returns uuid
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_request public.purchase_requests%rowtype;
  v_payment_id uuid;
  v_lot_id uuid;
  v_lot_code text;
  v_total_weight numeric;
  v_total_cost numeric;
  v_reason text:=left(btrim(coalesce(p_rejection_reason,'')),1000);
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
    v_total_cost:=round(p_accepted_weight_kg*v_request.price_per_kg,2);
    update public.purchase_requests set status='Selesai',updated_at=now(),updated_by=p_actor_user_id where id=v_request.id;
    insert into public.inventory_lots(
      source_receipt_id,purchase_request_id,supplier_id,inbound_date,project_id,warehouse_id,category_id,
      initial_weight_kg,grade_value,grade_unit,purchase_price_per_kg,total_purchase_cost,created_by
    ) values(
      p_receipt_id,v_request.id,v_request.supplier_id,v_receipt.receipt_date,v_request.project_id,v_request.warehouse_id,v_request.category_id,
      p_accepted_weight_kg,v_receipt.value,v_receipt.value_unit,v_request.price_per_kg,v_total_cost,p_actor_user_id
    ) returning id,code into v_lot_id,v_lot_code;
    insert into public.inventory_movements(movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_by)
      values('receipt',p_receipt_id,v_lot_id,v_request.project_id,v_request.warehouse_id,v_request.category_id,p_accepted_weight_kg,v_receipt.value,v_receipt.value_unit,p_actor_user_id);
    insert into public.purchase_payment_requests(receipt_id,amount,requested_by)
      values(p_receipt_id,v_total_cost,p_actor_user_id) returning id into v_payment_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
      values(p_actor_user_id,'lot.created','inventory_lot',v_lot_id::text,
        jsonb_build_object('code',v_lot_code,'source_receipt_id',p_receipt_id,'initial_weight_kg',p_accepted_weight_kg,
          'grade_value',v_receipt.value,'grade_unit',v_receipt.value_unit,'purchase_price_per_kg',v_request.price_per_kg,'total_purchase_cost',v_total_cost),
        v_receipt.tenant_id);
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
      values(p_actor_user_id,'purchase_payment.requested','purchase_payment_request',v_payment_id::text,
        jsonb_build_object('receipt_id',p_receipt_id,'amount',v_total_cost),v_receipt.tenant_id);
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
    values(p_actor_user_id,'purchase_receipt.inspected','purchase_receipt',p_receipt_id::text,
      jsonb_build_object('received_weight_kg',v_total_weight,'accepted_weight_kg',p_accepted_weight_kg,
        'rejected_weight_kg',p_rejected_weight_kg,'rejection_reason',case when p_rejected_weight_kg>0 then v_reason else null end,
        'lot_id',v_lot_id,'payment_request_id',v_payment_id),v_receipt.tenant_id);
  return coalesce(v_payment_id,p_receipt_id);
end; $$;

revoke all on function public.complete_purchase_receipt_with_split_with_audit(uuid,uuid,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.complete_purchase_receipt_with_split_with_audit(uuid,uuid,numeric,numeric,text) to service_role;
