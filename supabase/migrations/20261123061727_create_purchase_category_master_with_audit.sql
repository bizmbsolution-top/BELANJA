create sequence public.purchase_category_code_seq start with 1 increment by 1;

create table public.purchase_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('KAT-' || lpad(nextval('public.purchase_category_code_seq'::regclass)::text, 6, '0')),
  name text not null,
  description text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint purchase_categories_name_not_blank check (length(btrim(name)) > 0)
);

create unique index purchase_categories_name_lower_uidx on public.purchase_categories (lower(name));
create index purchase_categories_active_name_idx on public.purchase_categories (is_active, name);

alter table public.purchase_categories enable row level security;
revoke all on table public.purchase_categories from public, anon, authenticated, service_role;
grant select, insert, update on table public.purchase_categories to service_role;
revoke all on sequence public.purchase_category_code_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.purchase_category_code_seq to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'user.created', 'user.access_updated', 'user.email_update_requested', 'user.email_updated',
  'user.email_update_failed', 'user.password_reset_requested', 'user.password_reset',
  'user.password_reset_failed', 'supplier.created', 'supplier.updated',
  'purchase_category.created', 'purchase_category.updated'
));

alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (
  entity_type in ('user_access', 'auth_user', 'supplier', 'purchase_category')
);

create or replace function public.create_purchase_category_with_audit(
  p_actor_user_id uuid, p_name text, p_description text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_category public.purchase_categories%rowtype;
begin
  insert into public.purchase_categories (name, description, created_by, updated_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_actor_user_id, p_actor_user_id)
  returning * into v_category;

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
  values (
    p_actor_user_id, 'purchase_category.created', 'purchase_category', v_category.id::text,
    jsonb_build_object('code', v_category.code, 'name', v_category.name,
      'description', v_category.description, 'is_active', v_category.is_active)
  );
  return v_category.id;
end;
$$;

create or replace function public.update_purchase_category_with_audit(
  p_category_id uuid, p_actor_user_id uuid, p_name text, p_description text, p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.purchase_categories%rowtype;
  v_after public.purchase_categories%rowtype;
begin
  select * into v_before from public.purchase_categories where id = p_category_id for update;
  if not found then raise exception 'Purchase category not found'; end if;

  update public.purchase_categories
  set name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      is_active = p_is_active,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = p_category_id
  returning * into v_after;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_user_id, 'purchase_category.updated', 'purchase_category', v_after.id::text,
    jsonb_build_object('code', v_before.code, 'name', v_before.name,
      'description', v_before.description, 'is_active', v_before.is_active),
    jsonb_build_object('code', v_after.code, 'name', v_after.name,
      'description', v_after.description, 'is_active', v_after.is_active)
  );
end;
$$;

revoke all on function public.create_purchase_category_with_audit(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_purchase_category_with_audit(uuid, text, text) to service_role;
revoke all on function public.update_purchase_category_with_audit(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_purchase_category_with_audit(uuid, uuid, text, text, boolean) to service_role;
