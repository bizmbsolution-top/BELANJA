-- Belanja Master Supplier: server-only access with append-only audit events.
create sequence public.supplier_code_seq start with 1 increment by 1;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('SUP-' || lpad(nextval('public.supplier_code_seq'::regclass)::text, 6, '0')),
  name text not null,
  contact_person text null,
  phone text null,
  email text null,
  address text null,
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint suppliers_name_not_blank check (length(btrim(name)) > 0)
);

create index suppliers_name_lower_idx on public.suppliers (lower(name));
create index suppliers_active_name_idx on public.suppliers (is_active, name);

alter table public.suppliers enable row level security;
revoke all on table public.suppliers from public, anon, authenticated, service_role;
grant select, insert, update on table public.suppliers to service_role;
revoke all on sequence public.supplier_code_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.supplier_code_seq to service_role;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'user.created',
  'user.access_updated',
  'user.email_update_requested',
  'user.email_updated',
  'user.email_update_failed',
  'user.password_reset_requested',
  'user.password_reset',
  'user.password_reset_failed',
  'supplier.created',
  'supplier.updated'
));

alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (
  entity_type in ('user_access', 'auth_user', 'supplier')
);

create or replace function public.create_supplier_with_audit(
  p_actor_user_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_supplier public.suppliers%rowtype;
begin
  insert into public.suppliers (
    name, contact_person, phone, email, address, notes, created_by, updated_by
  ) values (
    btrim(p_name),
    nullif(btrim(coalesce(p_contact_person, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into v_supplier;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_actor_user_id,
    'supplier.created',
    'supplier',
    v_supplier.id::text,
    jsonb_build_object(
      'code', v_supplier.code,
      'name', v_supplier.name,
      'contact_person', v_supplier.contact_person,
      'phone', v_supplier.phone,
      'email', v_supplier.email,
      'address', v_supplier.address,
      'notes', v_supplier.notes,
      'is_active', v_supplier.is_active
    )
  );

  return v_supplier.id;
end;
$$;

create or replace function public.update_supplier_with_audit(
  p_supplier_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text,
  p_is_active boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.suppliers%rowtype;
  v_after public.suppliers%rowtype;
begin
  select * into v_before
  from public.suppliers
  where id = p_supplier_id
  for update;

  if not found then
    raise exception 'Supplier not found';
  end if;

  update public.suppliers
  set
    name = btrim(p_name),
    contact_person = nullif(btrim(coalesce(p_contact_person, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    notes = nullif(btrim(coalesce(p_notes, '')), ''),
    is_active = p_is_active,
    updated_at = now(),
    updated_by = p_actor_user_id
  where id = p_supplier_id
  returning * into v_after;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_actor_user_id,
    'supplier.updated',
    'supplier',
    v_after.id::text,
    jsonb_build_object(
      'code', v_before.code,
      'name', v_before.name,
      'contact_person', v_before.contact_person,
      'phone', v_before.phone,
      'email', v_before.email,
      'address', v_before.address,
      'notes', v_before.notes,
      'is_active', v_before.is_active
    ),
    jsonb_build_object(
      'code', v_after.code,
      'name', v_after.name,
      'contact_person', v_after.contact_person,
      'phone', v_after.phone,
      'email', v_after.email,
      'address', v_after.address,
      'notes', v_after.notes,
      'is_active', v_after.is_active
    )
  );
end;
$$;

revoke all on function public.create_supplier_with_audit(uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_supplier_with_audit(uuid, text, text, text, text, text, text) to service_role;

revoke all on function public.update_supplier_with_audit(uuid, uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_supplier_with_audit(uuid, uuid, text, text, text, text, text, text, boolean) to service_role;
