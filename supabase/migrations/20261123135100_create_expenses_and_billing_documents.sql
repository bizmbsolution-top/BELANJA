create sequence if not exists public.expense_transaction_code_seq start with 1 increment by 1;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('XPN-' || lpad(nextval('public.expense_transaction_code_seq'::regclass)::text, 6, '0')),
  expense_date date not null default current_date,
  expense_category_id uuid not null references public.expense_categories(id) on delete restrict,
  description text not null,
  amount numeric(18,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Tunai','Transfer','Kartu','E-Wallet','Lainnya')),
  status text not null default 'Aktif' check (status in ('Aktif','Dibatalkan')),
  cancellation_reason text null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint expenses_description_not_blank check (length(btrim(description)) > 0),
  constraint expenses_cancel_fields_check check (
    (status = 'Aktif' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or
    (status = 'Dibatalkan' and cancelled_at is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
  )
);
create index expenses_date_idx on public.expenses(expense_date desc, created_at desc);
create index expenses_category_idx on public.expenses(expense_category_id);
create index expenses_status_idx on public.expenses(status, expense_date desc);

create table public.expense_documents (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete restrict,
  bucket_id text not null default 'expense-billings',
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid null references auth.users(id) on delete set null
);
create index expense_documents_expense_idx on public.expense_documents(expense_id, uploaded_at);

alter table public.expenses enable row level security;
alter table public.expense_documents enable row level security;
revoke all on table public.expenses, public.expense_documents from public, anon, authenticated, service_role;
grant select, insert, update on table public.expenses to service_role;
grant select, insert, delete on table public.expense_documents to service_role;
revoke all on sequence public.expense_transaction_code_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.expense_transaction_code_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-billings', 'expense-billings', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=excluded.allowed_mime_types;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check(action in(
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated',
'expense.created','expense.cancelled','expense_document.uploaded','expense_document.deleted'));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check(entity_type in(
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document'));

create or replace function public.create_expense_with_audit(
  p_actor_user_id uuid, p_expense_date date, p_expense_category_id uuid,
  p_description text, p_amount numeric, p_payment_method text
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.expenses%rowtype; v_category_name text;
begin
  if p_description is null or length(btrim(p_description))=0 then raise exception 'Description required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Amount must be positive'; end if;
  if p_payment_method not in ('Tunai','Transfer','Kartu','E-Wallet','Lainnya') then raise exception 'Invalid payment method'; end if;
  select name into v_category_name from public.expense_categories where id=p_expense_category_id and is_active=true;
  if not found then raise exception 'Expense category unavailable'; end if;
  insert into public.expenses(expense_date,expense_category_id,description,amount,payment_method,created_by,updated_by)
  values(coalesce(p_expense_date,current_date),p_expense_category_id,btrim(p_description),p_amount,p_payment_method,p_actor_user_id,p_actor_user_id)
  returning * into v_row;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'expense.created','expense',v_row.id::text,
    jsonb_build_object('code',v_row.code,'expense_date',v_row.expense_date,'category',v_category_name,'description',v_row.description,'amount',v_row.amount,'payment_method',v_row.payment_method,'status',v_row.status));
  return v_row.id;
end;$$;

create or replace function public.cancel_expense_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_reason text
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before public.expenses%rowtype;
begin
  if p_reason is null or length(btrim(p_reason))=0 then raise exception 'Cancellation reason required'; end if;
  select * into v_before from public.expenses where id=p_expense_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_before.status <> 'Aktif' then raise exception 'Expense already cancelled'; end if;
  update public.expenses set status='Dibatalkan', cancellation_reason=btrim(p_reason),
    cancelled_at=now(),cancelled_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id
  where id=p_expense_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,'expense.cancelled','expense',p_expense_id::text,
    jsonb_build_object('code',v_before.code,'status',v_before.status,'amount',v_before.amount),
    jsonb_build_object('code',v_before.code,'status','Dibatalkan','reason',btrim(p_reason)));
end;$$;

create or replace function public.register_expense_document_with_audit(
  p_expense_id uuid,p_actor_user_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint
) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_id uuid; v_code text;
begin
  select code into v_code from public.expenses where id=p_expense_id;
  if not found then raise exception 'Expense not found'; end if;
  insert into public.expense_documents(expense_id,storage_path,file_name,mime_type,file_size,uploaded_by)
  values(p_expense_id,p_storage_path,p_file_name,p_mime_type,p_file_size,p_actor_user_id)
  returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'expense_document.uploaded','expense_document',v_id::text,
    jsonb_build_object('expense_code',v_code,'file_name',p_file_name,'mime_type',p_mime_type,'file_size',p_file_size));
  return v_id;
end;$$;

create or replace function public.delete_expense_document_with_audit(
  p_document_id uuid,p_actor_user_id uuid
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_doc public.expense_documents%rowtype; v_code text;
begin
  select * into v_doc from public.expense_documents where id=p_document_id for update;
  if not found then raise exception 'Expense document not found'; end if;
  select code into v_code from public.expenses where id=v_doc.expense_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data)
  values(p_actor_user_id,'expense_document.deleted','expense_document',v_doc.id::text,
    jsonb_build_object('expense_code',v_code,'file_name',v_doc.file_name,'mime_type',v_doc.mime_type,'file_size',v_doc.file_size));
  delete from public.expense_documents where id=p_document_id;
end;$$;

revoke all on function public.create_expense_with_audit(uuid,date,uuid,text,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.create_expense_with_audit(uuid,date,uuid,text,numeric,text) to service_role;
revoke all on function public.cancel_expense_with_audit(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.cancel_expense_with_audit(uuid,uuid,text) to service_role;
revoke all on function public.register_expense_document_with_audit(uuid,uuid,text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.register_expense_document_with_audit(uuid,uuid,text,text,text,bigint) to service_role;
revoke all on function public.delete_expense_document_with_audit(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_expense_document_with_audit(uuid,uuid) to service_role;
