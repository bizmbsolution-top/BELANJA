begin;

-- Additive v2 access model. Legacy access tables remain intact during rollout.
-- Each tenant access row is anchored to an existing tenant membership.

create table if not exists public.tenant_user_access_profiles (
  tenant_id uuid not null,
  user_id uuid not null,
  roles text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_user_access_profiles_pkey primary key (tenant_id, user_id),
  constraint tenant_user_access_profiles_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint tenant_user_access_profiles_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint tenant_user_access_profiles_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint tenant_user_access_profiles_roles_check
    check (roles <@ array['Procurement','Sales','Cashier','Finance','Warehouse','Management']::text[])
);

create table if not exists public.tenant_user_work_scopes (
  tenant_id uuid not null,
  user_id uuid not null,
  dimension text not null,
  scope_mode text not null,
  resource_ids text[] not null default '{}'::text[],
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_user_work_scopes_pkey primary key (tenant_id, user_id, dimension),
  constraint tenant_user_work_scopes_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint tenant_user_work_scopes_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint tenant_user_work_scopes_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint tenant_user_work_scopes_dimension_check
    check (dimension in ('project','department','warehouse')),
  constraint tenant_user_work_scopes_mode_check
    check (
      (scope_mode = 'all' and cardinality(resource_ids) = 0)
      or (scope_mode = 'selected' and cardinality(resource_ids) > 0)
    )
);

create table if not exists public.tenant_user_permission_overrides (
  tenant_id uuid not null,
  user_id uuid not null,
  permission_key text not null,
  effect text not null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_user_permission_overrides_pkey
    primary key (tenant_id, user_id, permission_key),
  constraint tenant_user_permission_overrides_membership_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id)
    on delete cascade,
  constraint tenant_user_permission_overrides_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null,
  constraint tenant_user_permission_overrides_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint tenant_user_permission_overrides_effect_check
    check (effect in ('allow','deny')),
  constraint tenant_user_permission_overrides_key_check
    check (permission_key in (
      'transaction.post_recognition',
      'fund_utilization.post_recognition',
      'payment.post',
      'payment.allocate'
    ))
);

create index if not exists tenant_user_access_profiles_user_idx
  on public.tenant_user_access_profiles (user_id);
create index if not exists tenant_user_work_scopes_user_idx
  on public.tenant_user_work_scopes (user_id);
create index if not exists tenant_user_permission_overrides_user_idx
  on public.tenant_user_permission_overrides (user_id);

-- Backfill tenant profiles only. The Platform Owner row (tenant_id IS NULL)
-- deliberately remains in the legacy table and is not copied.
insert into public.tenant_user_access_profiles
  (tenant_id,user_id,roles,is_active,created_by,updated_by,created_at,updated_at)
select p.tenant_id,p.user_id,p.roles,p.is_active,p.created_by,p.updated_by,p.created_at,p.updated_at
from public.user_access_profiles p
join public.tenant_memberships m
  on m.tenant_id=p.tenant_id and m.user_id=p.user_id
where p.tenant_id is not null
on conflict (tenant_id,user_id) do nothing;

insert into public.tenant_user_work_scopes
  (tenant_id,user_id,dimension,scope_mode,resource_ids,created_by,updated_by,created_at,updated_at)
select s.tenant_id,s.user_id,s.dimension,s.scope_mode,s.resource_ids,
       s.created_by,s.updated_by,s.created_at,s.updated_at
from public.user_work_scopes s
join public.tenant_memberships m
  on m.tenant_id=s.tenant_id and m.user_id=s.user_id
where s.tenant_id is not null
on conflict (tenant_id,user_id,dimension) do nothing;

insert into public.tenant_user_permission_overrides
  (tenant_id,user_id,permission_key,effect,created_by,updated_by,created_at,updated_at)
select p.tenant_id,p.user_id,p.permission_key,p.effect,
       p.created_by,p.updated_by,p.created_at,p.updated_at
from public.user_permission_overrides p
join public.tenant_memberships m
  on m.tenant_id=p.tenant_id and m.user_id=p.user_id
where p.tenant_id is not null
on conflict (tenant_id,user_id,permission_key) do nothing;

-- Fail the migration if any existing tenant access row could not be copied.
do $$
begin
  if exists (
    select 1 from public.user_access_profiles p
    where p.tenant_id is not null
      and not exists (
        select 1 from public.tenant_user_access_profiles n
        where n.tenant_id=p.tenant_id and n.user_id=p.user_id
      )
  ) then
    raise exception 'Tenant access profile backfill incomplete';
  end if;

  if exists (
    select 1 from public.user_work_scopes s
    where s.tenant_id is not null
      and not exists (
        select 1 from public.tenant_user_work_scopes n
        where n.tenant_id=s.tenant_id and n.user_id=s.user_id and n.dimension=s.dimension
      )
  ) then
    raise exception 'Tenant work scope backfill incomplete';
  end if;

  if exists (
    select 1 from public.user_permission_overrides p
    where p.tenant_id is not null
      and not exists (
        select 1 from public.tenant_user_permission_overrides n
        where n.tenant_id=p.tenant_id and n.user_id=p.user_id and n.permission_key=p.permission_key
      )
  ) then
    raise exception 'Tenant permission backfill incomplete';
  end if;
end;
$$;

alter table public.tenant_user_access_profiles enable row level security;
alter table public.tenant_user_work_scopes enable row level security;
alter table public.tenant_user_permission_overrides enable row level security;

drop policy if exists tenant_user_access_profiles_select on public.tenant_user_access_profiles;
create policy tenant_user_access_profiles_select
on public.tenant_user_access_profiles for select to authenticated
using (
  user_id=(select auth.uid())
  or exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_access_profiles.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

drop policy if exists tenant_user_access_profiles_admin_write on public.tenant_user_access_profiles;
create policy tenant_user_access_profiles_admin_write
on public.tenant_user_access_profiles for all to authenticated
using (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_access_profiles.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
)
with check (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_access_profiles.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

drop policy if exists tenant_user_work_scopes_select on public.tenant_user_work_scopes;
create policy tenant_user_work_scopes_select
on public.tenant_user_work_scopes for select to authenticated
using (
  user_id=(select auth.uid())
  or exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_work_scopes.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

drop policy if exists tenant_user_work_scopes_admin_write on public.tenant_user_work_scopes;
create policy tenant_user_work_scopes_admin_write
on public.tenant_user_work_scopes for all to authenticated
using (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_work_scopes.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
)
with check (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_work_scopes.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

drop policy if exists tenant_user_permission_overrides_select on public.tenant_user_permission_overrides;
create policy tenant_user_permission_overrides_select
on public.tenant_user_permission_overrides for select to authenticated
using (
  user_id=(select auth.uid())
  or exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_permission_overrides.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

drop policy if exists tenant_user_permission_overrides_admin_write on public.tenant_user_permission_overrides;
create policy tenant_user_permission_overrides_admin_write
on public.tenant_user_permission_overrides for all to authenticated
using (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_permission_overrides.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
)
with check (
  exists (
    select 1 from public.tenant_memberships m
    where m.user_id=(select auth.uid())
      and m.tenant_id=tenant_user_permission_overrides.tenant_id
      and m.is_active=true and m.tenant_role='superadmin'
  )
);

grant select on public.tenant_user_access_profiles,
  public.tenant_user_work_scopes,
  public.tenant_user_permission_overrides to authenticated;
grant all on public.tenant_user_access_profiles,
  public.tenant_user_work_scopes,
  public.tenant_user_permission_overrides to service_role;

commit;
