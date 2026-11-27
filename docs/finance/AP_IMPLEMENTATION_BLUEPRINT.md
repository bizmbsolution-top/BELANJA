# BELANJA — AP Pengeluaran Implementation Blueprint

Status: Design baseline for preview branch only  
Branch: `ui-user-access-preview`  
Database: no schema or data changes applied by this document.

## 1. Purpose

Replace the current single-voucher/full-payment workflow with a practical Accounts Payable (AP) workflow while preserving legacy expense records and existing tenant isolation.

AP is a payable obligation to a recipient. It is not an automatic result of a BA cost master. Finance explicitly creates each AP.

## 2. Confirmed business rules

- One AP belongs to one recipient. Different recipients require separate AP documents.
- One AP may contain multiple expense lines. Example: RJS — Royalty Fee Mitra Rp1,000,000 and Security Fee Rp250,000.
- A BA/Invoice reference is optional. When selected, the app may show customer, BA number, project, date, and transaction value as reference context. Finance enters the AP amount; it is not calculated from the BA.
- One BA may be referenced by multiple AP documents.
- Payment may be made directly by Finance from a Bank account or through Cashier.
- AP supports multiple partial payments. The remaining payable is total AP less successful payment records.
- A payment is recorded once. Paying through Cashier must not create another expense/AP obligation.
- Transfer from Bank to Cashier is an internal fund movement, not an expense. The expense is recognized once when the AP payment or operational cash realization is recorded.
- Master Kategori Pengeluaran remains the category source. No Chart of Accounts, journal, debit/credit, or automatic AP generation.
- Audit fields, timestamps, actor, tenant ownership, and project scope must be preserved.

## 3. Current database findings

### Existing tables that can be reused

- `expenses`: existing expense header, tenant-scoped, with mandatory `expense_category_id`, `description`, `amount`, `payment_method`, status, project, optional `sales_order_id`, audit timestamps and actor columns.
- `expense_categories`: tenant-scoped active categories.
- `expense_documents`: billing/supporting documents.
- `expense_payment_documents`: existing payment evidence table, currently attached to an expense header rather than a distinct payment installment.
- `sales_orders`: BA reference source (`ba_number`, `ba_date`, customer, project, final amount).
- `fund_requests` and `project_cash_ledger`: current Project-based cashier fund request and balance mechanism.

### Important limitations

- Current expense payment RPC pays the entire outstanding expense in one operation and debits the Project cash ledger.
- Current cashier balance is Project-based. It is not a company-wide bank account register.
- There is no central bank account and bank movement registry surfaced in the current schema.
- Existing `expense_payment_documents` is not suitable as the final evidence model for multiple payment installments without adding a payment-level relationship.
- Existing RLS policies for expense tables are tenant-membership policies. Application project scope is checked in server actions; new RPCs must repeat tenant membership, actor, and project-scope authorization rather than trusting client-side checks.
- The existing `pay_expense_with_audit` function is a full-payment legacy path. It must remain available for legacy records until a controlled transition is tested; new AP payment actions must not call it.

## 4. Proposed data model

### 4.1 Reuse `expenses` as AP header

Add nullable columns, preserving every existing row:

- `recipient_name` text — recipient snapshot, required for new AP.
- `ap_version` smallint not null default 1 — identifies records created under the new AP workflow.

Keep existing `sales_order_id` as the optional BA reference. Do not impose uniqueness on it.

For new AP documents, `amount` stores the AP total and `description` stores a short header summary for compatibility with existing reports. `expense_category_id` remains populated with a valid primary category for compatibility; detailed categories live on AP lines. Existing rows are not backfilled or rewritten.

### 4.2 New `expense_items` table

One row per AP cost line:

- id, tenant_id, expense_id
- line_number
- expense_category_id
- description
- amount
- created_at, created_by, updated_at, updated_by

Constraints:
- amount > 0
- unique (tenant_id, expense_id, line_number)
- expense and category must belong to the same tenant
- immutable after AP is submitted, except through an explicit draft-edit operation
- no automatic rows from sales expense masters

