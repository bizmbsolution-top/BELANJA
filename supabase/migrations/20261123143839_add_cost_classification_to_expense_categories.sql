begin;

alter table public.expense_categories
  add column if not exists cost_classification text not null default 'flexible';

alter table public.expense_categories
  drop constraint if exists expense_categories_cost_classification_check;
alter table public.expense_categories
  add constraint expense_categories_cost_classification_check
  check (cost_classification = any (array['direct_cost','general_overhead','flexible']));

update public.expense_categories
set cost_classification = case code
  when 'EXP-007' then 'general_overhead'
  when 'EXP-009' then 'direct_cost'
  when 'EXP-010' then 'direct_cost'
  when 'EXP-011' then 'direct_cost'
  when 'EXP-012' then 'direct_cost'
  when 'EXP-013' then 'direct_cost'
  else 'flexible'
end
where code in ('EXP-001','EXP-002','EXP-003','EXP-004','EXP-005','EXP-006','EXP-007','EXP-008','EXP-009','EXP-010','EXP-011','EXP-012','EXP-013');

create or replace function public.create_expense_category_with_audit(
  p_actor_user_id uuid,
  p_name text,
  p_description text,
  p_cost_classification text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.expense_categories%rowtype;
begin
  if p_cost_classification not in ('direct_cost','general_overhead','flexible') then
    raise exception 'Invalid cost classification';
  end if;
  insert into public.expense_categories(name,description,cost_classification,created_by,updated_by)
  values(btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),p_cost_classification,p_actor_user_id,p_actor_user_id)
  returning * into v_row;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'expense_category.created','expense_category',v_row.id::text,
    jsonb_build_object('code',v_row.code,'name',v_row.name,'description',v_row.description,
      'cost_classification',v_row.cost_classification,'is_active',v_row.is_active));
  return v_row.id;
end;
$$;

create or replace function public.update_expense_category_with_audit(
  p_category_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_description text,
  p_is_active boolean,
  p_cost_classification text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.expense_categories%rowtype;
  v_after public.expense_categories%rowtype;
begin
  if p_cost_classification not in ('direct_cost','general_overhead','flexible') then
    raise exception 'Invalid cost classification';
  end if;
  select * into v_before from public.expense_categories where id=p_category_id for update;
  if not found then raise exception 'Expense category not found'; end if;

  update public.expense_categories
  set name=btrim(p_name),
      description=nullif(btrim(coalesce(p_description,'')),''),
      is_active=p_is_active,
      cost_classification=p_cost_classification,
      updated_at=now(),
      updated_by=p_actor_user_id
  where id=p_category_id
  returning * into v_after;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,'expense_category.updated','expense_category',v_after.id::text,
    jsonb_build_object('code',v_before.code,'name',v_before.name,'description',v_before.description,
      'cost_classification',v_before.cost_classification,'is_active',v_before.is_active),
    jsonb_build_object('code',v_after.code,'name',v_after.name,'description',v_after.description,
      'cost_classification',v_after.cost_classification,'is_active',v_after.is_active));
end;
$$;

revoke all on function public.create_expense_category_with_audit(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_expense_category_with_audit(uuid,text,text,text) to service_role;
revoke all on function public.update_expense_category_with_audit(uuid,uuid,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.update_expense_category_with_audit(uuid,uuid,text,text,boolean,text) to service_role;

commit;