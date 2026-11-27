# BELANJA — Legacy Expenses / AP Compatibility Audit

Status: Read-only database audit + repository-only hardening  
Branch: `ui-user-access-preview`  
Database: production inspected with read-only SQL only; no schema or data changes applied.

## 1. Scope

Reviewed:
- Legacy voucher server actions in `app/dashboard/pengeluaran/actions.ts`.
- Legacy expense list and project-balance loading.
- BA expense master and voucher-generation path.
- Sales expense closing and management-report queries.
- Current PostgreSQL function definitions and EXECUTE privileges for the relevant expense RPCs.

## 2. Current legacy workflow

The existing `expenses` workflow is a single-header voucher:
1. Create Draft.
2. Edit Draft.
3. Submit to `Menunggu Pembayaran`.
4. Cashier posts one full payment through `pay_expense_with_audit`.
5. Payment RPC locks the expense and Project, checks the Project cash ledger balance, updates the expense to `Dibayar`, inserts one debit in `project_cash_ledger`, and writes an audit log.
6. Cancel is allowed only while Draft or `Menunggu Pembayaran`.

The current payment RPC does not support partial installments. It must remain a legacy-only path and must not be reused for AP v2.

## 3. Security and compatibility findings

### F-01 — Legacy expense RPCs are service-role only

The current production database reports no EXECUTE privilege for `anon` or `authenticated` on the inspected legacy expense RPCs. EXECUTE is granted to `service_role` for the create, update, submit, pay, cancel, evidence-registration, and BA-generation functions. This means the server actions are the effective authorization boundary for those operations.

This is a useful restriction, but the RPC functions themselves generally do not validate the active tenant membership or project scope. The server actions must continue to perform those checks before calling the RPCs. New AP RPCs should validate tenant membership, actor, project scope, status, and amount limits inside the database function as well.

### F-02 — Expense category tenant validation was missing in server actions; fixed in this branch

Before this audit, `createExpenseDraft` and `updateExpenseDraft` validated Project ownership/scope but relied on the browser-provided category ID and the dropdown's tenant-filtered options. A forged server-action request could supply a category ID from another tenant.

Repository hardening now adds `assertCategoryAccess` to verify that the category is active and belongs to the actor's tenant before either legacy RPC is called.

The AP Stage A migration also adds a composite tenant-safe foreign key for existing expense/category references. Both application and database checks are required.

### F-03 — Legacy full-payment flow must remain separate from AP installments

`pay_expense_with_audit` performs one full payment only. It debits the Project cash ledger and changes the expense header to `Dibayar`. The function serializes payments by locking the Project row before checking the balance.

AP v2 must use a new payment RPC that:
- locks the AP header;
- calculates remaining balance from Posted installments;
- rejects an installment above the remaining amount;
- creates one payment row and exactly one corresponding cashier-ledger debit atomically;
- updates AP status and audit history atomically;
- supports reversal without editing or deleting a posted payment.

Do not call `pay_expense_with_audit` from AP v2.

### F-04 — Legacy payment evidence is attached to the voucher header

`expense_payment_documents` references `expense_id`, not an individual payment. Its registration RPC is SECURITY DEFINER but EXECUTE is restricted to `service_role`; it checks that the voucher is awaiting payment but does not independently validate tenant membership or actor identity.

This remains a legacy header-level evidence model. AP v2 evidence must attach to `expense_payments.id` through `expense_payment_evidence`. The new server action must enforce tenant-prefixed storage paths and the payment must already exist.

### F-05 — BA-generated voucher path is disabled in the active server action

The active `generateSalesExpenseVouchers` server action returns an explicit error stating that BA costs are no longer automatically converted to vouchers and should be recorded manually through Pengeluaran/AP.

The old database function `create_sales_expense_vouchers_from_ba` still exists, but production grants show EXECUTE only for `service_role`, not `anon` or `authenticated`. Its current definition validates that the actor is an active member of the BA tenant and scopes the generated rows to that tenant.

The old client manager still contains a generation button, but its route is redirected to the expense-category page and the server action is disabled. It is legacy/orphaned UI and must not be reactivated. The old RPC should be retired only after all call paths and historical reporting dependencies are accounted for.

