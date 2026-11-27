-- Read-only verification for AP Stage A. Run only after the migration is
-- applied to an isolated Supabase preview database.
select
  to_regclass('public.expense_items') is not null as expense_items_exists,
  to_regclass('public.expense_payments') is not null as expense_payments_exists,
  to_regclass('public.expense_payment_evidence') is not null as payment_evidence_exists;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('expense_items', 'expense_payments', 'expense_payment_evidence')
order by c.relname;

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('expense_items', 'expense_payments', 'expense_payment_evidence')
order by tablename, policyname;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.expense_items'::regclass,
  'public.expense_payments'::regclass,
  'public.expense_payment_evidence'::regclass,
  'public.project_cash_ledger'::regclass,
  'public.expenses'::regclass
)
and conname ilike '%tenant%'
order by 1, 2;

-- Must remain zero: one AP item/payment/evidence or ledger entry must not point
-- across tenant boundaries.
select
  (select count(*) from public.expense_items i
    join public.expenses e on e.id = i.expense_id
    where i.tenant_id <> e.tenant_id) as item_parent_mismatch,
  (select count(*) from public.expense_items i
    join public.expense_categories c on c.id = i.expense_category_id
    where i.tenant_id <> c.tenant_id) as item_category_mismatch,
  (select count(*) from public.expense_payments p
    join public.expenses e on e.id = p.expense_id
    where p.tenant_id <> e.tenant_id) as payment_parent_mismatch,
  (select count(*) from public.project_cash_ledger l
    join public.expense_payments p on p.id = l.expense_payment_id
    where l.expense_payment_id is not null and l.tenant_id <> p.tenant_id) as ledger_payment_mismatch;


-- Legacy compatibility fence: run after Stage A is applied in an isolated database.
-- Every legacy mutation RPC must be limited to ap_version = 1. The create RPC
-- must explicitly create version 1. Existing RPCs remain service_role-only.
select
  p.oid::regprocedure as function_signature,
  case
    when p.proname = 'create_expense_draft_with_audit'
      then position('ap_version' in pg_get_functiondef(p.oid)) > 0
       and position(', 1' in pg_get_functiondef(p.oid)) > 0
    else position('ap_version = 1' in pg_get_functiondef(p.oid)) > 0
  end as version_1_fence_present,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_expense_draft_with_audit',
    'update_expense_draft_with_audit',
    'submit_expense_with_audit',
    'pay_expense_with_audit',
    'cancel_expense_with_audit',
    'register_expense_payment_document_with_audit'
  )
order by p.proname, p.oid::regprocedure::text;
