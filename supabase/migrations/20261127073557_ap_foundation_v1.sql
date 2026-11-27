-- AP Stage A: additive foundation for versioned AP documents and cashier installments.
-- Intentionally not applied to any Supabase database by this commit.
begin;

-- Preserve legacy expense rows and behavior. Version 1 remains the existing voucher model;
-- version 2 is the new AP document model.
alter table public.expenses
  add column if not exists recipient_name text,
  add column if not exists recipient_supplier_id uuid,
  add column if not exists ap_version smallint not null default 1;

alter table public.expenses
  add constraint expenses_ap_version_check check (ap_version in (1, 2)),
  add constraint expenses_ap_recipient_check check (
    ap_version = 1 or (
      recipient_supplier_id is not null
      and recipient_name is not null
      and length(btrim(recipient_name)) > 0
    )
  );

-- Composite unique keys allow tenant-safe foreign keys on new relationships.
create unique index if not exists expenses_tenant_id_id_uidx
  on public.expenses (tenant_id, id);
create unique index if not exists suppliers_tenant_id_id_uidx
  on public.suppliers (tenant_id, id);
create unique index if not exists expense_categories_tenant_id_id_uidx
  on public.expense_categories (tenant_id, id);
create unique index if not exists projects_tenant_id_id_uidx
  on public.projects (tenant_id, id);
create unique index if not exists sales_orders_tenant_id_id_uidx
  on public.sales_orders (tenant_id, id);
create unique index if not exists project_cash_ledger_tenant_id_id_uidx
  on public.project_cash_ledger (tenant_id, id);

-- Existing data was audited for cross-tenant mismatches before this migration.
alter table public.expenses
  add constraint expenses_category_tenant_fk
    foreign key (tenant_id, expense_category_id)
    references public.expense_categories (tenant_id, id) on delete restrict,
  add constraint expenses_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id) on delete restrict,
  add constraint expenses_sales_order_tenant_fk
    foreign key (tenant_id, sales_order_id)
    references public.sales_orders (tenant_id, id) on delete restrict,
  add constraint expenses_recipient_supplier_tenant_fk
    foreign key (tenant_id, recipient_supplier_id)
    references public.suppliers (tenant_id, id) on delete restrict;

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  expense_id uuid not null,
  line_number integer not null check (line_number > 0),
  expense_category_id uuid not null,
  description text not null check (length(btrim(description)) > 0),
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint expense_items_tenant_expense_fk
    foreign key (tenant_id, expense_id)
    references public.expenses (tenant_id, id) on delete restrict,
  constraint expense_items_tenant_category_fk
    foreign key (tenant_id, expense_category_id)
    references public.expense_categories (tenant_id, id) on delete restrict,
  constraint expense_items_tenant_line_unique
    unique (tenant_id, expense_id, line_number)
);

create index if not exists expense_items_expense_idx
  on public.expense_items (tenant_id, expense_id, line_number);
create index if not exists expense_items_category_idx
  on public.expense_items (tenant_id, expense_category_id);

-- Stage A supports cashier-funded installments. Bank payments are added with the
-- dedicated bank-account/movement foundation in Stage D.
create table if not exists public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  expense_id uuid not null,
  payment_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  payment_channel text not null default 'Cashier'
    check (payment_channel = 'Cashier'),
  payment_method text not null default 'Tunai'
    check (payment_method = 'Tunai'),
  cashier_project_id uuid not null,
  payment_reference text,
  notes text,
  status text not null default 'Posted'
    check (status in ('Posted', 'Reversed')),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversal_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint expense_payments_tenant_expense_fk
    foreign key (tenant_id, expense_id)
    references public.expenses (tenant_id, id) on delete restrict,
  constraint expense_payments_tenant_project_fk
    foreign key (tenant_id, cashier_project_id)
    references public.projects (tenant_id, id) on delete restrict,
  constraint expense_payments_reversal_fields_check check (
    (status = 'Posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (status = 'Reversed' and reversed_at is not null and reversed_by is not null
      and length(btrim(coalesce(reversal_reason, ''))) > 0)
  )
);

create index if not exists expense_payments_expense_date_idx
  on public.expense_payments (tenant_id, expense_id, payment_date desc, created_at desc);
create index if not exists expense_payments_project_date_idx
  on public.expense_payments (tenant_id, cashier_project_id, payment_date desc);
create unique index if not exists expense_payments_tenant_id_id_uidx
  on public.expense_payments (tenant_id, id);

-- Each cashier installment has exactly one corresponding ledger debit.
-- Keep all legacy ledger sources intact and add the new fourth source.
alter table public.project_cash_ledger
  add column if not exists expense_payment_id uuid;

