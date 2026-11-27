import { requireAnyRole, guardPage } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ApManager, { type ApDocument, type ApLine } from "./manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApPage() {
  const actor = await guardPage(() => requireAnyRole(["Finance"]));
  const admin = createAdminClient();

  // Stage A is intentionally not assumed to exist: production schema remains
  // untouched until a separately approved migration and verification.
  const [headerProbe, lineProbe] = await Promise.all([
    admin.from("expenses").select("id,ap_version,recipient_supplier_id,recipient_name").limit(1),
    admin.from("expense_items").select("id").limit(1),
  ]);
  if (headerProbe.error || lineProbe.error) {
    return <ApManager enabled={false} documents={[]} lines={[]} />;
  }

  const [{ data: allProjects, error: projectError }, scopeResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    actor.tenantRole !== "superadmin"
      ? admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
          .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (projectError || scopeResult.error) throw new Error("Data Project untuk AP gagal dimuat.");

  const all = allProjects ?? [];
  const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
  const projects = actor.tenantRole === "superadmin" || scope?.scope_mode === "all"
    ? all
    : all.filter((project) => scope?.scope_mode === "selected" && scope.resource_ids?.includes(project.id));
  if (!projects.length) return <ApManager enabled documents={[]} lines={[]} />;

  const { data: rows, error } = await admin.from("expenses")
    .select("id,code,expense_date,recipient_name,project_id,description,amount,status,created_at,created_by")
    .eq("tenant_id", actor.tenantId).eq("ap_version", 2)
    .in("project_id", projects.map((project) => project.id))
    .order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error("Daftar AP gagal dimuat.");

  const ids = (rows ?? []).map((row) => row.id);
  const { data: lineRows, error: lineError } = ids.length
    ? await admin.from("expense_items")
        .select("id,expense_id,line_number,expense_category_id,description,amount")
        .eq("tenant_id", actor.tenantId).in("expense_id", ids).order("line_number")
    : { data: [], error: null };
  if (lineError) throw new Error("Rincian AP gagal dimuat.");

  const documents: ApDocument[] = (rows ?? []).map((row) => ({
    ...row,
    project: projects.find((project) => project.id === row.project_id)?.name ?? "Project",
  })) as ApDocument[];
  return <ApManager enabled documents={documents} lines={(lineRows ?? []) as ApLine[]} />;
}
