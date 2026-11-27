# BELANJA — AP Stage B Entry Specification

Status: Implementation contract / preview branch only  
Branch: `ui-user-access-preview`  
Database: production inspected read-only; no schema or data changes applied.

## 1. Goal and release boundary

Stage B introduces the AP document-entry workflow as a separate module from legacy Pengeluaran vouchers. It does not enable installment payments; that belongs to Stage C.

**Important release rule:** The production database does not yet contain `ap_version`, `recipient_name`, `recipient_supplier_id`, `expense_items`, or the Stage A AP payment tables. Therefore Stage B application code must not be deployed as an active route or query these fields until Stage A has been applied and verified in an isolated database and a controlled release has been approved. The current Free Supabase project has no isolated database; no paid branch will be created.

This document fixes the implementation contract so coding can proceed without changing the production schema or exposing a broken feature.

## 2. Access and responsibilities

- AP creation and draft editing: Finance role and tenant Superadmin.
- AP submission: Finance role and tenant Superadmin.
- Cashier: view submitted AP queue only when the relevant existing access permissions allow it; payment execution is Stage C.
- Platform Owner remains outside tenant operations.
- The server resolves actor, active tenant, role, and work scope. Never accept tenant ID or actor ID from browser input.
- Tenant Superadmin bypasses individual Project scope and may access every Project inside the active tenant. This is a tenant-wide bypass only; it never grants access to another tenant. Platform Owner remains outside tenant operations.
- Finance and all other non-Superadmin users must pass their configured Project scope on every read and mutation.
- Project scope must be enforced on every read and mutation for non-Superadmin users.
### AP permission contract

The current application does **not** have a general Role-Permission matrix. Operational Roles are stored on the tenant access profile, while the existing permission mechanism is an individual tenant-scoped override (allow / deny / unset). The shared policy evaluator treats the existing sensitive permissions as individual-only. Do not assume that a Finance Role automatically grants every action.

Add only these two canonical keys to that existing override mechanism:

| Permission key | Allows |
|---|---|
| ap.create_edit | Create and edit AP while status is Draft |
| ap.submit | Submit a Draft AP to Menunggu Pembayaran |

Effective authorization:
- **Finance:** must have the Finance operational Role **and** an explicit allow for the relevant AP permission. Unset means denied. Explicit deny means denied.
- **Tenant Superadmin:** may perform AP actions throughout the active tenant without individual AP overrides or Project scope. This bypass is valid only after active tenant membership and active tenant status are verified.
- **Platform Owner:** remains outside tenant AP operations.
- A user with another operational Role cannot gain AP authority merely by receiving an AP permission override; the Finance Role check remains mandatory.
- Create/edit checks ap.create_edit; submit checks ap.submit. Keep these permissions separate so an administrator can allow drafting without allowing submission.

Integration requirements:
- Add both keys to INDIVIDUAL_ONLY_PERMISSIONS in lib/auth/access-policy.ts; do not add Role grants.
- Add the two settings to the Finance section of the existing Owner/Superadmin Pengaturan Pengguna UI. Keep the existing unset / allow / deny controls and tenant-scoped storage.
- Extend the allow-list constraint on tenant_user_permission_overrides and the validation loops in save_tenant_user_access_profile_with_audit in a dedicated, reviewed migration. Update the server-action TypeScript shape and validation in the same application change.
- The permission lookup must use the active tenant ID from trusted server context and the target user's ID; never query overrides by user ID alone.
- Enforce the same Role + permission + tenant checks in both the server action and the database RPC. A hidden/disabled button is presentation only, not authorization.
- Until the coordinated migration and application changes are tested, do not expose the AP route or AP actions. Existing four permission keys and their behavior must remain unchanged.

## 3. AP form

### Header fields

| Field | Rule |
|---|---|
| Tanggal AP | Required; default today |
| Supplier / Dibayarkan Kepada | Required; select one active record from the current tenant's Master Suppliers. Store `recipient_supplier_id` and a snapshot of the supplier's current `name` in `recipient_name`. |
| Project | Required; active tenant Project within the user's work scope |
| Referensi BA/Invoice | Optional; select only from the same tenant and accessible Project |
| Keterangan | Optional short summary; max 1,000 characters |