alter table public.project_cash_ledger
  drop constraint if exists project_cash_ledger_source_check,
  add constraint project_cash_ledger_source_check
    check (num_nonnulls(fund_request_id, expense_id, purchase_payment_request_id, expense_payment_id) = 1),
  add constraint project_cash_ledger_project_tenant_fk
    foreign key (tenant_id, project_id)
    references public.projects (tenant_id, id) on delete restrict,
  add constraint project_cash_ledger_expense_tenant_fk
    foreign key (tenant_id, expense_id)
    references public.expenses (tenant_id, id) on delete restrict,
  add constraint project_cash_ledger_expense_payment_tenant_fk
    foreign key (tenant_id, expense_payment_id)
    references public.expense_payments (tenant_id, id) on delete restrict;

create unique index if not exists project_cash_ledger_expense_payment_uidx
  on public.project_cash_ledger (tenant_id, expense_payment_id)
  where expense_payment_id is not null;

create table if not exists public.expense_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  expense_payment_id uuid not null,
  object_path text not null check (length(btrim(object_path)) > 0),
  original_file_name text not null check (length(btrim(original_file_name)) > 0),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null,
  constraint expense_payment_evidence_tenant_payment_fk
    foreign key (tenant_id, expense_payment_id)
    references public.expense_payments (tenant_id, id) on delete restrict,
  constraint expense_payment_evidence_object_path_unique
    unique (tenant_id, object_path)
);

create index if not exists expense_payment_evidence_payment_idx
  on public.expense_payment_evidence (tenant_id, expense_payment_id);

-- AP v2 data is served only through trusted server actions/RPCs that enforce
-- tenant membership, role, and Project work scope. Tenant-only SELECT policies
-- would expose cross-Project AP data to authenticated users through the Data API.
-- Keep RLS enabled and deny direct client access until scoped read RPCs are added.
alter table public.expense_items enable row level security;
alter table public.expense_payments enable row level security;
alter table public.expense_payment_evidence enable row level security;

revoke all on public.expense_items, public.expense_payments, public.expense_payment_evidence
  from anon, authenticated;
grant all on public.expense_items, public.expense_payments, public.expense_payment_evidence
  to service_role;

-- Keep legacy voucher checks unchanged in meaning while allowing AP v2 partial payments.
alter table public.expenses
  drop constraint if exists expenses_status_check,
  add constraint expenses_status_check
    check (status in ('Aktif', 'Draft', 'Menunggu Pembayaran', 'Dibayar', 'Dibatalkan', 'Partial'));

alter table public.expenses
  drop constraint if exists expenses_paid_fields_check,
  add constraint expenses_paid_fields_check check (
    (
      ap_version = 1
      and (
        (status = 'Dibayar' and paid_amount = amount and paid_at is not null
          and paid_by is not null and paid_method in ('Tunai', 'Transfer'))
        or
        (status <> 'Dibayar' and paid_amount is null and paid_at is null
          and paid_by is null and paid_method is null)
      )
    )
    or
    (
      ap_version = 2
      and (
        (status = 'Dibayar' and paid_amount = amount and paid_at is not null
          and paid_by is not null and paid_method in ('Tunai', 'Transfer', 'Campuran'))
        or
        (status in ('Draft', 'Menunggu Pembayaran', 'Partial', 'Dibatalkan')
          and paid_amount is null and paid_at is null and paid_by is null and paid_method is null)
      )
    )
  );


-- Prevent authenticated clients from reading AP v2 headers directly.
-- Existing expenses SELECT RLS is tenant-wide; AP v2 reads must go through
-- server actions that additionally enforce Project work scope.
drop policy if exists expenses_legacy_only_select on public.expenses;
create policy expenses_legacy_only_select
  on public.expenses as restrictive for select to authenticated
  using (ap_version <> 2);

-- Prevent authenticated clients from creating/updating AP v2 headers directly.
-- Trusted server-side actions will write these rows through audited operations.
drop policy if exists expenses_legacy_only_insert on public.expenses;
create policy expenses_legacy_only_insert
  on public.expenses as restrictive for insert to authenticated
  with check (ap_version <> 2);

drop policy if exists expenses_legacy_only_update on public.expenses;
create policy expenses_legacy_only_update
  on public.expenses as restrictive for update to authenticated
  using (ap_version <> 2)
  with check (ap_version <> 2);

drop policy if exists expenses_legacy_only_delete on public.expenses;
create policy expenses_legacy_only_delete
  on public.expenses as restrictive for delete to authenticated
  using (ap_version <> 2);

-- The new cashier-payment ledger source is written only by trusted server-side code.
-- Existing fund, expense-voucher, and purchase-payment ledger flows remain unaffected.
drop policy if exists project_cash_ledger_no_direct_ap_payment_insert on public.project_cash_ledger;
create policy project_cash_ledger_no_direct_ap_payment_insert
  on public.project_cash_ledger as restrictive for insert to authenticated
  with check (expense_payment_id is null);

