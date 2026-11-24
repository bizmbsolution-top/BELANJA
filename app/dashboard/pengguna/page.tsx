import { guardPage, requireOwner } from "@/lib/auth/authorization";
import { getManagedUsers } from "./actions";
import UserAccess from "./user-access";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsersPage() {
  const owner = await guardPage(requireOwner);
  if (!owner.tenantId) throw new Error("Perusahaan aktif tidak ditemukan.");

  const users = await getManagedUsers();
  const admin = createAdminClient();
  const [
    { data: tenant, error: tenantError },
    { data: projects, error: projectError },
    { data: mappings, error: mappingError },
    { data: warehouses, error: warehouseError },
  ] = await Promise.all([
    admin.from("tenants").select("name").eq("id", owner.tenantId).maybeSingle(),
    admin.from("projects").select("id, code, name").eq("tenant_id", owner.tenantId).eq("is_active", true).order("name", { ascending: true }),
    admin.from("warehouse_projects").select("warehouse_id, project_id").eq("tenant_id", owner.tenantId),
    admin.from("warehouses").select("id, code, name").eq("tenant_id", owner.tenantId).eq("is_active", true).order("name", { ascending: true }),
  ]);

  if (tenantError || !tenant?.name) throw new Error("Nama perusahaan aktif gagal dimuat.");
  if (projectError || mappingError || warehouseError) throw new Error("Daftar Project dan Warehouse gagal dimuat.");

  const projectIdsByWarehouse = new Map<string, string[]>();
  for (const row of mappings ?? []) {
    projectIdsByWarehouse.set(row.warehouse_id, [
      ...(projectIdsByWarehouse.get(row.warehouse_id) ?? []),
      row.project_id,
    ]);
  }
  const initialWarehouses = (warehouses ?? []).map((warehouse) => ({
    ...warehouse,
    projectIds: projectIdsByWarehouse.get(warehouse.id) ?? [],
  }));

  return (
    <UserAccess
      organizationName={tenant.name}
      initialUsers={users}
      initialProjects={projects ?? []}
      initialWarehouses={initialWarehouses}
    />
  );
}
