-- AP Stage B post-migration security assertions.
-- Read-only checks; run after Stage A and Stage B migrations in an approved environment.
do $$
declare
  v_signature regprocedure;
  v_proc record;
  v_constraint text;
begin
  if to_regclass('public.ap_schema_versions') is null then
    raise exception 'AP Stage B marker table is missing';
  end if;
  if not exists (select 1 from public.ap_schema_versions where version='stage_b_draft_v1') then
    raise exception 'AP Stage B marker row is missing';
  end if;
  if to_regclass('public.expense_items') is null then
    raise exception 'AP Stage A expense_items table is missing';
  end if;

  foreach v_signature in array array[
    'public.ap_create_draft_with_audit(uuid,uuid,date,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.ap_update_draft_with_audit(uuid,uuid,uuid,date,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.ap_submit_with_audit(uuid,uuid,uuid)'::regprocedure
  ] loop
    select p.prosecdef, p.proconfig
      into v_proc
    from pg_proc p
    where p.oid = v_signature;
    if not found or v_proc.prosecdef is distinct from true then
      raise exception 'AP RPC % must be SECURITY DEFINER', v_signature;
    end if;
    if not coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, public']::text[] then
      raise exception 'AP RPC % does not have a fixed search_path', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'AP RPC % is exposed to browser roles', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service_role cannot execute AP RPC %', v_signature;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid='public.expense_items'::regclass) then
    raise exception 'RLS must remain enabled on expense_items';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.expenses'::regclass) then
    raise exception 'RLS must remain enabled on expenses';
  end if;

  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid='public.tenant_user_permission_overrides'::regclass
    and conname='tenant_user_permission_overrides_key_check';
  if v_constraint is null
     or position('ap.create_edit' in v_constraint)=0
     or position('ap.submit' in v_constraint)=0 then
    raise exception 'AP permission keys are missing from the tenant permission allow-list';
  end if;

  raise notice 'AP Stage B security assertions passed';
end $$;
