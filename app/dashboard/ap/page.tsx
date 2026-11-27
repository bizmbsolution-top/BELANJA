import { requireAnyRole, guardPage } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ApManager, { type ApDocument, type ApLine, type ApReference } from "./manager";
import type { ApSupplierOption } from "./recipient-field";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApPage() {
  const actor = await guardPage(() => requireAnyRole(["Finance"]));
  const admin = createAdminClient();

  // The route remains read-only/disabled until both database stages are installed.
  const [headerProbe, lineProbe, stageBProbe] = await Promise.all([
    admin.from("expenses").select("id,ap_version,recipient_supplier_id,recipient_name").limit(1),
    admin.from("expense_items").select("id").limit(1),
    admin.from("ap_schema_versions").select("version").eq("version", "stage_b_draft_v1").maybeSingle(),
  ]);
  if (headerProbe.error || lineProbe.error || stageBProbe.error || !stageBProbe.data) {
    return <ApManager enabled={false} documents={[]} lines={[]} />;
  }

  const [{ data: allProjects, error: projectError }, { data: categories, error: categoryError },
    { data: supplierRows, error: supplierError }, scopeResult, permissionResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("expense_categories").select("id,name,expense_type,calculation_method,calculation_basis,calculation_rate").eq("tenant_id", actor.tenantId).eq("is_active", true).eq("expense_type","company_payable").order("name"),
    admin.from("suppliers").select("id,code,name,contact_person,phone,email,address,notes,is_active")
      .eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    actor.tenantRole !== "superadmin"
      ? admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
          .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    actor.tenantRole === "superadmin"
      ? Promise.resolve({ data: [], error: null })
      : admin.from("tenant_user_permission_overrides").select("permission_key,effect")
          .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId)
          .in("permission_key", ["ap.create_edit", "ap.submit"]),
  ]);
  if (projectError || supplierError || scopeResult.error || permissionResult.error) {
    throw new Error("Data referensi AP gagal dimuat.");
  }

  let usableCategories=categories;
  if(categoryError){const fallback=await admin.from("expense_categories").select("id,name").eq("tenant_id",actor.tenantId).eq("is_active",true).order("name");usableCategories=(fallback.data??[]).map(x=>({...x,expense_type:"company_payable",calculation_method:"manual",calculation_basis:"manual",calculation_rate:null}));}
  if(categoryError && !usableCategories?.length)throw new Error("Kategori pengeluaran gagal dimuat.");
  const all = allProjects ?? [];
  const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
  const projects = actor.tenantRole === "superadmin" || scope?.scope_mode === "all"
    ? all
    : all.filter((project) => scope?.scope_mode === "selected" && scope.resource_ids?.includes(project.id));
  if (!projects.length) return <ApManager
    enabled
    documents={[]}
    lines={[]}
    suppliers={(supplierRows ?? []) as ApSupplierOption[]}
    projects={[]}
    categories={usableCategories ?? []}
    formulaConfigReady={!categoryError}
    references={[]}
    canCreateEdit={actor.tenantRole === "superadmin" || (permissionResult.data ?? []).some((item) => item.permission_key === "ap.create_edit" && item.effect === "allow")}
    canSubmit={actor.tenantRole === "superadmin" || (permissionResult.data ?? []).some((item) => item.permission_key === "ap.submit" && item.effect === "allow")}
  />;

  const projectIds = projects.map((project) => project.id);
  const [{ data: rows, error }, { data: salesOrders, error: salesError }] = await Promise.all([
    admin.from("expenses")
      .select("id,code,expense_date,recipient_name,recipient_supplier_id,project_id,sales_order_id,description,amount,status,created_at,created_by")
      .eq("tenant_id", actor.tenantId).eq("ap_version", 2)
      .in("project_id", projectIds).order("created_at", { ascending: false }).limit(300),
    admin.from("sales_orders")
      .select("id,code,ba_number,project_id,ba_date,final_amount,dispatched_purchase_cost,received_weight_kg,final_grade_value,customer_id")
      .eq("tenant_id", actor.tenantId).eq("status", "Selesai")
      .in("project_id", projectIds).order("ba_date", { ascending: false }).limit(300),
  ]);
  if (error || salesError) throw new Error("Daftar AP atau referensi BA gagal dimuat.");

  const ids = (rows ?? []).map((row) => row.id);
  const actualLines = ids.length
    ? await admin.from("expense_items")
        .select("id,expense_id,line_number,expense_category_id,description,amount")
        .eq("tenant_id", actor.tenantId).in("expense_id", ids).order("line_number")
    : { data: [], error: null };
  if (actualLines.error) throw new Error("Rincian AP gagal dimuat.");

  const customerIds = [...new Set((salesOrders ?? []).map((item) => item.customer_id))];
  const customerResult = customerIds.length
    ? await admin.from("customers").select("id,name").eq("tenant_id", actor.tenantId).in("id", customerIds)
    : { data: [], error: null };
  if (customerResult.error) throw new Error("Nama pelanggan pada referensi BA gagal dimuat.");

  const documents: ApDocument[] = (rows ?? []).map((row) => ({
    ...row,
    project: projects.find((project) => project.id === row.project_id)?.name ?? "Project",
  })) as ApDocument[];
  const categoryNames = new Map((usableCategories ?? []).map((category) => [category.id, category.name]));
  const lines: ApLine[] = (actualLines.data ?? []).map((line) => ({
    ...line,
    category_name: categoryNames.get(line.expense_category_id) ?? "Kategori tidak tersedia",
  })) as ApLine[];
  const customerNames = new Map((customerResult.data ?? []).map((customer) => [customer.id, customer.name]));
  const references: ApReference[] = (salesOrders ?? []).map((item) => ({
    ...item,
    customer_name: customerNames.get(item.customer_id) ?? "Pelanggan",
  })) as ApReference[];
  const suppliers: ApSupplierOption[] = (supplierRows ?? []) as ApSupplierOption[];
  const permissions = permissionResult.data ?? [];
  const isSuperadmin = actor.tenantRole === "superadmin";

  return <ApManager
    enabled
    documents={documents}
    lines={lines}
    suppliers={suppliers}
    projects={projects.map(({ id, name }) => ({ id, name }))}
    categories={usableCategories ?? []}
    references={references}
    canCreateEdit={isSuperadmin || permissions.some((item) => item.permission_key === "ap.create_edit" && item.effect === "allow")}
    canSubmit={isSuperadmin || permissions.some((item) => item.permission_key === "ap.submit" && item.effect === "allow")}
    formulaConfigReady={!categoryError}
  />;
}
