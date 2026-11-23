import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import SupplierManager, { type Supplier } from "./supplier-manager";

const SUPPLIER_ROLES = ["Procurement", "Finance", "Management"] as const;

export default async function SupplierPage() {
  const context = await requireAnyRole(SUPPLIER_ROLES);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("suppliers")
    .select("id, code, name, contact_person, phone, email, address, notes, is_active").eq("tenant_id", context.tenantId)
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error("Data supplier gagal dimuat. Silakan muat ulang halaman.");
  }

  return <SupplierManager initialSuppliers={(data ?? []) as Supplier[]} />;
}
