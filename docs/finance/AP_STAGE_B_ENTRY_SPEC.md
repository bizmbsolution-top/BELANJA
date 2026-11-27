# BELANJA — AP Stage B Entry Specification

Status: Implementation contract / preview branch only  
Branch: `ui-user-access-preview`  
Database: production inspected read-only; no schema or data changes applied.

## 1. Goal and release boundary

Stage B introduces the AP document-entry workflow as a separate module from legacy Pengeluaran vouchers. It does not enable installment payments; that belongs to Stage C.

**Important release rule:** The production database does not yet contain `ap_version`, `recipient_name`, `expense_items`, or the Stage A AP payment tables. Therefore Stage B application code must not be deployed as an active route or query these fields until Stage A has been applied and verified in an isolated database and a controlled release has been approved. The current Free Supabase project has no isolated database; no paid branch will be created.

This document fixes the implementation contract so coding can proceed without changing the production schema or exposing a broken feature.

## 2. Access and responsibilities

- AP creation and draft editing: Finance role and tenant Superadmin.
- AP submission: Finance role and tenant Superadmin.
- Cashier: view submitted AP queue only when the relevant existing access permissions allow it; payment execution is Stage C.
- Platform Owner remains outside tenant operations.
- The server resolves actor, active tenant, role, and work scope. Never accept tenant ID or actor ID from browser input.
- Project scope must be enforced on every read and mutation.
- Use the application's existing permission-override mechanism. Before implementation, confirm the canonical permission-key registry and add only the minimum AP create/submit keys if they do not already exist. Do not invent keys in UI code or treat a hidden button as authorization.

## 3. AP form

### Header fields

| Field | Rule |
|---|---|
| Tanggal AP | Required; default today |
| Penerima | Required; free text snapshot, trimmed, 1–180 characters |
| Project | Required; active tenant Project within the user's work scope |
| Referensi BA/Invoice | Optional; select only from the same tenant and accessible Project |
| Keterangan | Optional short summary; max 1,000 characters |

When a BA is selected, show its number, customer, Project, date, and transaction value as read-only reference context. The BA does not determine or auto-fill AP amount. One BA may be referenced by multiple AP documents.

### Expense lines

At least one line is required. Each line has:
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

Input must not include trusted actor or tenant identifiers. Validate UUIDs, date, text lengths, line count, and integer amounts at the server boundary. Resolve active actor using the existing authorization helpers.

Every action must:
- require tenant membership and an active tenant;
- require Finance or Superadmin as appropriate;
- check Project and BA access against the current tenant and work scope;
- check category ownership and active status;
- call a dedicated audited RPC;
- return a safe user-facing error, not raw database internals;
- revalidate only AP routes and any affected management view.

## 6. Database RPC contract

Implement in a later migration after Stage A validation. All functions use a fixed `search_path`, explicit tenant membership and active-tenant checks, and transaction-level validation.

### Create Draft RPC

- Receives actor ID, tenant ID, date, recipient, project, optional sales_order_id, summary, and JSON line array from trusted server code.
- Confirms actor is an active member of the tenant and the tenant is active.
- Confirms the Project and optional BA belong to the same tenant; if BA has a Project, it must equal the selected AP Project.
- Confirms actor has the required Project work scope and Finance/Superadmin authority.
- Confirms every line category is active and belongs to the tenant.
- Calculates total server-side; reject empty lines, invalid amount, too many lines, or total overflow.
- Inserts `expenses.ap_version = 2`, `status = 'Draft'`, required `recipient_name`, and `amount = sum(lines)`; inserts all `expense_items` and one audit event in the same transaction.
- Never creates payments or cashier-ledger entries.

### Update Draft RPC

- Locks the AP header with `FOR UPDATE`.
- Requires `ap_version = 2` and `status = 'Draft'`.
- Repeats tenant, actor, role, Project scope, BA, and category validation.
- Replaces header and all lines atomically. Any failure rolls back the complete operation.
- Writes before/after audit snapshots.

### Submit RPC

- Locks the AP header and lines.
- Requires `ap_version = 2`, Draft status, required recipient/project, and at least one valid line.
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
2. Empty recipient, no Project, no line, inactive category, zero/negative amount, invalid date, and overlong text are rejected.
3. Header total always equals the sum of saved lines, even if the browser sends a forged total.
4. A BA can be omitted; one BA can be referenced by multiple AP documents.
5. BA from another tenant or inaccessible Project is rejected.
6. A category from another tenant is rejected even if its UUID is forged into the request.
7. A Project outside the actor's scope is rejected by both server action and RPC.
8. Non-Finance/non-Superadmin users cannot create, edit, or submit AP.
9. Submitted AP and its lines cannot be edited.
10. Failure inserting any line leaves no partial header or orphan line.
11. Legacy version-1 vouchers remain readable and their existing create/edit/submit/pay/cancel flow is unchanged.
12. No AP creation produces an `expense_payments` row or cashier ledger movement.

## 9. Deferred from Stage B

- Cashier installment payments and ledger debits: Stage C.
- Bank accounts and direct bank payments: Stage D.
- Reporting and reconciliation: Stage E.
- Approval workflows: not required by the current business decision.
- Auto-generation from Master Biaya Penjualan or BA: explicitly excluded.
