import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import FundRequestManager, { type FundRequest, type ProjectOption } from "./manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FundRequestPage() {
  const actor = await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  const admin = createAdminClient();
  const [{ data: projects, error: projectError }, scopeResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("is_active", true).order("name"),
    actor.isOwner || actor.roles.some(r => r === "Finance" || r === "Management")
      ? Promise.resolve({ data: null, error: null })
      : admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id", actor.userId).eq("dimension", "project").maybeSingle(),
  ]);
  if (projectError || scopeResult.error) throw new Error("Data Project gagal dimuat.");
  let visibleProjects = (projects ?? []) as ProjectOption[];
  if (!actor.isOwner && !actor.roles.some(r => r === "Finance" || r === "Management")) {
    const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
    visibleProjects = scope?.scope_mode === "all"
      ? visibleProjects
      : visibleProjects.filter(p => scope?.scope_mode === "selected" && scope.resource_ids?.includes(p.id));
  }
  const visibleIds = visibleProjects.map(p => p.id);
  const [{ data: requests, error: requestError }, { data: ledger, error: ledgerError }] = await Promise.all([
    admin.from("fund_requests")
      .select("id,code,project_id,request_amount,purpose,status,requested_at,requested_by,executed_amount,payment_method,execution_note,executed_at,executed_by,projects(name,code),fund_request_documents(id,file_name,mime_type,file_size,uploaded_at)")
      .in("project_id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"])
      .order("requested_at", { ascending: false }).limit(300),
    admin.from("project_cash_ledger").select("project_id,amount").in("project_id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  if (requestError || ledgerError) throw new Error("Data permintaan atau saldo dana gagal dimuat.");
  const balances: Record<string, number> = {};
  for (const entry of ledger ?? []) balances[entry.project_id] = (balances[entry.project_id] ?? 0) + Number(entry.amount);
  return <FundRequestManager projects={visibleProjects} initialRequests={(requests ?? []) as unknown as FundRequest[]}
    balances={balances} canRequest={actor.isOwner || actor.roles.includes("Cashier")}
    canExecute={actor.isOwner || actor.roles.includes("Finance")}
    />;
}
