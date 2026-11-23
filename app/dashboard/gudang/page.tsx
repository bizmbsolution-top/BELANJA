import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import WarehouseManager, { type Warehouse } from "./warehouse-manager";

const WAREHOUSE_ROLES = ["Procurement", "Warehouse", "Finance", "Management"] as const;

export default async function WarehousePage() {
  const context = await requireAnyRole(WAREHOUSE_ROLES);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("warehouses")
    .select("id, code, name, location, description, is_active")
    .order("name", { ascending: true })
    .limit(500);
  if (error) throw new Error("Data gudang gagal dimuat. Silakan muat ulang halaman.");
  const [{ data: projects, error: projectError }, { data: mappings, error: mappingError }] = await Promise.all([
    admin.from("projects").select("id, code, name").eq("is_active", true).order("name", { ascending: true }),
    admin.from("warehouse_projects").select("warehouse_id, project_id"),
  ]);
  if (projectError || mappingError) throw new Error("Hubungan Project dan Warehouse gagal dimuat.");
  const projectIdsByWarehouse = new Map<string, string[]>();
  for (const row of mappings ?? []) projectIdsByWarehouse.set(row.warehouse_id, [...(projectIdsByWarehouse.get(row.warehouse_id) ?? []), row.project_id]);
  const warehouses = (data ?? []).map(item => ({ ...item, projectIds: projectIdsByWarehouse.get(item.id) ?? [] }));
  return <WarehouseManager initialWarehouses={warehouses as Warehouse[]} initialProjects={projects ?? []} canManageAssignments={context.tenantRole === "superadmin"} />;
}
