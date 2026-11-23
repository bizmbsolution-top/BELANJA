alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
  'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','project',
  'fund_request','fund_request_document'
]::text[]));