When a Supplier is selected, show its supplier name and contact person (if present); the supplier name is the recipient snapshot for historical AP. Provide **+ Tambah Supplier** inline without leaving the AP form, using the existing supplier fields (name required; contact person, phone, email, address, notes optional). Quick-add must use the existing audited supplier creation flow and return/select the newly created supplier ID. Only active suppliers can be selected for a new or edited Draft AP. Deactivating a supplier must not rewrite historical AP snapshots.

When a BA is selected, show its number, customer, Project, date, and transaction value as read-only reference context. The BA does not determine or auto-fill AP amount. One BA may be referenced by multiple AP documents.

### Expense lines

At least one line and no more than **50 lines** are allowed per AP document. Each line has:
- Category: required active category from the current tenant.
- Description: required, trimmed, max 500 characters.
- Amount: positive Rupiah integer; no zero or negative values.

Allow adding/removing lines while Draft. Prevent duplicate empty lines. Use exact integer arithmetic for IDR totals. The client total is a convenience only; the database RPC recalculates it from persisted lines.

### Derived values

- Header amount = sum of all expense line amounts.
- Header primary category = category of the first line, retained only for compatibility with existing `expenses` consumers.
- Header description = supplied short summary; if omitted, use a safe concise summary derived from the first line.
- Never create `sales_order_expense_items` or link fake BA cost rows.

## 4. Document lifecycle

1. Create Draft: creates version-2 expense header and its initial line items atomically.
2. Edit Draft: replaces the complete line set and header values atomically. Only Draft and version 2 may be edited.
3. Submit: validates at least one line, recalculates total, freezes header and lines, and changes status to `Menunggu Pembayaran`.
4. After submit: no line/header edits and no deletion. Cancellation is not part of Stage B if any payment exists; the Stage C lifecycle must define cancellation with zero posted payments and reversal handling after payment.

Legacy vouchers remain readable and continue through the existing legacy screens and RPCs. AP v2 must have a separate list/detail route and separate server actions.

## 5. Server action contract

Create dedicated actions in an AP module; do not reuse `createExpenseDraft`, `updateExpenseDraft`, `submitExpense`, or legacy full-payment RPCs.

Suggested operations:
- `createApDraft(input)`
- `updateApDraft(input)`
- `submitApDocument(expenseId)`

Input must not include trusted actor or tenant identifiers. Validate UUIDs, a real calendar date (not format alone), text lengths, a maximum of 50 lines, and positive integer amounts at the server boundary. Resolve active actor using the existing authorization helpers.

Every action must:
- require tenant membership and an active tenant;
- for Finance, require the Finance Role plus the matching explicit AP permission (ap.create_edit or ap.submit); for tenant Superadmin, verify active membership and tenant status, then allow tenant-wide AP access;
- check Project and BA ownership against the current tenant; enforce configured Project scope for Finance and bypass only that individual scope for tenant Superadmin;
- check category ownership and active status;
- call a dedicated audited RPC;
- return a safe user-facing error, not raw database internals;
- revalidate only AP routes and any affected management view.

## 6. Database RPC contract

Implement in a later migration after Stage A validation. All functions use a fixed `search_path`, explicit tenant membership and active-tenant checks, and transaction-level validation.

### Create Draft RPC

- Receives actor ID, tenant ID, date, `recipient_supplier_id`, recipient-name snapshot, project, optional sales_order_id, summary, and JSON line array from trusted server code.
- Confirms actor is an active member of the tenant and the tenant is active.
- Confirms the selected Supplier is active and belongs to the same tenant; confirms the Project and optional BA belong to the same tenant; if BA has a Project, it must equal the selected AP Project.
- Confirms active tenant membership. Finance must have the Finance operational Role and an explicit allow for ap.create_edit; tenant Superadmin is authorized by the active tenant membership and bypasses individual Project scope only after validating that the Project belongs to the active tenant. Explicit Finance permission deny and unset both reject the action.
- Confirms every line category is active and belongs to the tenant.
- Calculates total server-side; reject empty lines, invalid amount, too many lines, or total overflow.
- Inserts `expenses.ap_version = 2`, `status = 'Draft'`, required `recipient_supplier_id`, recipient-name snapshot, and `amount = sum(lines)`; inserts all `expense_items` and one audit event in the same transaction.
- Never creates payments or cashier-ledger entries.