### 4.3 New `expense_payments` table

One row per successful payment installment:

- id, tenant_id, expense_id
- payment_date
- amount
- payment_channel: `Cashier` in Stage A/C; `Bank` is enabled only after Stage D
- payment_method: `Tunai` for the cashier-only Stage A/C flow; Bank transfers are added in Stage D
- bank_account_id is deferred to the Stage D Bank migration
- payment_reference nullable
- cashier_project_id nullable (required for Cashier channel)
- the cashier ledger row links back through `project_cash_ledger.expense_payment_id`
- notes nullable
- status: `Posted` or `Reversed`
- created_at, created_by

Constraints:
- amount > 0
- Stage A/C permits Cashier channel only, with a Project and exactly one matching cashier ledger debit row.
- Bank channel remains unavailable until Stage D creates and validates tenant Bank accounts and movements.
- Sum of Posted payments must never exceed AP total.
- A payment cannot be silently edited or deleted after posting. Corrections use a reversal record and audit event.
- Payment insertion and balance/status update must be atomic in a single database function.

Evidence must attach to a payment installment, not just the AP header. A new `expense_payment_evidence` table (or a carefully staged extension with payment_id) will hold storage path, file metadata, tenant, uploader, and upload timestamp. Existing header-level evidence remains readable for legacy AP.

### 4.4 Bank accounts and movements

A company-wide `bank_accounts` table is required before Bank payment can be enabled:

- id, tenant_id, account_name, bank_name, account_number_masked, currency, opening_balance, is_active, timestamps and actor fields.

A tenant-scoped `bank_movements` ledger records:
- bank_account_id, movement_date, direction (in/out), amount, movement_type, reference_type, reference_id, description, created_by, created_at.
- AP payment outflow links to its `expense_payments` row.
- Transfers between Bank and Cashier are represented as paired internal movements; they do not create expense records.
- Current balance is opening balance plus signed posted movements. Do not store an independently editable running balance.

Account numbers should be masked in ordinary UI; do not store internet banking credentials or secrets.

## 5. AP statuses and calculations

- Draft: editable, no payable commitment in the AP list.
- Menunggu Pembayaran: submitted and unpaid.
- Partial: one or more payments posted, remaining balance > 0.
- Paid: remaining balance = 0.
- Cancelled: only permitted before any payment is posted. Once paid in part, use a controlled reversal/credit process rather than cancellation.

Calculations:
- AP total = sum of active expense_items.
- Paid total = sum of Posted expense_payments.
- Remaining = AP total - paid total.
- Reject posting if amount exceeds remaining.
- Never infer AP payment from a Bank-to-Cashier transfer.

## 6. Database security and tenant isolation

For each new table:
- Enable RLS.
- Add explicit SELECT/INSERT/UPDATE policies for active tenant members, with tenant_id equality to the active membership. Avoid broad policies that grant unrelated tenant data.
- Do not grant authenticated table writes that bypass audited RPC workflows. Revoke direct INSERT/UPDATE/DELETE where appropriate and grant only the intended operations.
- Use SECURITY DEFINER functions only where required, with fixed `search_path`, explicit actor membership validation, tenant match checks, and row locks for financial posting.
- New RPCs must verify active tenant status, actor membership, project scope, category ownership, AP status, and amount limits inside the database transaction.
- Application server actions must still check role/permission keys; database functions are the final integrity boundary.
- Add indexes for tenant_id, expense_id, payment date, bank account, and foreign keys.
- Use unique/idempotency controls to prevent duplicate payment posting.
- Audit every create, submit, payment, reversal, and cancellation with before/after snapshots.

## 7. Staged delivery

