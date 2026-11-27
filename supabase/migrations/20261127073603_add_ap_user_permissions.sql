begin;

-- Extend the existing tenant-scoped individual permission allow-list.
-- Existing permission rows and effects are preserved unchanged.
alter table public.tenant_user_permission_overrides
  drop constraint if exists tenant_user_permission_overrides_key_check;

alter table public.tenant_user_permission_overrides
  add constraint tenant_user_permission_overrides_key_check
  check (permission_key in (
    'transaction.post_recognition',
    'fund_utilization.post_recognition',
    'payment.post',
    'payment.allocate',
    'ap.create_edit',
    'ap.submit'
  ));

-- Keep the existing audited access-profile RPC and add the two AP permission
-- keys to its validation and persistence loops. Execution remains service_role-only.
create or replace function public.save_tenant_user_access_profile_with_audit(
  p_actor_user_id uuid,p_tenant_id uuid,p_target_user_id uuid,p_roles text[],p_is_active boolean,
  p_scopes jsonb,p_permissions jsonb,p_project_ids text[],p_warehouse_ids text[]
) returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_dimension text; v_permission_key text; v_effect text; v_before jsonb; v_after jsonb;
begin
  if p_actor_user_id is null or p_tenant_id is null or p_target_user_id is null then raise exception 'Actor, tenant, and target are required'; end if;
  if not exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id
    where m.user_id=p_actor_user_id and m.tenant_id=p_tenant_id and m.is_active=true and m.tenant_role='superadmin' and t.status='active')
    then raise exception 'Actor is not an active Superadmin of this tenant'; end if;
  if not exists(select 1 from public.tenant_memberships m where m.user_id=p_target_user_id and m.tenant_id=p_tenant_id)
    then raise exception 'Target user is not a member of this tenant'; end if;
  if p_roles is null or not (p_roles <@ array['Procurement','Sales','Cashier','Finance','Warehouse','Management']::text[])
    then raise exception 'Invalid operational roles'; end if;
  if p_scopes is null or jsonb_typeof(p_scopes)<>'object' or p_permissions is null or jsonb_typeof(p_permissions)<>'object'
    then raise exception 'Invalid access payload'; end if;
  foreach v_dimension in array array['project','department','warehouse'] loop
    if coalesce(p_scopes->>v_dimension,'') not in ('none','all','selected') then raise exception 'Invalid scope mode for %',v_dimension; end if;
  end loop;
  if p_scopes->>'department'='selected' then raise exception 'Department selected scope is not supported'; end if;
  if p_scopes->>'project'='selected' then
    if coalesce(cardinality(p_project_ids),0)=0 then raise exception 'At least one Project is required'; end if;
    if exists(select 1 from unnest(p_project_ids) x where not exists(select 1 from public.projects p where p.id::text=x and p.tenant_id=p_tenant_id))
      then raise exception 'Project scope contains a resource from another tenant'; end if;
  elsif coalesce(cardinality(p_project_ids),0)>0 then raise exception 'Project IDs supplied without selected scope'; end if;
  if p_scopes->>'warehouse'='selected' then
    if coalesce(cardinality(p_warehouse_ids),0)=0 then raise exception 'At least one Warehouse is required'; end if;
    if exists(select 1 from unnest(p_warehouse_ids) x where not exists(select 1 from public.warehouses w where w.id::text=x and w.tenant_id=p_tenant_id))
      then raise exception 'Warehouse scope contains a resource from another tenant'; end if;
  elsif coalesce(cardinality(p_warehouse_ids),0)>0 then raise exception 'Warehouse IDs supplied without selected scope'; end if;
  foreach v_permission_key in array array['transaction.post_recognition','fund_utilization.post_recognition','payment.post','payment.allocate','ap.create_edit','ap.submit'] loop
    v_effect:=p_permissions->>v_permission_key;
    if coalesce(v_effect,'') not in ('unset','allow','deny') then raise exception 'Invalid permission effect for %',v_permission_key; end if;
  end loop;
  select jsonb_build_object(
    'roles',(select roles from public.tenant_user_access_profiles where tenant_id=p_tenant_id and user_id=p_target_user_id),
    'is_active',(select is_active from public.tenant_user_access_profiles where tenant_id=p_tenant_id and user_id=p_target_user_id),
    'scopes',coalesce((select jsonb_object_agg(dimension,jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))) from public.tenant_user_work_scopes where tenant_id=p_tenant_id and user_id=p_target_user_id),'{}'::jsonb),
    'permissions',coalesce((select jsonb_object_agg(permission_key,effect) from public.tenant_user_permission_overrides where tenant_id=p_tenant_id and user_id=p_target_user_id),'{}'::jsonb)
  ) into v_before;
  insert into public.tenant_user_access_profiles(tenant_id,user_id,roles,is_active,created_by,updated_by)
  values(p_tenant_id,p_target_user_id,p_roles,p_is_active,p_actor_user_id,p_actor_user_id)
  on conflict(tenant_id,user_id) do update set roles=excluded.roles,is_active=excluded.is_active,updated_at=now(),updated_by=p_actor_user_id;
  foreach v_dimension in array array['project','department','warehouse'] loop
    if p_scopes->>v_dimension='none' then
      delete from public.tenant_user_work_scopes where tenant_id=p_tenant_id and user_id=p_target_user_id and dimension=v_dimension;
    else
      insert into public.tenant_user_work_scopes(tenant_id,user_id,dimension,scope_mode,resource_ids,created_by,updated_by)
      values(p_tenant_id,p_target_user_id,v_dimension,p_scopes->>v_dimension,
        case when v_dimension='project' and p_scopes->>v_dimension='selected' then p_project_ids
             when v_dimension='warehouse' and p_scopes->>v_dimension='selected' then p_warehouse_ids else '{}'::text[] end,
        p_actor_user_id,p_actor_user_id)
      on conflict(tenant_id,user_id,dimension) do update set scope_mode=excluded.scope_mode,resource_ids=excluded.resource_ids,updated_at=now(),updated_by=p_actor_user_id;
    end if;
  end loop;
  foreach v_permission_key in array array['transaction.post_recognition','fund_utilization.post_recognition','payment.post','payment.allocate','ap.create_edit','ap.submit'] loop
    v_effect:=p_permissions->>v_permission_key;
    if v_effect='unset' then
      delete from public.tenant_user_permission_overrides where tenant_id=p_tenant_id and user_id=p_target_user_id and permission_key=v_permission_key;
    else
      insert into public.tenant_user_permission_overrides(tenant_id,user_id,permission_key,effect,created_by,updated_by)
      values(p_tenant_id,p_target_user_id,v_permission_key,v_effect,p_actor_user_id,p_actor_user_id)
      on conflict(tenant_id,user_id,permission_key) do update set effect=excluded.effect,updated_at=now(),updated_by=p_actor_user_id;
    end if;
  end loop;
  select jsonb_build_object(
    'roles',(select roles from public.tenant_user_access_profiles where tenant_id=p_tenant_id and user_id=p_target_user_id),
    'is_active',(select is_active from public.tenant_user_access_profiles where tenant_id=p_tenant_id and user_id=p_target_user_id),
    'scopes',coalesce((select jsonb_object_agg(dimension,jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))) from public.tenant_user_work_scopes where tenant_id=p_tenant_id and user_id=p_target_user_id),'{}'::jsonb),
    'permissions',coalesce((select jsonb_object_agg(permission_key,effect) from public.tenant_user_permission_overrides where tenant_id=p_tenant_id and user_id=p_target_user_id),'{}'::jsonb)
  ) into v_after;
  insert into public.audit_logs(tenant_id,actor_user_id,target_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_tenant_id,p_actor_user_id,p_target_user_id,'user.access_updated','user_access',p_target_user_id::text,v_before,v_after);
end; $$;

revoke all on function public.save_tenant_user_access_profile_with_audit(uuid,uuid,uuid,text[],boolean,jsonb,jsonb,text[],text[]) from public,anon,authenticated;
grant execute on function public.save_tenant_user_access_profile_with_audit(uuid,uuid,uuid,text[],boolean,jsonb,jsonb,text[],text[]) to service_role;

commit;
