begin;
alter table public.expenses
  add column if not exists project_id uuid references public.projects(id) on delete restrict,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists paid_amount numeric,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references auth.users(id) on delete set null,
  add column if not exists paid_method text;
update public.expenses
set status=case when status='Aktif' then 'Dibayar' else status end,
    paid_amount=case when status='Aktif' then amount else paid_amount end,
    paid_at=case when status='Aktif' then created_at else paid_at end,
    paid_by=case when status='Aktif' then created_by else paid_by end,
    paid_method=case when status='Aktif' then payment_method else paid_method end;
alter table public.expenses drop constraint if exists expenses_status_check;
alter table public.expenses drop constraint if exists expenses_cancel_fields_check;
alter table public.expenses add constraint expenses_status_check check(status=any(array['Draft','Menunggu Pembayaran','Dibayar','Dibatalkan']));
alter table public.expenses add constraint expenses_cancel_fields_check check(
(status<>'Dibatalkan' and cancelled_at is null and cancellation_reason is null) or
(status='Dibatalkan' and cancelled_at is not null and cancellation_reason is not null and length(btrim(cancellation_reason))>0));
alter table public.expenses add constraint expenses_paid_fields_check check(
(status='Dibayar' and paid_amount=amount and paid_at is not null and paid_by is not null and paid_method=any(array['Tunai','Transfer'])) or
(status<>'Dibayar' and paid_amount is null and paid_at is null and paid_by is null and paid_method is null));
alter table public.project_cash_ledger alter column fund_request_id drop not null;
alter table public.project_cash_ledger add column if not exists expense_id uuid references public.expenses(id) on delete restrict;
alter table public.project_cash_ledger add constraint project_cash_ledger_source_check check(
(fund_request_id is not null and expense_id is null) or (fund_request_id is null and expense_id is not null));
create unique index if not exists project_cash_ledger_expense_unique on public.project_cash_ledger(expense_id) where expense_id is not null;
create index if not exists expenses_project_status_idx on public.expenses(project_id,status,created_at desc);
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check(action=any(array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','expense_category.created',
'expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid',
'expense.cancelled','expense_document.uploaded','expense_document.deleted','project.created','project.updated',
'fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded']));
create or replace function public.create_expense_draft_with_audit(p_actor_user_id uuid,p_expense_date date,p_project_id uuid,p_expense_category_id uuid,p_description text,p_amount numeric)
returns uuid language plpgsql set search_path to 'public','pg_temp' as $$
declare v_row public.expenses%rowtype; v_category_name text; v_project_code text;
begin
 if p_description is null or length(btrim(p_description))=0 then raise exception 'Description required'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Amount must be positive'; end if;
 select name into v_category_name from public.expense_categories where id=p_expense_category_id and is_active=true;
 if not found then raise exception 'Expense category unavailable'; end if;
 select code into v_project_code from public.projects where id=p_project_id and is_active=true;
 if not found then raise exception 'Project unavailable'; end if;
 insert into public.expenses(expense_date,project_id,expense_category_id,description,amount,payment_method,status,created_by,updated_by)
 values(coalesce(p_expense_date,current_date),p_project_id,p_expense_category_id,btrim(p_description),p_amount,'Transfer','Draft',p_actor_user_id,p_actor_user_id) returning * into v_row;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data) values(p_actor_user_id,'expense.created','expense',v_row.id::text,
 jsonb_build_object('code',v_row.code,'project_id',p_project_id,'project_code',v_project_code,'expense_date',v_row.expense_date,'category',v_category_name,'description',v_row.description,'amount',v_row.amount,'status','Draft'));
 return v_row.id;
end; $$;
create or replace function public.update_expense_draft_with_audit(p_expense_id uuid,p_actor_user_id uuid,p_expense_date date,p_project_id uuid,p_expense_category_id uuid,p_description text,p_amount numeric)
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_before public.expenses%rowtype; v_category_name text; v_project_code text;
begin
 select * into v_before from public.expenses where id=p_expense_id for update;
 if not found or v_before.status<>'Draft' then raise exception 'Only draft expenses can be edited'; end if;
 if p_description is null or length(btrim(p_description))=0 or p_amount is null or p_amount<=0 then raise exception 'Invalid expense data'; end if;
 select name into v_category_name from public.expense_categories where id=p_expense_category_id and is_active=true;
 if not found then raise exception 'Expense category unavailable'; end if;
 select code into v_project_code from public.projects where id=p_project_id and is_active=true;
 if not found then raise exception 'Project unavailable'; end if;
 update public.expenses set expense_date=p_expense_date,project_id=p_project_id,expense_category_id=p_expense_category_id,description=btrim(p_description),amount=p_amount,updated_at=now(),updated_by=p_actor_user_id where id=p_expense_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'expense.updated','expense',p_expense_id::text,
 jsonb_build_object('code',v_before.code,'project_id',v_before.project_id,'category_id',v_before.expense_category_id,'description',v_before.description,'amount',v_before.amount),
 jsonb_build_object('code',v_before.code,'project_id',p_project_id,'project_code',v_project_code,'category',v_category_name,'description',btrim(p_description),'amount',p_amount));
