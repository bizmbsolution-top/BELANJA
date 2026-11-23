import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import CustomerManager, { type Customer } from "./customer-manager";
export default async function PelangganPage() {
  const actor = await requireAnyRole(["Sales", "Management"]);
  const { data, error } = await createAdminClient().from("customers")
    .select("id,code,name,phone,email,address,notes,is_active,created_at").order("name").limit(500);
  if (error) throw new Error("Data pelanggan gagal dimuat.");
  return <CustomerManager initialCustomers={(data ?? []) as Customer[]} canEdit={actor.isOwner || actor.roles.includes("Sales")} />;
}
