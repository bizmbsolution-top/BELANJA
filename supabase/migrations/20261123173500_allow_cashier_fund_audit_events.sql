alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
  'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed',
  'user.password_reset_requested','user.password_reset','user.password_reset_failed',
  'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated',
  'warehouse.created','warehouse.updated','expense_category.created','expense_category.updated',
  'uom.created','uom.updated','expense.created','expense.cancelled','expense_document.uploaded','expense_document.deleted',
  'project.created','project.updated',
  'fund_request.created','fund_request.executed','fund_request_document.uploaded'
]::text[]));
