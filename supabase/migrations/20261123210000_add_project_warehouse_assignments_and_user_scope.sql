create table if not exists public.warehouse_projects (
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (warehouse_id, project_id)
);
create index if not exists warehouse_projects_project_idx on public.warehouse_projects(project_id, warehouse_id);
alter table public.warehouse_projects enable row level security;
revoke all on public.warehouse_projects from anon, authenticated;
grant all on public.warehouse_projects to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated',
'expense.submitted','expense.paid','expense.cancelled','expense_document.uploaded','expense_document.deleted',
'expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed',
'fund_request.corrected','fund_request_document.uploaded'
]::text[]));

create or replace function public.set_warehouse_projects_with_audit(
 p_actor_user_id uuid, p_warehouse_id uuid, p_project_ids uuid[]
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before jsonb; v_after jsonb;
begin
 if p_actor_user_id is null or p_warehouse_id is null or p_project_ids is null then raise exception 'Required values are missing.'; end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and is_active) then raise exception 'Warehouse is unavailable or inactive.'; end if;
 if exists(select 1 from unnest(p_project_ids) x left join public.projects p on p.id=x where p.id is null or not p.is_active) then raise exception 'Selected Project is unavailable or inactive.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('project_id',project_id) order by project_id),'[]'::jsonb) into v_before
 from public.warehouse_projects where warehouse_id=p_warehouse_id;
 delete from public.warehouse_projects where warehouse_id=p_warehouse_id;
 insert into public.warehouse_projects(warehouse_id,project_id,created_by)
 select p_warehouse_id,x,p_actor_user_id from (select distinct unnest(p_project_ids) x) s;
 select coalesce(jsonb_agg(jsonb_build_object('project_id',project_id) order by project_id),'[]'::jsonb) into v_after
 from public.warehouse_projects where warehouse_id=p_warehouse_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,'warehouse.projects_updated','warehouse',p_warehouse_id::text,v_before,v_after);
end; $$;
revoke all on function public.set_warehouse_projects_with_audit(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.set_warehouse_projects_with_audit(uuid,uuid,uuid[]) to service_role;

create or replace function public.save_user_access_profile_with_audit(
 p_actor_user_id uuid,p_target_user_id uuid,p_roles text[],p_is_active boolean,
 p_scopes jsonb,p_permissions jsonb,p_project_ids uuid[],p_warehouse_ids uuid[]
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before jsonb; v_after jsonb; v_mode text; v_project_mode text;
begin
 if p_warehouse_ids is null then raise exception 'Warehouse IDs are required.'; end if;
 v_mode:=p_scopes->>'warehouse';
 v_project_mode:=p_scopes->>'project';
 if v_mode not in ('none','all','selected') then raise exception 'Invalid Warehouse scope mode.'; end if;
 if v_mode='selected' and cardinality(p_warehouse_ids)=0 then raise exception 'Select at least one Warehouse.'; end if;
 if v_mode<>'selected' and cardinality(p_warehouse_ids)>0 then raise exception 'Warehouse IDs supplied for a non-selected scope.'; end if;
 if v_mode='selected' then
   if v_project_mode='none' then raise exception 'Select a Project before selecting Warehouse.'; end if;
   if exists (
     select 1 from unnest(p_warehouse_ids) w(id)
     left join public.warehouses wh on wh.id=w.id and wh.is_active
     where wh.id is null
       or (v_project_mode='selected' and not exists (
          select 1 from public.warehouse_projects wp
          where wp.warehouse_id=w.id and wp.project_id=any(p_project_ids)
       ))
       or (v_project_mode='all' and not exists (
          select 1 from public.warehouse_projects wp where wp.warehouse_id=w.id
       ))
   ) then raise exception 'Selected Warehouse is not assigned to the selected Project.'; end if;
 end if;
 select coalesce((select jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))
   from public.user_work_scopes where user_id=p_target_user_id and dimension='warehouse'),'{"scope_mode":"none","resource_ids":[]}'::jsonb)
 into v_before;
 perform public.save_user_access_profile_with_audit(
   p_actor_user_id,p_target_user_id,p_roles,p_is_active,
   jsonb_set(p_scopes,'{warehouse}','"none"'::jsonb),p_permissions,p_project_ids
 );
 if v_mode='none' then
   delete from public.user_work_scopes where user_id=p_target_user_id and dimension='warehouse';
 elsif v_mode='all' then
   insert into public.user_work_scopes(user_id,dimension,scope_mode,resource_ids,created_by,updated_by)
   values(p_target_user_id,'warehouse','all','{}'::text[],p_actor_user_id,p_actor_user_id)
   on conflict(user_id,dimension) do update set scope_mode='all',resource_ids='{}'::text[],updated_at=now(),updated_by=p_actor_user_id;
 else
   insert into public.user_work_scopes(user_id,dimension,scope_mode,resource_ids,created_by,updated_by)
   values(p_target_user_id,'warehouse','selected',array(select unnest(p_warehouse_ids)::text),p_actor_user_id,p_actor_user_id)
   on conflict(user_id,dimension) do update set scope_mode='selected',resource_ids=excluded.resource_ids,updated_at=now(),updated_by=p_actor_user_id;
 end if;
 select coalesce((select jsonb_build_object('scope_mode',scope_mode,'resource_ids',to_jsonb(resource_ids))
   from public.user_work_scopes where user_id=p_target_user_id and dimension='warehouse'),'{"scope_mode":"none","resource_ids":[]}'::jsonb)
 into v_after;
 insert into public.audit_logs(actor_user_id,target_user_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_user_id,p_target_user_id,'user.access_updated','user_access',p_target_user_id::text,
 jsonb_build_object('warehouse',v_before),jsonb_build_object('warehouse',v_after));
end; $$;
revoke all on function public.save_user_access_profile_with_audit(uuid,uuid,text[],boolean,jsonb,jsonb,uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.save_user_access_profile_with_audit(uuid,uuid,text[],boolean,jsonb,jsonb,uuid[],uuid[]) to service_role;
