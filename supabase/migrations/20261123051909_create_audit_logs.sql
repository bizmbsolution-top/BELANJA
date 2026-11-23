-- Belanja append-only administrative audit events.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  target_user_id uuid null references auth.users(id) on delete set null,
  action text not null check (action in (
    'user.created',
    'user.access_updated',
    'user.email_update_requested',
    'user.email_updated',
    'user.email_update_failed',
    'user.password_reset_requested',
    'user.password_reset',
    'user.password_reset_failed'
  )),
  entity_type text not null check (entity_type in ('user_access', 'auth_user')),
  entity_id text null,
  before_data jsonb null,
  after_data jsonb null,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only administrative audit events for Belanja. Never store passwords, tokens, secrets, or session data.';
comment on column public.audit_logs.actor_user_id is
  'Authenticated actor resolved by trusted server code; never accepted from browser input.';
comment on column public.audit_logs.before_data is
  'Allowlisted, non-secret snapshot of relevant values before the action.';
comment on column public.audit_logs.after_data is
  'Allowlisted, non-secret snapshot of relevant values after the action.';

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_target_created_at_idx on public.audit_logs (target_user_id, created_at desc);
create index audit_logs_actor_created_at_idx on public.audit_logs (actor_user_id, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant select, insert on table public.audit_logs to service_role;
