create table if not exists public.expense_payment_documents (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists expense_payment_documents_expense_idx on public.expense_payment_documents(expense_id, uploaded_at);
alter table public.expense_payment_documents enable row level security;
revoke all on public.expense_payment_documents from anon, authenticated;
grant select, insert on public.expense_payment_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('expense-payment-evidence','expense-payment-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','expense_category.created','expense_category.updated','uom.created','uom.updated',
'expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded',
'project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded'
]::text[]));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document','project','fund_request','fund_request_document'
]::text[]));
create or replace function public.register_expense_payment_document_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_file_size bigint
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') or p_file_size <= 0 or p_file_size > 10485760 then raise exception 'Invalid payment evidence file'; end if;
  perform 1 from public.expenses where id=p_expense_id and status='Menunggu Pembayaran' for update;
  if not found then raise exception 'Expense is not awaiting payment'; end if;
  insert into public.expense_payment_documents(expense_id,storage_path,file_name,mime_type,file_size,uploaded_by)
  values(p_expense_id,p_storage_path,left(p_file_name,255),p_mime_type,p_file_size,p_actor_user_id) returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'expense.payment_evidence_uploaded','expense_payment_document',v_id::text,
    jsonb_build_object('expense_id',p_expense_id,'file_name',left(p_file_name,255),'mime_type',p_mime_type,'file_size',p_file_size));
  return v_id;
end; $$;
revoke all on function public.register_expense_payment_document_with_audit(uuid,uuid,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.register_expense_payment_document_with_audit(uuid,uuid,text,text,text,bigint) to service_role;
create or replace function public.pay_expense_with_audit(p_expense_id uuid, p_actor_user_id uuid, p_payment_method text)
returns void language plpgsql set search_path to 'public','pg_temp' as $function$
declare v_row public.expenses%rowtype; v_balance numeric; v_project_code text; v_evidence_count integer;
begin
  select * into v_row from public.expenses where id=p_expense_id for update;
  if not found or v_row.status <> 'Menunggu Pembayaran' then raise exception 'Expense is not awaiting payment'; end if;
  if p_payment_method not in ('Tunai','Transfer') then raise exception 'Invalid payment method'; end if;
  if p_payment_method='Transfer' then
    select count(*) into v_evidence_count from public.expense_payment_documents where expense_id=p_expense_id;
    if v_evidence_count < 1 then raise exception 'Transfer payment evidence required'; end if;
  end if;
  perform 1 from public.projects where id=v_row.project_id and is_active=true for update;
  if not found then raise exception 'Project unavailable'; end if;
  select code into v_project_code from public.projects where id=v_row.project_id;
  select coalesce(sum(amount),0) into v_balance from public.project_cash_ledger where project_id=v_row.project_id;
  if v_balance < v_row.amount then raise exception 'Insufficient project cash balance'; end if;
  update public.expenses set status='Dibayar',paid_amount=amount,paid_at=now(),paid_by=p_actor_user_id,paid_method=p_payment_method,
    payment_method=p_payment_method,updated_at=now(),updated_by=p_actor_user_id where id=p_expense_id;
  insert into public.project_cash_ledger(project_id,fund_request_id,expense_id,entry_type,amount,description,created_by)
  values(v_row.project_id,null,p_expense_id,'debit',-v_row.amount,'Pembayaran Expenses '||v_row.code,p_actor_user_id);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,'expense.paid','expense',p_expense_id::text,
    jsonb_build_object('code',v_row.code,'status',v_row.status,'amount',v_row.amount,'project_balance_before',v_balance),
    jsonb_build_object('code',v_row.code,'status','Dibayar','project_id',v_row.project_id,'project_code',v_project_code,
      'paid_amount',v_row.amount,'payment_method',p_payment_method,'payment_evidence_count',case when p_payment_method='Transfer' then v_evidence_count else 0 end,'paid_at',now(),'project_balance_after',v_balance-v_row.amount));
end; $function$;