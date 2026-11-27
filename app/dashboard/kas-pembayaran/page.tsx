import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import CashierPaymentManager, { type CashierAp, type CashierPayment } from "./manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function KasPembayaranPage() {
  const actor = await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  if (!actor.tenantId) throw new Error("Perusahaan aktif tidak ditemukan.");
  const admin = createAdminClient();
  const isSuperadmin = actor.tenantRole === "superadmin";
  const isCashier = actor.roles.includes("Cashier");

  const [{ data: allProjects, error: projectError }, scopeResult, permissionResult] = await Promise.all([
    admin.from("projects").select("id,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    !isSuperadmin && isCashier
      ? admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
          .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    !isSuperadmin && isCashier
      ? admin.from("tenant_user_permission_overrides").select("effect")
          .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId)
          .eq("permission_key", "payment.post").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectError || scopeResult.error || permissionResult.error) throw new Error("Data akses Kas & Pembayaran gagal dimuat.");

  const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
  const projects = (allProjects ?? []).filter((project) => {
    if (isSuperadmin || !isCashier || scope?.scope_mode === "all") return true;
    return scope?.scope_mode === "selected" && scope.resource_ids?.includes(project.id);
  });
  const projectIds = projects.map((project) => project.id);
  const canPost = isSuperadmin || (isCashier && permissionResult.data?.effect === "allow");
  const { data: rows, error } = projectIds.length
    ? await admin.from("expenses")
        .select("id,code,expense_date,recipient_name,project_id,amount,status")
        .eq("tenant_id", actor.tenantId).eq("ap_version", 2)
        .in("status", ["Menunggu Pembayaran", "Partial", "Dibayar"])
        .in("project_id", projectIds).order("expense_date", { ascending: false }).limit(500)
    : { data: [], error: null };
  if (error) throw new Error("Daftar AP untuk pembayaran gagal dimuat.");

  const expenseIds = (rows ?? []).map((row) => row.id);
  const [paymentResult, ledgerResult] = await Promise.all([
    expenseIds.length
      ? admin.from("expense_payments")
          .select("id,expense_id,payment_date,amount,payment_reference,notes,created_at")
          .eq("tenant_id", actor.tenantId).in("expense_id", expenseIds).eq("status", "Posted")
          .order("payment_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    projectIds.length
      ? admin.from("project_cash_ledger").select("project_id,amount")
          .eq("tenant_id", actor.tenantId).in("project_id", projectIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (paymentResult.error || ledgerResult.error) throw new Error("Riwayat pembayaran atau saldo Kasir gagal dimuat.");

  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const documents: CashierAp[] = (rows ?? []).map((row) => ({
    ...row,
    project_name: projectNames.get(row.project_id) ?? "Project",
  })) as CashierAp[];
  const payments = (paymentResult.data ?? []) as CashierPayment[];
  const balances: Record<string, number> = {};
  for (const entry of ledgerResult.data ?? []) balances[entry.project_id] = (balances[entry.project_id] ?? 0) + Number(entry.amount);

  return <CashierPaymentManager
    documents={documents}
    payments={payments}
    balances={balances}
    canPost={canPost}
    today={new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" })}
  />;
}