drop policy if exists project_cash_ledger_no_direct_ap_payment_update on public.project_cash_ledger;
create policy project_cash_ledger_no_direct_ap_payment_update
  on public.project_cash_ledger as restrictive for update to authenticated
  using (expense_payment_id is null)
  with check (expense_payment_id is null);

drop policy if exists project_cash_ledger_no_direct_ap_payment_delete on public.project_cash_ledger;
create policy project_cash_ledger_no_direct_ap_payment_delete
  on public.project_cash_ledger as restrictive for delete to authenticated
  using (expense_payment_id is null);


-- Stage A legacy compatibility guard: legacy voucher RPCs may mutate version 1 only.
-- CREATE OR REPLACE preserves the existing function ACLs. These functions remain
-- service_role-only; this change adds a version fence without changing legacy behavior.

create or replace function public.create_expense_draft_with_audit(
  p_actor_user_id uuid, p_expense_date date, p_project_id uuid,
  p_expense_category_id uuid, p_description text, p_amount numeric
) returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.expenses%rowtype;
  v_category_name text;
  v_project_code text;
begin
  if p_description is null or length(btrim(p_description)) = 0 then
    raise exception 'Description required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  select name into v_category_name
  from public.expense_categories
  where id = p_expense_category_id and is_active = true;
  if not found then raise exception 'Expense category unavailable'; end if;
  select code into v_project_code
  from public.projects
  where id = p_project_id and is_active = true;
  if not found then raise exception 'Project unavailable'; end if;

  insert into public.expenses(
    expense_date, project_id, expense_category_id, description, amount,
    payment_method, status, created_by, updated_by, ap_version
  )
  values (
    coalesce(p_expense_date, current_date), p_project_id, p_expense_category_id,
    btrim(p_description), p_amount, 'Transfer', 'Draft',
    p_actor_user_id, p_actor_user_id, 1
  )
  returning * into v_row;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_user_id, 'expense.created', 'expense', v_row.id::text,
    jsonb_build_object(
      'code', v_row.code, 'project_id', p_project_id, 'project_code', v_project_code,
      'expense_date', v_row.expense_date, 'category', v_category_name,
      'description', v_row.description, 'amount', v_row.amount, 'status', 'Draft'
    )
  );
  return v_row.id;
end;
$function$;

create or replace function public.update_expense_draft_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_expense_date date,
  p_project_id uuid, p_expense_category_id uuid, p_description text, p_amount numeric
) returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_before public.expenses%rowtype;
  v_category_name text;
  v_project_code text;
begin
  select * into v_before
  from public.expenses
  where id = p_expense_id and ap_version = 1
  for update;
  if not found or v_before.status <> 'Draft' then
    raise exception 'Only draft expenses can be edited';
  end if;
  if p_description is null or length(btrim(p_description)) = 0
     or p_amount is null or p_amount <= 0 then
    raise exception 'Invalid expense data';
  end if;
  select name into v_category_name
  from public.expense_categories
  where id = p_expense_category_id and is_active = true;
  if not found then raise exception 'Expense category unavailable'; end if;
  select code into v_project_code
  from public.projects
  where id = p_project_id and is_active = true;
  if not found then raise exception 'Project unavailable'; end if;

  update public.expenses
  set expense_date = p_expense_date, project_id = p_project_id,
      expense_category_id = p_expense_category_id, description = btrim(p_description),
      amount = p_amount, updated_at = now(), updated_by = p_actor_user_id
  where id = p_expense_id and ap_version = 1;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_user_id, 'expense.updated', 'expense', p_expense_id::text,
    jsonb_build_object(
      'code', v_before.code, 'project_id', v_before.project_id,
      'category_id', v_before.expense_category_id,
      'description', v_before.description, 'amount', v_before.amount
    ),
    jsonb_build_object(
      'code', v_before.code, 'project_id', p_project_id, 'project_code', v_project_code,
      'category', v_category_name, 'description', btrim(p_description), 'amount', p_amount
    )
  );
end;
$function$;

create or replace function public.submit_expense_with_audit(
  p_expense_id uuid, p_actor_user_id uuid
) returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.expenses%rowtype;
begin
  select * into v_row
  from public.expenses
  where id = p_expense_id and ap_version = 1
  for update;
  if not found or v_row.status <> 'Draft' then
    raise exception 'Expense is not an editable draft';
  end if;
  if v_row.project_id is null then raise exception 'Project required'; end if;

  update public.expenses
  set status = 'Menunggu Pembayaran', submitted_at = now(),
      submitted_by = p_actor_user_id, updated_at = now(), updated_by = p_actor_user_id
  where id = p_expense_id and ap_version = 1;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_user_id, 'expense.submitted', 'expense', p_expense_id::text,
    jsonb_build_object('code', v_row.code, 'status', 'Draft'),
    jsonb_build_object(
      'code', v_row.code, 'status', 'Menunggu Pembayaran',
      'project_id', v_row.project_id, 'amount', v_row.amount
    )
  );
