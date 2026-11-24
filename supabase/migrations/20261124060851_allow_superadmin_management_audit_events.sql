alter table public.platform_audit_logs
  drop constraint if exists platform_audit_logs_action_check;

alter table public.platform_audit_logs
  add constraint platform_audit_logs_action_check
  check (action = any (array[
    'tenant.created',
    'tenant.status_changed',
    'tenant.admin_invited',
    'tenant.admin_membership_changed',
    'tenant.superadmin_email_updated',
    'tenant.superadmin_activated',
    'tenant.superadmin_deactivated',
    'tenant.superadmin_password_reset'
  ]::text[]));
