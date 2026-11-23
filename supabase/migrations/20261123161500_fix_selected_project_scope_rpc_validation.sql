create or replace function public.save_user_access_profile_with_audit(
 p_actor_user_id uuid,p_target_user_id uuid,p_roles text[],p_is_active boolean,
 p_scopes jsonb,p_permissions jsonb,p_project_ids uuid[]
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before jsonb; v_after jsonb; v_dimension text; v_scope_mode text; v_permission_key text; v_effect text;
begin
 if p_actor_user_id is null or p_target_user_id is null then raise exception 'Actor and target user are required.'; end if;
 if p_roles is null or p_is_active is null or p_scopes is null or p_permissions is null or p_project_ids is null then raise exception 'All access settings are required.'; end if;
 if exists(select 1 from unnest(p_roles) r where r <> all(array['Procurement','Sales','Cashier','Finance','Warehouse','Management']::text[])) then raise exception 'Invalid operational role.'; end if;
 if jsonb_typeof(p_scopes)<>'object' or jsonb_typeof(p_permissions)<>'object' then raise exception 'Invalid access settings format.'; end if;
 v_scope_mode:=p_scopes->>'project';
 if v_scope_mode not in ('none','all','selected') then raise exception 'Invalid Project scope mode.'; end if;
 if v_scope_mode='selected' then
  if cardinality(p_project_ids)=0 then raise exception 'Select at least one active Project.'; end if;
  if exists(select 1 from unnest(p_project_ids) as selected(project_id) left join public.projects p on p.id=selected.project_id where p.id is null or p.is_active=false) then raise exception 'Selected Project is unavailable or inactive.'; end if;
 elsif cardinality(p_project_ids)>0 then raise exception 'Project IDs supplied for a non-selected scope.'; end if;
 foreach v_dimension in array array['department','warehouse'] loop
  v_scope_mode:=p_scopes->>v_dimension;
  if v_scope_mode not in ('none','all') then raise exception 'Unsupported scope mode for %.',v_dimension; end if;
 end loop;
 foreach v_permission_key in array array['transaction.post_recognition','fund_utilization.post_recognition','payment.post','payment.allocate'] loop
  v_effect:=p_permissions->>v_permission_key;
  if v_effect not in ('unset','allow','deny') then raise exception 'Invalid permission effect for %.',v_permission_key; end if;
 end loop;
 select jsonb_build_object('roles',(select roles from public.user_access_profiles where user_id=p_target_user_id),'is_active',(select is_active from public.user_access_profiles where user_id=p_target_user_id),
 'scopes',coalesce((select jsonb_object_agg(dimension,jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))) from public.user_work_scopes where user_id=p_target_user_id),'{}'::jsonb),
 'permissions',coalesce((select jsonb_object_agg(permission_key,effect) from public.user_permission_overrides where user_id=p_target_user_id),'{}'::jsonb)) into v_before;
 insert into public.user_access_profiles(user_id,roles,is_active,created_by,updated_by) values(p_target_user_id,p_roles,p_is_active,p_actor_user_id,p_actor_user_id)
 on conflict(user_id) do update set roles=excluded.roles,is_active=excluded.is_active,updated_at=now(),updated_by=p_actor_user_id;
 foreach v_dimension in array array['project','department','warehouse'] loop
  v_scope_mode:=p_scopes->>v_dimension;
  if v_scope_mode='none' then delete from public.user_work_scopes where user_id=p_target_user_id and dimension=v_dimension;
  elsif v_dimension='project' and v_scope_mode='selected' then
   insert into public.user_work_scopes(user_id,dimension,scope_mode,resource_ids,created_by,updated_by)
   values(p_target_user_id,'project','selected',array(select selected.project_id::text from unnest(p_project_ids) as selected(project_id)),p_actor_user_id,p_actor_user_id)
   on conflict(user_id,dimension) do update set scope_mode='selected',resource_ids=excluded.resource_ids,updated_at=now(),updated_by=p_actor_user_id;
  else
   insert into public.user_work_scopes(user_id,dimension,scope_mode,resource_ids,created_by,updated_by)
   values(p_target_user_id,v_dimension,'all','{}'::text[],p_actor_user_id,p_actor_user_id)
   on conflict(user_id,dimension) do update set scope_mode='all',resource_ids='{}'::text[],updated_at=now(),updated_by=p_actor_user_id;
  end if;
 end loop;
 foreach v_permission_key in array array['transaction.post_recognition','fund_utilization.post_recognition','payment.post','payment.allocate'] loop
  v_effect:=p_permissions->>v_permission_key;
  if v_effect='unset' then delete from public.user_permission_overrides where user_id=p_target_user_id and permission_key=v_permission_key;
  else insert into public.user_permission_overrides(user_id,permission_key,effect,created_by,updated_by) values(p_target_user_id,v_permission_key,v_effect,p_actor_user_id,p_actor_user_id)
   on conflict(user_id,permission_key) do update set effect=excluded.effect,updated_at=now(),updated_by=p_actor_user_id;
  end if;
 end loop;
 select jsonb_build_object('roles',(select roles from public.user_access_profiles where user_id=p_target_user_id),'is_active',(select is_active from public.user_access_profiles where user_id=p_target_user_id),
 'scopes',coalesce((select jsonb_object_agg(dimension,jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))) from public.user_work_scopes where user_id=p_target_user_id),'{}'::jsonb),
 'permissions',coalesce((select jsonb_object_agg(permission_key,effect) from public.user_permission_overrides where user_id=p_target_user_id),'{}'::jsonb)) into v_after;
 insert into public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,p_target_user_id,'user.access_updated','user_access',p_target_user_id::text,v_before,v_after);
end; $$;
