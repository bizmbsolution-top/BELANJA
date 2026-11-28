-- AP ownership update: Cashier owns Project expenses; Finance no longer operates AP.
-- Additive security migration. Existing AP data and legacy voucher RPCs remain untouched.
begin;

create or replace function public._assert_ap_actor(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_project_id uuid,
  p_permission text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_role text;
  v_roles text[];
  v_profile_active boolean;
  v_tenant_status text;
  v_scope_mode text;
  v_resource_ids text[];
begin
  if p_actor_user_id is null or p_tenant_id is null or p_project_id is null then
    raise exception 'AP access context is incomplete';
  end if;
  if p_permission not in ('ap.create_edit', 'ap.submit') then
    raise exception 'AP permission is invalid';
  end if;

  select m.tenant_role, p.roles, p.is_active, t.status
    into v_tenant_role, v_roles, v_profile_active, v_tenant_status
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.tenant_user_access_profiles p
    on p.tenant_id = m.tenant_id and p.user_id = m.user_id
  where m.user_id = p_actor_user_id
    and m.tenant_id = p_tenant_id
    and m.is_active = true
  for share of m, t, p;

  if not found or v_profile_active is distinct from true or v_tenant_status <> 'active' then
    raise exception 'AP actor or tenant is inactive';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception 'Project is unavailable in the active tenant';
  end if;

  if v_tenant_role = 'superadmin' then
    return;
  end if;

  if not ('Cashier' = any(coalesce(v_roles, '{}'::text[]))) then
    raise exception 'Cashier role is required for AP';
  end if;

  if not exists (
    select 1 from public.tenant_user_permission_overrides
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and permission_key = p_permission
      and effect = 'allow'
  ) then
    raise exception 'Explicit AP permission is required';
  end if;

  select scope_mode, resource_ids
    into v_scope_mode, v_resource_ids
  from public.tenant_user_work_scopes
  where tenant_id = p_tenant_id
    and user_id = p_actor_user_id
    and dimension = 'project';

  if not found or v_scope_mode = 'none' then
    raise exception 'Project work scope does not permit AP access';
  end if;
  if v_scope_mode = 'selected'
     and not (p_project_id::text = any(coalesce(v_resource_ids, '{}'::text[]))) then
    raise exception 'Project is outside the actor work scope';
  end if;
  if v_scope_mode not in ('all', 'selected') then
    raise exception 'Project work scope is invalid';
  end if;
end;
$function$;

commit;
