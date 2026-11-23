create sequence public.warehouse_code_seq start with 1 increment by 1;

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('GDG-' || lpad(nextval('public.warehouse_code_seq'::regclass)::text, 3, '0')),
  name text not null,
  location text null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint warehouses_name_not_blank check (length(btrim(name)) > 0)
);

create unique index warehouses_name_lower_uidx on public.warehouses (lower(name));
create index warehouses_active_name_idx on public.warehouses (is_active, name);

alter table public.warehouses enable row level security;
revoke all on table public.warehouses from public, anon, authenticated, service_role;
grant select, insert, update on table public.warehouses to service_role;
revoke all on sequence public.warehouse_code_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.warehouse_code_seq to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'user.created', 'user.access_updated', 'user.email_update_requested', 'user.email_updated',
  'user.email_update_failed', 'user.password_reset_requested', 'user.password_reset',
  'user.password_reset_failed', 'supplier.created', 'supplier.updated',
  'purchase_category.created', 'purchase_category.updated',
  'warehouse.created', 'warehouse.updated'
));

alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (
  entity_type in ('user_access', 'auth_user', 'supplier', 'purchase_category', 'warehouse')
);

create or replace function public.create_warehouse_with_audit(
  p_actor_user_id uuid, p_name text, p_location text, p_description text
)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_warehouse public.warehouses%rowtype;
begin
  insert into public.warehouses (name, location, description, created_by, updated_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_location, '')), ''),
    nullif(btrim(coalesce(p_description, '')), ''), p_actor_user_id, p_actor_user_id)
  returning * into v_warehouse;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
  values (p_actor_user_id, 'warehouse.created', 'warehouse', v_warehouse.id::text,
    jsonb_build_object('code', v_warehouse.code, 'name', v_warehouse.name,
      'location', v_warehouse.location, 'description', v_warehouse.description, 'is_active', v_warehouse.is_active));
  return v_warehouse.id;
end;
$$;

create or replace function public.update_warehouse_with_audit(
  p_warehouse_id uuid, p_actor_user_id uuid, p_name text, p_location text,
  p_description text, p_is_active boolean
)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_before public.warehouses%rowtype; v_after public.warehouses%rowtype;
begin
  select * into v_before from public.warehouses where id = p_warehouse_id for update;
  if not found then raise exception 'Warehouse not found'; end if;
  update public.warehouses
  set name = btrim(p_name), location = nullif(btrim(coalesce(p_location, '')), ''),
      description = nullif(btrim(coalesce(p_description, '')), ''), is_active = p_is_active,
      updated_at = now(), updated_by = p_actor_user_id
  where id = p_warehouse_id returning * into v_after;
  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_user_id, 'warehouse.updated', 'warehouse', v_after.id::text,
    jsonb_build_object('code', v_before.code, 'name', v_before.name, 'location', v_before.location,
      'description', v_before.description, 'is_active', v_before.is_active),
    jsonb_build_object('code', v_after.code, 'name', v_after.name, 'location', v_after.location,
      'description', v_after.description, 'is_active', v_after.is_active));
end;
$$;

revoke all on function public.create_warehouse_with_audit(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_warehouse_with_audit(uuid, text, text, text) to service_role;
revoke all on function public.update_warehouse_with_audit(uuid, uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_warehouse_with_audit(uuid, uuid, text, text, text, boolean) to service_role;
