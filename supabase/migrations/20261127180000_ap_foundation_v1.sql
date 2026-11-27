-- AP Stage A: additive foundation for versioned AP documents and cashier installments.
-- Intentionally not applied to any Supabase database by this commit.
begin;

-- Preserve legacy expense rows and behavior. Version 1 remains the existing voucher model;
-- version 2 is the new AP document model.
alter table public.expenses
  add column if not exists recipient_name text,
  add column if not exists ap_version smallint not null default 1;

alter table public.expenses
  add constraint expenses_ap_version_check check (ap_version in (1, 2)),
  add constraint expenses_ap_recipient_check check (
    ap_version = 1 or (recipient_name is not null and length(btrim(recipient_name)) > 0)
  );

-- Composite unique keys allow tenant-safe foreign keys on new relationships.
create unique index if not exists expenses_tenant_id_id_uidx
  on public.expenses (tenant_id, id);
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
    references public.sales_orders (tenant_id, id) on delete restrict;

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

-- New tables are readable only by active members of the owning tenant.
-- Writes will be exposed through audited server-side RPCs in later stages.
alter table public.expense_items enable row level security;
alter table public.expense_payments enable row level security;
alter table public.expense_payment_evidence enable row level security;

drop policy if exists expense_items_tenant_member_select on public.expense_items;
create policy expense_items_tenant_member_select
  on public.expense_items for select to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships m
      join public.tenants tn on tn.id = m.tenant_id
      where m.user_id = (select auth.uid())
        and m.tenant_id = expense_items.tenant_id
        and m.is_active = true
        and tn.status = 'active'
    )
  );

drop policy if exists expense_payments_tenant_member_select on public.expense_payments;
create policy expense_payments_tenant_member_select
  on public.expense_payments for select to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships m
      join public.tenants tn on tn.id = m.tenant_id
      where m.user_id = (select auth.uid())
        and m.tenant_id = expense_payments.tenant_id
        and m.is_active = true
        and tn.status = 'active'
    )
  );

drop policy if exists expense_payment_evidence_tenant_member_select on public.expense_payment_evidence;
create policy expense_payment_evidence_tenant_member_select
  on public.expense_payment_evidence for select to authenticated
  using (
    exists (
      select 1
      from public.tenant_memberships m
      join public.tenants tn on tn.id = m.tenant_id
      where m.user_id = (select auth.uid())
        and m.tenant_id = expense_payment_evidence.tenant_id
        and m.is_active = true
        and tn.status = 'active'
    )
  );

revoke all on public.expense_items, public.expense_payments, public.expense_payment_evidence
  from anon, authenticated;
grant select on public.expense_items, public.expense_payments, public.expense_payment_evidence
  to authenticated;
grant all on public.expense_items, public.expense_payments, public.expense_payment_evidence
  to service_role;

-- Keep legacy voucher checks unchanged in meaning while allowing AP v2 partial payments.
alter table public.expenses
  drop constraint if exists expenses_status_check,
  add constraint expenses_status_check
    check (status in ('Draft', 'Menunggu Pembayaran', 'Dibayar', 'Dibatalkan', 'Partial'));

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

commit;
