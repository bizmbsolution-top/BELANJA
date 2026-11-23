import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import WarehouseManager, { type Warehouse } from "./warehouse-manager";

const WAREHOUSE_ROLES = ["Procurement", "Warehouse", "Finance", "Management"] as const;

export default async function WarehousePage() {
  await requireAnyRole(WAREHOUSE_ROLES);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("warehouses")
    .select("id, code, name, location, description, is_active")
    .order("name", { ascending: true })
    .limit(500);
  if (error) throw new Error("Data gudang gagal dimuat. Silakan muat ulang halaman.");
  return <WarehouseManager initialWarehouses={(data ?? []) as Warehouse[]} />;
}
