create sequence public.expense_category_code_seq start with 1 increment by 1;
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('EXP-' || lpad(nextval('public.expense_category_code_seq'::regclass)::text, 3, '0')),
  name text not null, description text null, is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(), updated_by uuid null references auth.users(id) on delete set null,
  constraint expense_categories_name_not_blank check(length(btrim(name))>0)
);
create unique index expense_categories_name_lower_uidx on public.expense_categories(lower(name));
create index expense_categories_active_name_idx on public.expense_categories(is_active,name);
alter table public.expense_categories enable row level security;
revoke all on table public.expense_categories from public,anon,authenticated,service_role;
grant select,insert,update on table public.expense_categories to service_role;
revoke all on sequence public.expense_category_code_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.expense_category_code_seq to service_role;

create sequence public.uom_code_seq start with 1 increment by 1;
create table public.units_of_measure (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default ('UOM-' || lpad(nextval('public.uom_code_seq'::regclass)::text,3,'0')),
 name text not null,symbol text not null,description text null,is_active boolean not null default true,
 created_at timestamptz not null default now(),created_by uuid null references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),updated_by uuid null references auth.users(id) on delete set null,
 constraint units_of_measure_name_not_blank check(length(btrim(name))>0),
 constraint units_of_measure_symbol_not_blank check(length(btrim(symbol))>0)
);
create unique index units_of_measure_name_lower_uidx on public.units_of_measure(lower(name));
create unique index units_of_measure_symbol_lower_uidx on public.units_of_measure(lower(symbol));
create index units_of_measure_active_name_idx on public.units_of_measure(is_active,name);
alter table public.units_of_measure enable row level security;
revoke all on table public.units_of_measure from public,anon,authenticated,service_role;
grant select,insert,update on table public.units_of_measure to service_role;
revoke all on sequence public.uom_code_seq from public,anon,authenticated,service_role;
grant usage,select on sequence public.uom_code_seq to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check(action in(
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
'user.password_reset_requested','user.password_reset','user.password_reset_failed','supplier.created','supplier.updated',
'purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated'));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check(entity_type in(
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom'));

create or replace function public.create_expense_category_with_audit(p_actor_user_id uuid,p_name text,p_description text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.expense_categories%rowtype;
begin
 insert into public.expense_categories(name,description,created_by,updated_by) values(btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),p_actor_user_id,p_actor_user_id) returning * into v_row;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data) values(p_actor_user_id,'expense_category.created','expense_category',v_row.id::text,jsonb_build_object('code',v_row.code,'name',v_row.name,'description',v_row.description,'is_active',v_row.is_active));
 return v_row.id;
end;$$;
create or replace function public.update_expense_category_with_audit(p_category_id uuid,p_actor_user_id uuid,p_name text,p_description text,p_is_active boolean)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before public.expense_categories%rowtype;v_after public.expense_categories%rowtype;
begin
 select * into v_before from public.expense_categories where id=p_category_id for update;
 if not found then raise exception 'Expense category not found';end if;
 update public.expense_categories set name=btrim(p_name),description=nullif(btrim(coalesce(p_description,'')),''),is_active=p_is_active,updated_at=now(),updated_by=p_actor_user_id where id=p_category_id returning * into v_after;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'expense_category.updated','expense_category',v_after.id::text,jsonb_build_object('code',v_before.code,'name',v_before.name,'description',v_before.description,'is_active',v_before.is_active),jsonb_build_object('code',v_after.code,'name',v_after.name,'description',v_after.description,'is_active',v_after.is_active));
end;$$;
create or replace function public.create_uom_with_audit(p_actor_user_id uuid,p_name text,p_symbol text,p_description text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_row public.units_of_measure%rowtype;
begin
 insert into public.units_of_measure(name,symbol,description,created_by,updated_by) values(btrim(p_name),btrim(p_symbol),nullif(btrim(coalesce(p_description,'')),''),p_actor_user_id,p_actor_user_id) returning * into v_row;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data) values(p_actor_user_id,'uom.created','uom',v_row.id::text,jsonb_build_object('code',v_row.code,'name',v_row.name,'symbol',v_row.symbol,'description',v_row.description,'is_active',v_row.is_active));
 return v_row.id;
end;$$;
create or replace function public.update_uom_with_audit(p_uom_id uuid,p_actor_user_id uuid,p_name text,p_symbol text,p_description text,p_is_active boolean)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_before public.units_of_measure%rowtype;v_after public.units_of_measure%rowtype;
begin
 select * into v_before from public.units_of_measure where id=p_uom_id for update;
 if not found then raise exception 'UOM not found';end if;
 update public.units_of_measure set name=btrim(p_name),symbol=btrim(p_symbol),description=nullif(btrim(coalesce(p_description,'')),''),is_active=p_is_active,updated_at=now(),updated_by=p_actor_user_id where id=p_uom_id returning * into v_after;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(p_actor_user_id,'uom.updated','uom',v_after.id::text,jsonb_build_object('code',v_before.code,'name',v_before.name,'symbol',v_before.symbol,'description',v_before.description,'is_active',v_before.is_active),jsonb_build_object('code',v_after.code,'name',v_after.name,'symbol',v_after.symbol,'description',v_after.description,'is_active',v_after.is_active));
end;$$;
revoke all on function public.create_expense_category_with_audit(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_expense_category_with_audit(uuid,text,text) to service_role;
revoke all on function public.update_expense_category_with_audit(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.update_expense_category_with_audit(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.create_uom_with_audit(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_uom_with_audit(uuid,text,text,text) to service_role;
revoke all on function public.update_uom_with_audit(uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.update_uom_with_audit(uuid,uuid,text,text,text,boolean) to service_role;
