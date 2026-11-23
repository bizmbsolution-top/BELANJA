create table if not exists public.sales_expense_period_closings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  period_month date not null,
  total_paid_amount numeric(18,2) not null default 0 check (total_paid_amount >= 0),
  voucher_count integer not null default 0 check (voucher_count >= 0),
  component_count integer not null default 0 check (component_count >= 0),
  closed_by uuid not null,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sales_expense_period_closings_month_start check (extract(day from period_month) = 1),
  constraint sales_expense_period_closings_project_month_key unique (project_id, period_month)
);

alter table public.sales_expense_period_closings enable row level security;
revoke all on public.sales_expense_period_closings from anon, authenticated;
grant all on public.sales_expense_period_closings to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded',
'project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded','lot.created',
'customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized','sales.ba_document_uploaded',
'sales_expense_master.created','sales_expense_master.updated','sales.expenses_generated','expense.sales_ba_draft_created','expense.sales_ba_submitted',
'sales_expense_period.closed'
]));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document',
'project','fund_request','fund_request_document','purchase_request','purchase_receipt','purchase_payment_request','purchase_receipt_document','purchase_payment_document',
'inventory_lot','customer','sales_order','sales_expense_master','sales_expense_closing'
]));

create or replace function public.close_sales_expense_period(
  p_project_id uuid,
  p_period_month date,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', p_period_month)::date;
  v_next date;
  v_component_count integer;
  v_unsettled_count integer;
  v_paid_count integer;
  v_paid_total numeric(18,2);
  v_closing_id uuid;
begin
  if p_project_id is null or p_actor_user_id is null or p_period_month is null then
    raise exception 'Project, periode, dan Kasir wajib diisi.';
  end if;
  v_next := (v_period + interval '1 month')::date;

  if exists (select 1 from public.sales_expense_period_closings where project_id=p_project_id and period_month=v_period) then
    raise exception 'Periode Project ini sudah pernah di-closing.';
  end if;

  select count(*) into v_component_count
  from public.sales_order_expense_items i
  join public.sales_orders so on so.id=i.sales_order_id
  where so.project_id=p_project_id and so.status='Selesai'
    and so.ba_date>=v_period and so.ba_date<v_next and i.expense_type='company_payable';

  if v_component_count=0 then
    raise exception 'Tidak ada komponen biaya penjualan untuk Project dan periode ini.';
  end if;

  select count(*) into v_unsettled_count
  from public.sales_order_expense_items i
  join public.sales_orders so on so.id=i.sales_order_id
  left join public.expenses e on e.sales_order_expense_item_id=i.id
  where so.project_id=p_project_id and so.status='Selesai'
    and so.ba_date>=v_period and so.ba_date<v_next and i.expense_type='company_payable'
    and (e.id is null or e.status not in ('Dibayar','Dibatalkan'));

  if v_unsettled_count>0 then
    raise exception 'Closing ditolak: masih ada voucher yang belum Paid atau belum memiliki voucher.';
  end if;

  select count(*) filter (where e.status='Dibayar'),
    coalesce(sum(case when e.status='Dibayar' then coalesce(e.paid_amount,e.amount) else 0 end),0)
    into v_paid_count,v_paid_total
  from public.sales_order_expense_items i
  join public.sales_orders so on so.id=i.sales_order_id
  join public.expenses e on e.sales_order_expense_item_id=i.id
  where so.project_id=p_project_id and so.status='Selesai'
    and so.ba_date>=v_period and so.ba_date<v_next and i.expense_type='company_payable';

  insert into public.sales_expense_period_closings
    (project_id,period_month,total_paid_amount,voucher_count,component_count,closed_by)
  values (p_project_id,v_period,v_paid_total,v_paid_count,v_component_count,p_actor_user_id)
  returning id into v_closing_id;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values (p_actor_user_id,'sales_expense_period.closed','sales_expense_closing',v_closing_id::text,
    jsonb_build_object('project_id',p_project_id,'period_month',v_period,'total_paid_amount',v_paid_total,'voucher_count',v_paid_count,'component_count',v_component_count));

  return v_closing_id;
end;
$$;

revoke all on function public.close_sales_expense_period(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.close_sales_expense_period(uuid,date,uuid) to service_role;
