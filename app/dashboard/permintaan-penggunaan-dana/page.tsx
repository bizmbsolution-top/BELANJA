import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import FundRequestManager, { type FundRequest, type ProjectOption } from "./manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FundRequestPage() {
  const actor = await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  const admin = createAdminClient();
  const needsCashierScope = actor.tenantRole !== "superadmin" && actor.roles.includes("Cashier");
  const [{ data: projects, error: projectError }, scopeResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    needsCashierScope
      ? admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectError || scopeResult.error) throw new Error("Data Project gagal dimuat.");
  const allProjects = (projects ?? []) as ProjectOption[];
  let requestProjects: ProjectOption[] = [];
  if (actor.tenantRole === "superadmin") requestProjects = allProjects;
  else if (needsCashierScope) {
    const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
    requestProjects = scope?.scope_mode === "all" ? allProjects
      : allProjects.filter(p => scope?.scope_mode === "selected" && scope.resource_ids?.includes(p.id));
  }
  const canSeeAllProjects = actor.tenantRole === "superadmin" || actor.roles.some(r => r === "Finance" || r === "Management");
  const visibleProjects = canSeeAllProjects ? allProjects : requestProjects;
  const visibleIds = visibleProjects.map(p => p.id);
  const [{ data: requests, error: requestError }, { data: ledger, error: ledgerError }] = await Promise.all([
    admin.from("fund_requests")
      .select("id,code,project_id,request_amount,purpose,status,requested_at,requested_by,executed_amount,payment_method,execution_note,executed_at,executed_by,projects(name,code),fund_request_documents(id,file_name,mime_type,file_size,uploaded_at)").eq("tenant_id", actor.tenantId)
      .in("project_id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"])
      .order("requested_at", { ascending: false }).limit(300),
    admin.from("project_cash_ledger").select("project_id,amount").eq("tenant_id", actor.tenantId).in("project_id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  if (requestError || ledgerError) throw new Error("Data permintaan atau saldo dana gagal dimuat.");
  const balances: Record<string, number> = {};
  for (const entry of ledger ?? []) balances[entry.project_id] = (balances[entry.project_id] ?? 0) + Number(entry.amount);
  return <FundRequestManager projects={visibleProjects} requestProjects={requestProjects}
    initialRequests={(requests ?? []) as unknown as FundRequest[]} balances={balances}
    canRequest={actor.tenantRole === "superadmin" || (actor.roles.includes("Cashier") && requestProjects.length > 0)}
    canExecute={actor.tenantRole === "superadmin" || actor.roles.includes("Finance")} />;
}
