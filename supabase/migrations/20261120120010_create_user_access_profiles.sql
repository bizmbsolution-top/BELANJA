create table public.user_access_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint user_access_profiles_roles_allowed
    check (roles <@ array['Cashier', 'Finance', 'Warehouse', 'Management']::text[])
);

comment on table public.user_access_profiles is
  'Belanja user role and active status; managed only by trusted server-side Owner actions.';
comment on column public.user_access_profiles.roles is
  'Operational roles assigned to the user. Superadmin is not assignable here.';
comment on column public.user_access_profiles.is_active is
  'Whether the user is allowed to access Belanja operational modules.';

insert into public.user_access_profiles (user_id, roles, is_active)
select id, '{}'::text[], true
from auth.users
on conflict (user_id) do nothing;

alter table public.user_access_profiles enable row level security;
revoke all on table public.user_access_profiles from anon, authenticated;
grant all on table public.user_access_profiles to service_role;
