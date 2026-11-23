import { guardPage, requireOwner } from "@/lib/auth/authorization";
import { getManagedUsers } from "./actions";
import UserAccess from "./user-access";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsersPage() {
  await guardPage(requireOwner);

  const users = await getManagedUsers();
  const admin = createAdminClient();
  const [{ data: projects, error: projectError }, { data: mappings, error: mappingError }, { data: warehouses, error: warehouseError }] = await Promise.all([
    admin.from("projects").select("id, code, name").eq("is_active", true).order("name", { ascending: true }),
    admin.from("warehouse_projects").select("warehouse_id, project_id"),
    admin.from("warehouses").select("id, code, name").eq("is_active", true).order("name", { ascending: true }),
  ]);
  if (projectError || mappingError || warehouseError) throw new Error("Daftar Project dan Warehouse gagal dimuat.");
  const projectIdsByWarehouse = new Map<string, string[]>();
  for (const row of mappings ?? []) projectIdsByWarehouse.set(row.warehouse_id, [...(projectIdsByWarehouse.get(row.warehouse_id) ?? []), row.project_id]);
  const initialWarehouses = (warehouses ?? []).map(w => ({ ...w, projectIds: projectIdsByWarehouse.get(w.id) ?? [] }));
  return <UserAccess initialUsers={users} initialProjects={projects ?? []} initialWarehouses={initialWarehouses} />;
}