revoke all privileges on table public.fund_requests, public.fund_request_documents, public.project_cash_ledger from service_role;
grant select, insert, update on table public.fund_requests to service_role;
grant select, insert on table public.fund_request_documents to service_role;
grant select, insert on table public.project_cash_ledger to service_role;
