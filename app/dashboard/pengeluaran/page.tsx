import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ExpenseManager, { type Expense, type ExpenseCategory, type ProjectOption } from "./manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROLES = ["Procurement", "Sales", "Cashier", "Finance", "Management"] as const;

export default async function PengeluaranPage() {
  const actor = await guardPage(() => requireAnyRole(ROLES));
  const admin = createAdminClient();
  const [{ data: allProjects, error: projectError }, { data: categories, error: categoryError }, { data: overrides, error: permissionError }, scopeResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("expense_categories").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("tenant_user_permission_overrides").select("permission_key,effect").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId),
    !actor.isOwner && !actor.roles.some(r => r === "Finance" || r === "Management")
      ? admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectError || categoryError || permissionError || scopeResult.error) throw new Error("Data Expenses gagal dimuat.");
  const all = (allProjects ?? []) as ProjectOption[];
  const broadAccess = actor.tenantRole === "superadmin" || actor.roles.some(r => r === "Finance" || r === "Management");
  const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
  const projects = broadAccess ? all : scope?.scope_mode === "all" ? all :
    all.filter(p => scope?.scope_mode === "selected" && scope.resource_ids?.includes(p.id));
  const allowedIds = new Set(projects.map(p => p.id));
  const canViewBalances = actor.tenantRole === "superadmin" || actor.roles.some(r => ["Cashier", "Finance", "Management"].includes(r));
  const [{ data: rawExpenses, error: expenseError }, ledgerResult] = await Promise.all([
    admin.from("expenses").select("id,code,expense_date,project_id,expense_category_id,description,amount,payment_method,paid_method,paid_at,paid_amount,submitted_at,status,cancellation_reason,cancelled_at,created_at,created_by,expense_categories(name),projects(code,name),expense_documents(id,file_name,mime_type,file_size,uploaded_at),expense_payment_documents(id,file_name,mime_type,file_size,uploaded_at)").eq("tenant_id", actor.tenantId)
      .order("created_at", { ascending: false }).limit(300),
    canViewBalances
      ? admin.from("project_cash_ledger").select("project_id,amount").eq("tenant_id", actor.tenantId).in("project_id", projects.length ? projects.map(p => p.id) : ["00000000-0000-0000-0000-000000000000"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (expenseError || ledgerResult.error) throw new Error("Riwayat Expenses atau saldo Project gagal dimuat.");
  const ledger = ledgerResult.data ?? [];
  const initialItems = (rawExpenses ?? []).filter(item =>
    item.project_id ? allowedIds.has(item.project_id) : broadAccess
  ) as unknown as Expense[];
  const balances: Record<string, number> = {};
  for (const row of ledger ?? []) balances[row.project_id] = (balances[row.project_id] ?? 0) + Number(row.amount);
  const permissionMap = new Map((overrides ?? []).map(row => [row.permission_key, row.effect]));
  const canCreate = actor.tenantRole === "superadmin" || (actor.roles.some(r => r === "Procurement" || r === "Sales") && permissionMap.get("transaction.post_recognition") === "allow");
  const canPay = actor.tenantRole === "superadmin" || (actor.roles.includes("Cashier") && permissionMap.get("payment.post") === "allow");
  return <ExpenseManager categories={(categories ?? []) as ExpenseCategory[]} projects={projects}
    initialItems={initialItems} balances={balances} canCreate={canCreate} canPay={canPay} canViewBalances={canViewBalances}
    canCancel={actor.tenantRole === "superadmin" || actor.roles.some(r => ["Procurement","Sales","Cashier","Finance"].includes(r))} />;
}
