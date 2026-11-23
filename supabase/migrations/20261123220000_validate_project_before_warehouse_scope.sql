create or replace function public.validate_user_warehouse_scope()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_project_mode text; v_project_ids text[];
begin
  if new.dimension <> 'warehouse' then return new; end if;
  select scope_mode, resource_ids into v_project_mode, v_project_ids
  from public.user_work_scopes
  where user_id=new.user_id and dimension='project';
  if not found then
    raise exception 'Select a Project before assigning Warehouse access.';
  end if;
  if new.scope_mode='selected' then
    if v_project_mode='selected' and exists (
      select 1 from unnest(new.resource_ids) wid
      where not exists (
        select 1 from public.warehouse_projects wp
        where wp.warehouse_id::text=wid and wp.project_id::text=any(v_project_ids)
      )
    ) then
      raise exception 'Selected Warehouse is not assigned to the selected Project.';
    end if;
    if v_project_mode='all' and exists (
      select 1 from unnest(new.resource_ids) wid
      where not exists (select 1 from public.warehouse_projects wp where wp.warehouse_id::text=wid)
    ) then
      raise exception 'Selected Warehouse has no Project assignment.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists user_work_scopes_validate_warehouse on public.user_work_scopes;
create trigger user_work_scopes_validate_warehouse
before insert or update on public.user_work_scopes
for each row execute function public.validate_user_warehouse_scope();
revoke all on function public.validate_user_warehouse_scope() from public,anon,authenticated,service_role;
