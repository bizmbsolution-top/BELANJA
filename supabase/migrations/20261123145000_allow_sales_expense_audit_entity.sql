alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document','project','fund_request','fund_request_document','purchase_request','purchase_receipt','purchase_payment_request','purchase_receipt_document','purchase_payment_document','inventory_lot','customer','sales_order','sales_expense_master'
]::text[]));