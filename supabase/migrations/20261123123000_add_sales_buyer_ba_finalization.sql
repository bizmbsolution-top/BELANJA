create table if not exists public.sales_order_documents (
 id uuid primary key default gen_random_uuid(),
 sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
 document_type text not null default 'buyer_ba' check (document_type='buyer_ba'),
 storage_path text not null unique,
 file_name text not null,
 mime_type text not null,
 file_size bigint not null check (file_size>0 and file_size<=10485760),
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists sales_order_documents_order_idx on public.sales_order_documents(sales_order_id,created_at desc);
alter table public.sales_order_documents enable row level security;
revoke all on public.sales_order_documents from anon,authenticated;
grant all on public.sales_order_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sales-buyer-ba-evidence','sales-buyer-ba-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created','customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized','sales.ba_document_uploaded'
]));
create or replace function public.finalize_sales_order_with_audit(
 p_sales_order_id uuid,p_actor_user_id uuid,p_received_weight_kg numeric,
 p_final_grade_value numeric,p_final_grade_unit text,p_final_price_per_kg numeric,
 p_ba_number text,p_ba_date date,p_discrepancy_notes text
) returns uuid
language plpgsql
set search_path='public','pg_temp'
as $function$
declare v_order public.sales_orders%rowtype; v_cost numeric; v_amount numeric;
begin
 select * into v_order from public.sales_orders where id=p_sales_order_id for update;
 if not found then raise exception 'Sales order not found'; end if;
 if v_order.status<>'Dikirim' then raise exception 'Only dispatched sales can be finalized'; end if;
 if p_received_weight_kg is null or p_received_weight_kg<=0 then raise exception 'Invalid buyer received weight'; end if;
 if p_final_grade_value is null or p_final_grade_value<0 or length(btrim(coalesce(p_final_grade_unit,''))) not between 1 and 20 then raise exception 'Invalid final grade'; end if;
 if p_final_price_per_kg is null or p_final_price_per_kg<=0 then raise exception 'Invalid final sale price'; end if;
 if length(btrim(coalesce(p_ba_number,''))) not between 1 and 100 or p_ba_date is null then raise exception 'BA number and date are required'; end if;
 if length(coalesce(p_discrepancy_notes,''))>1000 then raise exception 'Discrepancy notes too long'; end if;
 if not exists(select 1 from public.sales_order_documents where sales_order_id=p_sales_order_id and document_type='buyer_ba') then raise exception 'Buyer BA document is required'; end if;
 select coalesce(sum(allocated_purchase_cost),0) into v_cost from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id;
 v_amount:=round(p_received_weight_kg*p_final_price_per_kg,2);
 update public.sales_orders set status='Selesai',received_weight_kg=p_received_weight_kg,
 final_grade_value=p_final_grade_value,final_grade_unit=btrim(p_final_grade_unit),
 final_price_per_kg=p_final_price_per_kg,final_amount=v_amount,ba_number=btrim(p_ba_number),
 ba_date=p_ba_date,discrepancy_notes=nullif(btrim(coalesce(p_discrepancy_notes,'')),''),
 finalized_at=now(),finalized_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id
 where id=p_sales_order_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'sales.finalized','sales_order',p_sales_order_id::text,
 jsonb_build_object('status','Dikirim','dispatched_weight_kg',v_order.dispatched_weight_kg),
 jsonb_build_object('status','Selesai','received_weight_kg',p_received_weight_kg,
 'final_grade_value',p_final_grade_value,'final_grade_unit',btrim(p_final_grade_unit),
 'final_price_per_kg',p_final_price_per_kg,'final_amount',v_amount,
 'ba_number',btrim(p_ba_number),'ba_date',p_ba_date,'purchase_cost',round(v_cost,2),
 'gross_profit',round(v_amount-v_cost,2),'discrepancy_notes',nullif(btrim(coalesce(p_discrepancy_notes,'')),'')));
 return p_sales_order_id;
end;
$function$;
revoke all on function public.finalize_sales_order_with_audit(uuid,uuid,numeric,numeric,text,numeric,text,date,text) from public,anon,authenticated;
grant execute on function public.finalize_sales_order_with_audit(uuid,uuid,numeric,numeric,text,numeric,text,date,text) to service_role;
