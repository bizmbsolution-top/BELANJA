-- Read-only preflight for AP Stage A.
-- Run against the target database BEFORE applying the AP migration.
-- All mismatch counters below must be zero.

select
  (select count(*) from public.expenses e
    join public.expense_categories c on c.id = e.expense_category_id
    where e.tenant_id <> c.tenant_id) as expense_category_tenant_mismatch,
  (select count(*) from public.expenses e
    join public.projects p on p.id = e.project_id
    where e.project_id is not null and e.tenant_id <> p.tenant_id) as expense_project_tenant_mismatch,
  (select count(*) from public.expenses e
    join public.sales_orders s on s.id = e.sales_order_id
    where e.sales_order_id is not null and e.tenant_id <> s.tenant_id) as expense_ba_tenant_mismatch,
  (select count(*) from public.project_cash_ledger l
    join public.projects p on p.id = l.project_id
    where l.tenant_id <> p.tenant_id) as ledger_project_tenant_mismatch,
  (select count(*) from public.project_cash_ledger l
    join public.expenses e on e.id = l.expense_id
    where l.expense_id is not null and l.tenant_id <> e.tenant_id) as ledger_expense_tenant_mismatch;

-- Review current statuses and legacy payment invariants before adding AP v2.
select status, count(*) as row_count,
       count(*) filter (where paid_amount is not null) as rows_with_paid_amount
from public.expenses
group by status
order by status;

-- Confirm current constraints exist under the names the migration replaces.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.expenses'::regclass
  and conname in ('expenses_status_check', 'expenses_paid_fields_check')
order by conname;

-- Confirm current cashier ledger source invariant.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.project_cash_ledger'::regclass
  and conname = 'project_cash_ledger_source_check';
