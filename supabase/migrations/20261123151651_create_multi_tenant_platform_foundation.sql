begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenants_slug_lower_uidx on public.tenants (lower(slug));

create table if not exists public.platform_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_role text not null default 'member' check (tenant_role in ('superadmin','member')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index if not exists tenant_memberships_user_active_idx on public.tenant_memberships (user_id, is_active);
create index if not exists tenant_memberships_tenant_idx on public.tenant_memberships (tenant_id);

create table if not exists public.tenant_health_snapshots (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  health_status text not null check (health_status in ('healthy','degraded','down','unknown')),
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  app_version text,
  checked_at timestamptz not null default now()
);
create index if not exists tenant_health_snapshots_latest_idx on public.tenant_health_snapshots (tenant_id, checked_at desc);

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  action text not null check (action in ('tenant.created','tenant.status_changed','tenant.admin_invited','tenant.admin_membership_changed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_logs_created_at_idx on public.platform_audit_logs (created_at desc);
create index if not exists platform_audit_logs_tenant_idx on public.platform_audit_logs (tenant_id, created_at desc);

alter table public.tenants enable row level security;
alter table public.platform_owners enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_health_snapshots enable row level security;
alter table public.platform_audit_logs enable row level security;

do $$
declare
  owner_id uuid;
  tenant_id_value uuid;
begin
  select id into owner_id
  from auth.users
  where lower(email) = lower('sentralogis@gmail.com')
  limit 1;

  if owner_id is null then
    raise exception 'Platform Owner auth user sentralogis@gmail.com was not found';
  end if;

  insert into public.platform_owners (user_id, created_by)
  values (owner_id, owner_id)
  on conflict (user_id) do nothing;

  insert into public.tenants (slug, name, status, created_by)
  values ('mbsolutions', 'MBSolutions', 'active', owner_id)
  on conflict (slug) do update
    set name = excluded.name,
        status = excluded.status,
        updated_at = now()
  returning id into tenant_id_value;

  if tenant_id_value is null then
    select id into tenant_id_value from public.tenants where slug = 'mbsolutions';
  end if;

  insert into public.platform_audit_logs (actor_user_id, tenant_id, action, details)
  select owner_id, tenant_id_value, 'tenant.created',
         jsonb_build_object('tenant_name','MBSolutions','source','initial_platform_bootstrap')
  where not exists (
    select 1 from public.platform_audit_logs
    where tenant_id = tenant_id_value and action = 'tenant.created'
      and details->>'source' = 'initial_platform_bootstrap'
  );
end $$;

commit;
