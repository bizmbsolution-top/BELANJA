"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };
export async function saveCustomer(input: {
  id?: string; name: string; phone: string; email: string; billingAddress: string; notes: string; active: boolean; warehouseAddresses: {id?:string;label:string;address:string}[];
}): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Sales"]);
    if (!actor.tenantId) return { ok: false, error: "Tenant aktif tidak ditemukan." };
    if (!input.name?.trim() || input.name.trim().length < 2) return { ok: false, error: "Nama pelanggan minimal 2 karakter." };
    if (input.id) {
      const { data: existing, error: lookupError } = await createAdminClient().from("customers").select("id").eq("tenant_id", actor.tenantId).eq("id", input.id).maybeSingle();
      if (lookupError || !existing) return { ok: false, error: "Pelanggan tidak ditemukan pada perusahaan aktif." };
    }
    const { data, error } = await createAdminClient().rpc("save_customer_with_addresses_with_audit", {
      p_customer_id: input.id || null, p_actor_user_id: actor.userId, p_tenant_id: actor.tenantId, p_name: input.name,
      p_phone: input.phone, p_email: input.email, p_billing_address: input.billingAddress, p_notes: input.notes,
      p_is_active: input.active, p_warehouse_addresses: input.warehouseAddresses,
    });
    if (error || !data) return { ok: false, error: error?.message ?? "Pelanggan gagal disimpan." };
    revalidatePath("/dashboard/pelanggan"); revalidatePath("/dashboard/penjualan");
    return { ok: true, id: data as string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Pelanggan gagal disimpan." }; }
}