### F-06 — Sales-expense period closing is legacy BA-component based

`close_sales_expense_period` is SECURITY DEFINER and EXECUTE is restricted to `service_role`. Its current function definition does not independently validate tenant membership or project scope; the current server action performs role, tenant-owned Project, permission, and work-scope checks before calling it.

The closing function is based on `sales_order_expense_items` and the old voucher link `expenses.sales_order_expense_item_id`. It does not close or reconcile manually created AP documents. Keep it as a legacy BA-cost closing flow until a replacement is explicitly designed; do not use it as the AP closing mechanism.

### F-07 — Current management reports only include BA-linked legacy expense components

The existing Laporan Keuangan and Laporan Biaya Penjualan queries load expense rows through `sales_order_expense_item_id` and `sales_order_expense_items`. A manually created AP document with an optional `sales_order_id`, but without a legacy `sales_order_expense_item_id`, will not be included in those current report calculations.

This is a known reporting gap, not a reason to create fake BA expense-item links. Stage E must explicitly aggregate AP v2 line items/payments and associate them with the optional BA/project while ensuring each expense is counted exactly once. The management accrual view must include submitted AP obligations even when unpaid; cash reports must use actual posted payment movements.

### F-08 — Legacy actions do not yet distinguish AP version 1 from AP version 2

The current legacy expense list reads all tenant expenses and the legacy server actions identify records by tenant, ID, and status; they do not yet check `ap_version`. This is not an active data issue today because production does not yet have the AP Stage A column or AP v2 rows.

Before creating any AP v2 record, Stage B must coordinate the UI and server-action transition:
- legacy actions may mutate only version 1 vouchers;
- AP v2 must use dedicated AP actions/RPCs;
- legacy list screens must not present AP v2 as an editable legacy voucher;
- old voucher history must remain readable.

Because the AP Stage A migration is not applied, do not deploy application code that queries `ap_version` until the schema migration is safely available in an isolated test environment and release order is controlled.


### F-09 — Stage A migration now fences legacy mutation RPCs to version 1

The Stage A migration draft now replaces the six inspected legacy expense RPC definitions with behavior-preserving versions that explicitly create version 1 or select/update only rows where `ap_version = 1`. This covers Draft creation, Draft edit, submit, full payment, cancellation, and legacy payment-evidence registration.

The function signatures, search paths, existing business rules, and SECURITY DEFINER setting on the evidence-registration function are preserved. PostgreSQL `CREATE OR REPLACE FUNCTION` retains the existing function ownership and ACLs; a post-migration verification query has been added to confirm that `anon` and `authenticated` still cannot execute these functions and `service_role` can.

This is a migration-draft change only. The functions in production remain unchanged until Stage A is reviewed and applied in a safe test environment.

## 4. Repository-only change made during this audit

- Added `assertCategoryAccess` to `app/dashboard/pengeluaran/actions.ts`.
- Called it before legacy Draft creation and Draft update RPCs.
- No runtime database was modified.
- No AP UI, AP RPC, or AP payment behavior was added.

## 5. Required next steps before AP v2 can be used

1. Review and validate the complete Stage A SQL against a safe isolated database. Do not apply it to production as a test. The current Free project has no isolated database, so this validation remains a release blocker.
2. The Stage A draft now contains version-1 fences for all six legacy expense mutation/evidence RPCs; verify the function definitions and ACLs with `AP_STAGE_A_VERIFICATION.sql` after applying in a safe test database.
3. Build dedicated AP v2 create/edit/submit actions and RPCs. AP lines are the source of AP total; recipient is required; BA reference is optional.
4. Build the AP installment payment RPC and cashier-ledger posting as one atomic operation. Keep the existing full-payment RPC for version 1 only.
5. Update management reports to include AP v2 line items and outstanding obligations without double-counting BA-linked legacy costs.
6. Retire the obsolete BA auto-voucher RPC only after confirming no remaining historical/reporting dependency.

## 6. Explicit safety boundary

- No production migration was applied.
- No production data was inserted, updated, or deleted.
- No paid Supabase development branch was created.
- Work in this audit is limited to read-only inspection and repository changes on `ui-user-access-preview`.