### Update Draft RPC

- Locks the AP header with `FOR UPDATE`.
- Requires `ap_version = 2` and `status = 'Draft'`.
- Repeats tenant, actor, role, ap.create_edit permission, active Supplier, Project, BA, and category validation. Finance requires an explicit permission allow; tenant Superadmin may access any Project within the same tenant.
- Replaces header and all lines atomically. Any failure rolls back the complete operation.
- Writes before/after audit snapshots.

### Submit RPC

- Locks the AP header and lines.
- Requires active tenant membership; Finance must have the Finance Role and an explicit allow for ap.submit; tenant Superadmin is allowed within the active tenant.
- Requires `ap_version = 2`, Draft status, required active Supplier and Project, and at least one valid line.
- Recalculates and writes the header total from line rows; no client-supplied total is trusted.
- Sets `status = 'Menunggu Pembayaran'`, submitted actor/time, and audit snapshot atomically.
- Prevents all later line/header edits through the dedicated RPC and server actions.

### Function exposure

- Revoke direct table writes from `anon` and `authenticated`.
- Grant function EXECUTE only to `service_role`, consistent with the current server-side admin-client pattern.
- Keep tenant/project/actor authorization inside the RPC despite service-role invocation.
- Preserve least privilege and verify exact function ACLs after migration.

## 7. Read model and UI separation

- New route: `/dashboard/ap` (not mounted until Stage A and Stage B schema are available).
- AP list shows code, date, recipient, Project, optional BA, total, status, and creator.
- AP detail shows header and ordered line items.
- Drafts are editable only by authorized Finance/Superadmin users within scope.
- Submitted AP is read-only in Stage B.
- Legacy `/dashboard/pengeluaran` must filter to `ap_version = 1` only after schema rollout. Until then, leave its current production-compatible query unchanged.
- No AP v2 record may appear as a legacy voucher.

## 8. Acceptance tests

1. Finance can create an AP with one line and with multiple lines.
2. Missing/inactive Supplier, Supplier from another tenant, no Project, no line, inactive category, zero/negative amount, invalid date, and overlong text are rejected.
3. Quick-add Supplier from the AP form creates one audited Master Supplier in the active tenant and selects it for the Draft AP; duplicate clicks must not create duplicate suppliers.
4. Header total always equals the sum of saved lines, even if the browser sends a forged total.
5. A BA can be omitted; one BA can be referenced by multiple AP documents.
6. BA from another tenant or inaccessible Project is rejected.
7. A category from another tenant is rejected even if its UUID is forged into the request.
8. Finance users cannot access a Project outside their configured scope; this is rejected by both server action and RPC.
9. Tenant Superadmin can create, edit, and submit AP in any Project belonging to the same tenant, even when the Project is not in an individual Selected scope.
10. Superadmin cannot access a Project belonging to another tenant.
11. Non-Finance/non-Superadmin users cannot create, edit, or submit AP, even if an AP override is present.
12. Finance without explicit ap.create_edit allow cannot create or edit; explicit deny and unset both reject.
13. Finance without explicit ap.submit allow cannot submit; explicit deny and unset both reject.
14. Tenant Superadmin can create, edit, and submit AP within the active tenant without individual AP overrides; inactive membership/tenant is always rejected.
15. Submitted AP and its lines cannot be edited.
16. Failure inserting any line leaves no partial header or orphan line.
17. Legacy version-1 vouchers remain readable and their existing create/edit/submit/pay/cancel flow is unchanged.
18. No AP creation produces an `expense_payments` row or cashier ledger movement.
19. More than 50 expense lines are rejected by both server action and RPC.
20. An invalid calendar date is rejected even when it matches the `YYYY-MM-DD` text pattern.

## 9. Deferred from Stage B

- Cashier installment payments and ledger debits: Stage C.
- Bank accounts and direct bank payments: Stage D.
- Reporting and reconciliation: Stage E.
- Approval workflows: not required by the current business decision.
- Auto-generation from Master Biaya Penjualan or BA: explicitly excluded.
