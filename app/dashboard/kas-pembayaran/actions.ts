"use server";

import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type PaymentResult = { ok: true; paymentId: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function postApCashierPayment(input: {
  expenseId: string;
  paymentDate: string;
  amount: number;
  reference?: string;
  notes?: string;
}): Promise<PaymentResult> {
  try {
    const actor = await getAccessContext();
    if (actor.isOwner || !actor.tenantId) return { ok: false, error: "Akun ini bukan pengguna operasional perusahaan." };
    const isSuperadmin = actor.tenantRole === "superadmin";
    if (!isSuperadmin) {
      if (!actor.roles.includes("Cashier")) return { ok: false, error: "Pembayaran tunai AP hanya dapat dicatat oleh Role Cashier." };
      const admin = createAdminClient();
      const { data, error } = await admin.from("tenant_user_permission_overrides")
        .select("effect").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId)
        .eq("permission_key", "payment.post").maybeSingle();
      if (error) return { ok: false, error: "Izin payment.post tidak dapat diverifikasi." };
      if (data?.effect !== "allow") return { ok: false, error: "Akun ini belum memiliki izin Catat Pembayaran (payment.post)." };
    }
    if (!UUID.test(input?.expenseId ?? "")) return { ok: false, error: "Dokumen AP tidak valid." };
    if (typeof input.paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
      return { ok: false, error: "Tanggal pembayaran tidak valid." };
    }
    const [year, month, day] = input.paymentDate.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      return { ok: false, error: "Tanggal pembayaran tidak valid." };
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return { ok: false, error: "Nominal harus berupa Rupiah positif tanpa desimal." };
    if ((input.reference ?? "").length > 160 || (input.notes ?? "").length > 500) {
      return { ok: false, error: "Referensi maksimal 160 karakter dan catatan maksimal 500 karakter." };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("ap_post_cashier_payment_with_audit", {
      p_expense_id: input.expenseId,
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
      p_payment_date: input.paymentDate,
      p_amount: input.amount,
      p_payment_reference: (input.reference ?? "").trim() || null,
      p_notes: (input.notes ?? "").trim() || null,
    });
    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("exceeds AP outstanding")) return { ok: false, error: "Nominal melebihi sisa kewajiban AP." };
      if (msg.includes("Insufficient project cashier")) return { ok: false, error: "Saldo Kasir Project tidak mencukupi." };
      if (msg.includes("not awaiting payment")) return { ok: false, error: "AP tidak lagi menunggu pembayaran atau sudah lunas." };
      if (msg.includes("outside Cashier work scope")) return { ok: false, error: "Project AP berada di luar Area Kerja akun Kasir." };
      if (msg.includes("Cashier role")) return { ok: false, error: "Role Cashier diperlukan untuk pembayaran tunai." };
      if (msg.includes("payment.post")) return { ok: false, error: "Izin Catat Pembayaran belum diberikan." };
      if (msg.includes("date is invalid")) return { ok: false, error: "Tanggal pembayaran tidak valid atau berada di masa depan." };
      return { ok: false, error: `Pembayaran ditolak database: ${msg.replace(/[\\u0000-\\u001f\\u007f]/g, " ").slice(0, 220)}` };
    }
    if (typeof data !== "string" || !UUID.test(data)) return { ok: false, error: "Layanan pembayaran tidak mengembalikan nomor transaksi." };
    revalidatePath("/dashboard/kas-pembayaran");
    revalidatePath("/dashboard/ap");
    revalidatePath("/dashboard/permintaan-penggunaan-dana");
    return { ok: true, paymentId: data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Pembayaran gagal diproses." };
  }
}
