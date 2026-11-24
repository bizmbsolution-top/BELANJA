begin;

-- Legacy access tables are no longer the source of truth, but keep their
-- tenant rows protected: only that tenant's active Superadmin may write.
do $legacy_access$
declare
  t text;
begin
  foreach t in array array['user_access_profiles','user_work_scopes','user_permission_overrides'] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_member_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_member_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_member_delete', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
        exists (
          select 1
          from public.tenant_memberships m
          join public.tenants tn on tn.id = m.tenant_id
          where m.user_id = (select auth.uid())
            and m.tenant_id = %I.tenant_id
            and m.is_active = true
            and m.tenant_role = ''superadmin''
            and tn.status = ''active''
        )
      )',
      t || '_tenant_superadmin_insert', t, t
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using (
        exists (
          select 1
          from public.tenant_memberships m
          join public.tenants tn on tn.id = m.tenant_id
          where m.user_id = (select auth.uid())
            and m.tenant_id = %I.tenant_id
            and m.is_active = true
            and m.tenant_role = ''superadmin''
            and tn.status = ''active''
        )
      ) with check (
        exists (
          select 1
          from public.tenant_memberships m
          join public.tenants tn on tn.id = m.tenant_id
          where m.user_id = (select auth.uid())
            and m.tenant_id = %I.tenant_id
            and m.is_active = true
            and m.tenant_role = ''superadmin''
            and tn.status = ''active''
        )
      )',
      t || '_tenant_superadmin_update', t, t, t
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using (
        exists (
          select 1
          from public.tenant_memberships m
          join public.tenants tn on tn.id = m.tenant_id
          where m.user_id = (select auth.uid())
            and m.tenant_id = %I.tenant_id
            and m.is_active = true
            and m.tenant_role = ''superadmin''
            and tn.status = ''active''
        )
      )',
      t || '_tenant_superadmin_delete', t, t, t
    );
  end loop;
end
$legacy_access$;

-- The tenant-scoped access tables remain the live source of truth.
-- Require the tenant itself to be active as well as its Superadmin membership.
drop policy if exists tenant_user_access_profiles_admin_write on public.tenant_user_access_profiles;
create policy tenant_user_access_profiles_admin_write
on public.tenant_user_access_profiles
for all to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_access_profiles.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_access_profiles.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
);

drop policy if exists tenant_user_work_scopes_admin_write on public.tenant_user_work_scopes;
create policy tenant_user_work_scopes_admin_write
on public.tenant_user_work_scopes
for all to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_work_scopes.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_work_scopes.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
);

drop policy if exists tenant_user_permission_overrides_admin_write on public.tenant_user_permission_overrides;
create policy tenant_user_permission_overrides_admin_write
on public.tenant_user_permission_overrides
for all to authenticated
using (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_permission_overrides.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
)
with check (
  exists (
    select 1
    from public.tenant_memberships m
    join public.tenants tn on tn.id = m.tenant_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = tenant_user_permission_overrides.tenant_id
      and m.is_active = true
      and m.tenant_role = 'superadmin'
      and tn.status = 'active'
  )
);

-- Audit history is append-only for tenant users.
drop policy if exists audit_logs_tenant_member_update on public.audit_logs;
drop policy if exists audit_logs_tenant_member_delete on public.audit_logs;

-- rls_auto_enable is only called by its installed DDL event trigger.
-- It must not be exposed as an ordinary PostgREST RPC.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Anonymous clients do not need direct access to tenant identity or access-control data.
-- Keep authenticated SELECT/DML grants as required by existing RLS policies, but
-- remove non-row-scoped table powers which RLS cannot constrain.
do $privileges$
declare
  t text;
begin
  foreach t in array array[
    'tenants','tenant_memberships',
    'tenant_user_access_profiles','tenant_user_work_scopes','tenant_user_permission_overrides',
    'user_access_profiles','user_work_scopes','user_permission_overrides','audit_logs'
  ] loop
    execute format('revoke all privileges on table public.%I from anon', t);
    execute format('revoke truncate, references, trigger, maintain on table public.%I from authenticated', t);
  end loop;
end
$privileges$;

commit;
