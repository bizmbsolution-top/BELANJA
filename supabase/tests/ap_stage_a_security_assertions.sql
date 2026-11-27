-- BELANJA AP Stage A security assertions (read-only).
-- Run ONLY after the AP Stage A migration has been applied to an isolated test DB.
-- This script performs catalog/privilege inspection only. It does not insert,
-- update, delete, or change schema/data.

do $$
declare
  v_count integer;
  v_def text;
  v_policy record;
  v_name text;
  v_signature text;
begin
  -- 1) Required AP tables exist, have RLS, and are not directly accessible
  --    to anon/authenticated. service_role must retain SELECT.
  foreach v_name in array array[
    'expense_items', 'expense_payments', 'expense_payment_evidence'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'FAIL: required table public.% is missing', v_name;
    end if;

    select c.relrowsecurity into v_policy
    from pg_class c
    where c.oid = to_regclass('public.' || v_name);

    if not v_policy.relrowsecurity then
      raise exception 'FAIL: RLS is not enabled on public.%', v_name;
    end if;

    if has_table_privilege('anon', 'public.' || v_name, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_name, 'SELECT') then
      raise exception 'FAIL: anon/authenticated can directly SELECT public.%', v_name;
    end if;

    if has_table_privilege('authenticated', 'public.' || v_name, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || v_name, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || v_name, 'DELETE') then
      raise exception 'FAIL: authenticated has direct write privilege on public.%', v_name;
    end if;

    if not has_table_privilege('service_role', 'public.' || v_name, 'SELECT') then
      raise exception 'FAIL: service_role cannot SELECT public.%', v_name;
    end if;
  end loop;

  -- 2) AP v2 headers are blocked from direct authenticated SELECT and DML
  --    by restrictive policies, while version-1 legacy rows remain eligible.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename = 'expenses'
    and policyname = 'expenses_legacy_only_select'
    and cmd = 'SELECT'
    and not permissive
    and coalesce(qual, '') like '%ap_version%2%';
  if v_count <> 1 then
    raise exception 'FAIL: restrictive expenses_legacy_only_select policy missing or unexpected';
  end if;

  foreach v_name in array array[
    'expenses_legacy_only_insert',
    'expenses_legacy_only_update',
    'expenses_legacy_only_delete'
  ] loop
    select count(*) into v_count
    from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'
      and policyname = v_name
      and not permissive;
    if v_count <> 1 then
      raise exception 'FAIL: expected restrictive policy % is missing', v_name;
    end if;
  end loop;

  -- 3) New AP payment ledger rows cannot be directly written by authenticated.
  foreach v_name in array array[
    'project_cash_ledger_no_direct_ap_payment_insert',
    'project_cash_ledger_no_direct_ap_payment_update',
    'project_cash_ledger_no_direct_ap_payment_delete'
  ] loop
    select count(*) into v_count
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_cash_ledger'
      and policyname = v_name
      and not permissive;
    if v_count <> 1 then
      raise exception 'FAIL: expected restrictive ledger policy % is missing', v_name;
    end if;
  end loop;

  -- 4) Legacy RPCs remain service_role-only and retain version-1 fences.
  foreach v_name in array array[
    'create_expense_draft_with_audit',
    'update_expense_draft_with_audit',
    'submit_expense_with_audit',
    'pay_expense_with_audit',
    'cancel_expense_with_audit',
    'register_expense_payment_document_with_audit'
  ] loop
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
      into v_signature, v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name
    order by p.oid
    limit 1;

    if v_signature is null then
      raise exception 'FAIL: legacy RPC % is missing', v_name;
    end if;

    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'FAIL: anon/authenticated can execute %', v_signature;
    end if;

    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'FAIL: service_role cannot execute %', v_signature;
    end if;

    if v_name = 'create_expense_draft_with_audit' then
      if position('ap_version' in v_def) = 0 or position('1' in v_def) = 0 then
        raise exception 'FAIL: create RPC does not explicitly create legacy version 1';
      end if;
    elsif position('ap_version = 1' in v_def) = 0 then
      raise exception 'FAIL: legacy RPC % has no ap_version = 1 fence', v_name;
    end if;
  end loop;

  -- 5) Legacy default/status and paid-field compatibility constraints survive.
  select column_default into v_def
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'expenses'
    and column_name = 'status';
  if v_def is null or v_def not like '%Aktif%' then
    raise exception 'FAIL: expenses.status default no longer includes Aktif (found: %)', v_def;
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.expenses'::regclass
    and conname = 'expenses_status_check'
    and pg_get_constraintdef(oid) like '%Aktif%'
    and pg_get_constraintdef(oid) like '%Partial%';
  if v_count <> 1 then
    raise exception 'FAIL: expenses_status_check does not preserve Aktif and Partial';
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.expenses'::regclass
    and conname = 'expenses_paid_fields_check';
  if v_count <> 1 then
    raise exception 'FAIL: expenses_paid_fields_check is missing';
  end if;
end;
$$;

-- Human-readable pass summary (all rows should be true / expected values).
select
  'AP v2 tables RLS enabled' as check_name,
  bool_and(c.relrowsecurity) as passed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('expense_items', 'expense_payments', 'expense_payment_evidence')
union all
select
  'Authenticated direct AP table SELECT denied',
  not (
    has_table_privilege('authenticated', 'public.expense_items', 'SELECT')
    or has_table_privilege('authenticated', 'public.expense_payments', 'SELECT')
    or has_table_privilege('authenticated', 'public.expense_payment_evidence', 'SELECT')
  )
union all
select
  'Service role AP table SELECT allowed',
  has_table_privilege('service_role', 'public.expense_items', 'SELECT')
  and has_table_privilege('service_role', 'public.expense_payments', 'SELECT')
  and has_table_privilege('service_role', 'public.expense_payment_evidence', 'SELECT')
union all
select
  'Legacy expenses status default Aktif',
  column_default like '%Aktif%'
from information_schema.columns
where table_schema = 'public' and table_name = 'expenses' and column_name = 'status';