end; $$;
create or replace function public.submit_expense_with_audit(p_expense_id uuid,p_actor_user_id uuid)
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_row public.expenses%rowtype;
begin
 select * into v_row from public.expenses where id=p_expense_id for update;
 if not found or v_row.status<>'Draft' then raise exception 'Expense is not an editable draft'; end if;
 if v_row.project_id is null then raise exception 'Project required'; end if;
 update public.expenses set status='Menunggu Pembayaran',submitted_at=now(),submitted_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id where id=p_expense_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'expense.submitted','expense',p_expense_id::text,
 jsonb_build_object('code',v_row.code,'status','Draft'),jsonb_build_object('code',v_row.code,'status','Menunggu Pembayaran','project_id',v_row.project_id,'amount',v_row.amount));
end; $$;
create or replace function public.pay_expense_with_audit(p_expense_id uuid,p_actor_user_id uuid,p_payment_method text)
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_row public.expenses%rowtype; v_balance numeric; v_project_code text;
begin
 select * into v_row from public.expenses where id=p_expense_id for update;
 if not found or v_row.status<>'Menunggu Pembayaran' then raise exception 'Expense is not awaiting payment'; end if;
 if p_payment_method not in ('Tunai','Transfer') then raise exception 'Invalid payment method'; end if;
 perform 1 from public.projects where id=v_row.project_id and is_active=true for update;
 if not found then raise exception 'Project unavailable'; end if;
 select code into v_project_code from public.projects where id=v_row.project_id;
 select coalesce(sum(amount),0) into v_balance from public.project_cash_ledger where project_id=v_row.project_id;
 if v_balance<v_row.amount then raise exception 'Insufficient project cash balance'; end if;
 update public.expenses set status='Dibayar',paid_amount=amount,paid_at=now(),paid_by=p_actor_user_id,paid_method=p_payment_method,payment_method=p_payment_method,updated_at=now(),updated_by=p_actor_user_id where id=p_expense_id;
 insert into public.project_cash_ledger(project_id,fund_request_id,expense_id,entry_type,amount,description,created_by)
 values(v_row.project_id,null,p_expense_id,'debit',-v_row.amount,'Pembayaran Expenses '||v_row.code,p_actor_user_id);
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'expense.paid','expense',p_expense_id::text,
 jsonb_build_object('code',v_row.code,'status',v_row.status,'amount',v_row.amount,'project_balance_before',v_balance),
 jsonb_build_object('code',v_row.code,'status','Dibayar','project_id',v_row.project_id,'project_code',v_project_code,'paid_amount',v_row.amount,'payment_method',p_payment_method,'paid_at',now(),'project_balance_after',v_balance-v_row.amount));
end; $$;
create or replace function public.cancel_expense_with_audit(p_expense_id uuid,p_actor_user_id uuid,p_reason text)
returns void language plpgsql set search_path to 'public','pg_temp' as $$
declare v_before public.expenses%rowtype;
begin
 if p_reason is null or length(btrim(p_reason))=0 then raise exception 'Cancellation reason required'; end if;
 select * into v_before from public.expenses where id=p_expense_id for update;
 if not found then raise exception 'Expense not found'; end if;
 if v_before.status not in ('Draft','Menunggu Pembayaran') then raise exception 'Only unpaid expenses can be cancelled'; end if;
 update public.expenses set status='Dibatalkan',cancellation_reason=btrim(p_reason),cancelled_at=now(),cancelled_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id where id=p_expense_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'expense.cancelled','expense',p_expense_id::text,
 jsonb_build_object('code',v_before.code,'status',v_before.status,'amount',v_before.amount),jsonb_build_object('code',v_before.code,'status','Dibatalkan','reason',btrim(p_reason)));
end; $$;
create or replace function public.register_expense_document_with_audit(p_expense_id uuid,p_actor_user_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint)
returns uuid language plpgsql set search_path to 'public','pg_temp' as $$
declare v_id uuid; v_code text; v_status text;
begin
 select code,status into v_code,v_status from public.expenses where id=p_expense_id for update;
 if not found or v_status<>'Draft' then raise exception 'Documents can only be added to draft expenses'; end if;
 insert into public.expense_documents(expense_id,storage_path,file_name,mime_type,file_size,uploaded_by) values(p_expense_id,p_storage_path,p_file_name,p_mime_type,p_file_size,p_actor_user_id) returning id into v_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data) values(p_actor_user_id,'expense_document.uploaded','expense_document',v_id::text,jsonb_build_object('expense_code',v_code,'file_name',p_file_name,'mime_type',p_mime_type,'file_size',p_file_size));
 return v_id;
end; $$;
revoke all on function public.create_expense_draft_with_audit(uuid,date,uuid,uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.update_expense_draft_with_audit(uuid,uuid,date,uuid,uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.submit_expense_with_audit(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pay_expense_with_audit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_expense_draft_with_audit(uuid,date,uuid,uuid,text,numeric) to service_role;
grant execute on function public.update_expense_draft_with_audit(uuid,uuid,date,uuid,uuid,text,numeric) to service_role;
grant execute on function public.submit_expense_with_audit(uuid,uuid) to service_role;
grant execute on function public.pay_expense_with_audit(uuid,uuid,text) to service_role;
commit;