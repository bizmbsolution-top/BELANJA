"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };
async function canWrite(userId: string, isOwner: boolean) {
  if (isOwner) return true;
  const { data, error } = await createAdminClient().from("user_permission_overrides").select("effect")
    .eq("user_id", userId).eq("permission_key", "transaction.post_recognition").maybeSingle();
  return !error && data?.effect === "allow";
}
export async function saveCustomer(input: {
  id?: string; name: string; phone: string; email: string; billingAddress: string; notes: string; active: boolean; warehouseAddresses: {id?:string;label:string;address:string}[];
}): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Sales"]);
    if (!(await canWrite(actor.userId, actor.isOwner))) return { ok: false, error: "Permission transaksi belum diberikan oleh Owner." };
    if (!input.name?.trim() || input.name.trim().length < 2) return { ok: false, error: "Nama pelanggan minimal 2 karakter." };
    const { data, error } = await createAdminClient().rpc("save_customer_with_addresses_with_audit", {
      p_customer_id: input.id || null, p_actor_user_id: actor.userId, p_name: input.name,
      p_phone: input.phone, p_email: input.email, p_address: input.address, p_notes: input.notes,
      p_is_active: input.active,
    });
    if (error || !data) return { ok: false, error: error?.message ?? "Pelanggan gagal disimpan." };
    revalidatePath("/dashboard/pelanggan"); revalidatePath("/dashboard/penjualan");
    return { ok: true, id: data as string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Pelanggan gagal disimpan." }; }
}
