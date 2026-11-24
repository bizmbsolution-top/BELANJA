import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import CustomerManager, { type Customer } from "./customer-manager";
export default async function PelangganPage() {
  const actor = await requireAnyRole(["Sales", "Management"]);
  const { data, error } = await createAdminClient().from("customers")
    .select("id,code,name,phone,email,billing_address,notes,is_active,created_at,customer_warehouse_addresses(id,label,address,is_active,tenant_id)").eq("tenant_id", actor.tenantId).order("name").limit(500);
  if (error) throw new Error("Data pelanggan gagal dimuat.");
  return <CustomerManager initialCustomers={(data ?? []).map(c=>({...c,warehouse_addresses:(c.customer_warehouse_addresses??[]).filter(a=>a.is_active && a.tenant_id===actor.tenantId)})) as Customer[]} canEdit={actor.isOwner || actor.roles.includes("Sales")} />;
}