end;
$function$;

create or replace function public.pay_expense_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_payment_method text
) returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.expenses%rowtype;
  v_balance numeric;
  v_project_code text;
  v_evidence_count integer;
begin
  select * into v_row
  from public.expenses
  where id = p_expense_id and ap_version = 1
  for update;
  if not found or v_row.status <> 'Menunggu Pembayaran' then
    raise exception 'Expense is not awaiting payment';
  end if;
  if p_payment_method not in ('Tunai', 'Transfer') then
    raise exception 'Invalid payment method';
  end if;
  if p_payment_method = 'Transfer' then
    select count(*) into v_evidence_count
    from public.expense_payment_documents where expense_id = p_expense_id;
    if v_evidence_count < 1 then raise exception 'Transfer payment evidence required'; end if;
  end if;

  perform 1 from public.projects
  where id = v_row.project_id and is_active = true
  for update;
  if not found then raise exception 'Project unavailable'; end if;
  select code into v_project_code from public.projects where id = v_row.project_id;
  select coalesce(sum(amount), 0) into v_balance
  from public.project_cash_ledger where project_id = v_row.project_id;
  if v_balance < v_row.amount then raise exception 'Insufficient project cash balance'; end if;

  update public.expenses
  set status = 'Dibayar', paid_amount = amount, paid_at = now(),
      paid_by = p_actor_user_id, paid_method = p_payment_method,
      payment_method = p_payment_method, updated_at = now(), updated_by = p_actor_user_id
  where id = p_expense_id and ap_version = 1;

  insert into public.project_cash_ledger(
    project_id, fund_request_id, expense_id, entry_type, amount, description, created_by
  )
  values (
    v_row.project_id, null, p_expense_id, 'debit', -v_row.amount,
    'Pembayaran Expenses ' || v_row.code, p_actor_user_id
  );

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_user_id, 'expense.paid', 'expense', p_expense_id::text,
    jsonb_build_object(
      'code', v_row.code, 'status', v_row.status, 'amount', v_row.amount,
      'project_balance_before', v_balance
    ),
    jsonb_build_object(
      'code', v_row.code, 'status', 'Dibayar', 'project_id', v_row.project_id,
      'project_code', v_project_code, 'paid_amount', v_row.amount,
      'payment_method', p_payment_method,
      'payment_evidence_count', case when p_payment_method = 'Transfer' then v_evidence_count else 0 end,
      'paid_at', now(), 'project_balance_after', v_balance - v_row.amount
    )
  );
end;
$function$;

create or replace function public.cancel_expense_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_reason text
) returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_before public.expenses%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'Cancellation reason required';
  end if;
  select * into v_before
  from public.expenses
  where id = p_expense_id and ap_version = 1
  for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_before.status not in ('Draft', 'Menunggu Pembayaran') then
    raise exception 'Only unpaid expenses can be cancelled';
  end if;

  update public.expenses
  set status = 'Dibatalkan', cancellation_reason = btrim(p_reason),
      cancelled_at = now(), cancelled_by = p_actor_user_id,
      updated_at = now(), updated_by = p_actor_user_id
  where id = p_expense_id and ap_version = 1;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    p_actor_user_id, 'expense.cancelled', 'expense', p_expense_id::text,
    jsonb_build_object('code', v_before.code, 'status', v_before.status, 'amount', v_before.amount),
    jsonb_build_object('code', v_before.code, 'status', 'Dibatalkan', 'reason', btrim(p_reason))
  );
end;
$function$;

create or replace function public.register_expense_payment_document_with_audit(
  p_expense_id uuid, p_actor_user_id uuid, p_storage_path text,
  p_file_name text, p_mime_type text, p_file_size bigint
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png')
     or p_file_size <= 0 or p_file_size > 10485760 then
    raise exception 'Invalid payment evidence file';
  end if;
  perform 1
  from public.expenses
  where id = p_expense_id and status = 'Menunggu Pembayaran' and ap_version = 1
  for update;
  if not found then raise exception 'Expense is not awaiting payment'; end if;

  insert into public.expense_payment_documents(
    expense_id, storage_path, file_name, mime_type, file_size, uploaded_by
  )
  values (
    p_expense_id, p_storage_path, left(p_file_name, 255),
    p_mime_type, p_file_size, p_actor_user_id
  )
  returning id into v_id;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_user_id, 'expense.payment_evidence_uploaded', 'expense_payment_document', v_id::text,
    jsonb_build_object(
      'expense_id', p_expense_id, 'file_name', left(p_file_name, 255),
      'mime_type', p_mime_type, 'file_size', p_file_size
    )
  );
  return v_id;
end;
$function$;

commit;