### Stage A — AP data foundation (migration drafted in preview branch; not applied)
- Add nullable `recipient_name` and `ap_version` to `expenses`; version 1 preserves legacy vouchers and version 2 identifies new AP documents.
- Create `expense_items`, cashier-only `expense_payments`, and payment evidence metadata.
- Add tenant-safe composite foreign keys for expense/category/project/BA and cashier-ledger project/expense/payment references, indexes, read-only member RLS, and restrictive policies preventing direct authenticated writes or deletes of AP v2 and new cashier ledger rows.
- Extend the existing cashier ledger with an `expense_payment_id` source while preserving the three legacy source types.
- No production data migration and no automatic conversion of old expenses.
- Do not yet expose Bank payment until the Bank account/movement model is deployed and tested.

### Stage B — AP entry UI
- Finance creates a draft, selects recipient, optional BA, project, and one or more category/description/amount lines.
- Header total is computed from lines.
- Submit freezes the draft and makes it payable.
- Old voucher history remains accessible and unchanged.

### Stage C — Cashier installment payment
- Record partial/full AP payments through Cashier.
- Create exactly one matching Project cash ledger debit per posted payment.
- Validate that AP amount, payment amount, and ledger debit are identical.
- Retain the existing fund request and handover flow; do not treat handover as an expense.

### Stage D — Bank account and direct Bank payment
- Add tenant Bank account registry and movement ledger.
- Finance records partial/full Bank payment with account, date, reference, and evidence.
- One atomic operation posts AP payment and Bank outflow.
- Transfers between Bank and Cashier use paired internal movements only.

### Stage E — Reporting and reconciliation
- AP aging, outstanding balances, paid amounts, and payment history.
- Margin reporting includes AP expense once, based on AP obligation, while cash/bank reports show payment movements separately.
- Reconcile old expense vouchers before retiring the legacy full-payment workflow.

## 8. Explicit non-goals

- No full accounting ledger, COA, journal, debit/credit, or financial statements.
- No automatic AP from Master Biaya Penjualan.
- No automatic AP amount calculation from BA.
- No deletion or destructive rewrite of legacy expenses, settlement history, or cashier ledger.
- No production database migration as part of the design commit.

## 9. Acceptance checks before applying Stage A migration

1. Existing expense rows and status totals remain unchanged.
2. Tenant A cannot read or mutate Tenant B AP header, lines, payments, or evidence.
3. Inactive tenant members cannot use AP RPCs.
4. Cross-tenant expense/category/BA/payment references are rejected.
5. A payment greater than remaining balance is rejected under concurrent requests.
6. A duplicate request cannot create duplicate payment or duplicate ledger movement.
7. Cashier AP payment creates one expense payment and one ledger debit.
8. Bank AP payment creates one expense payment and one Bank outflow.
9. Bank-to-Cashier transfer changes account balances but creates no AP expense.
10. Existing legacy voucher payment and evidence remain readable until cutover is explicitly approved.


## 10. Stage A implementation status (2026-11-27)

- Migration draft: `supabase/migrations/20261127180000_ap_foundation_v1.sql`.
- Read-only verification script: `docs/finance/AP_STAGE_A_VERIFICATION.sql`.
- Preflight inspection of current Supabase data found zero tenant mismatches for existing expense/category, expense/project, expense/BA, and cashier-ledger/project or expense relationships.
- New AP rows are version 2 and require a non-empty recipient name. Existing rows remain version 1.
- The legacy `Aktif` status default is retained in the expanded status constraint so existing insert paths do not fail. Direct authenticated delete is blocked for AP v2 headers and AP payment ledger rows.
- The cashier ledger now receives composite tenant-safe foreign keys for its project and legacy expense references as well as its new AP payment reference; the preflight must show zero mismatches before applying.
- Authenticated clients receive read access to the new tables only; writes are reserved for trusted server-side operations to be implemented in later stages. Restrictive policies also prevent direct authenticated deletion of AP v2 headers and their new cashier-ledger rows.
- Bank payment is intentionally not enabled by this migration.
- This is a repository-only draft. It has not been applied to the active Supabase database and has not yet been tested against an isolated preview database.
