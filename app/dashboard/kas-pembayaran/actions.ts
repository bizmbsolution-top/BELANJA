"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAccessContext } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type PaymentResult = { ok: true; paymentId: string } | { ok: false; error: string };
type EvidenceResult = { ok: true; fileName: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVIDENCE_BUCKET = "expense-payment-evidence";
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

async function verifyCashierPaymentAccess(paymentId: string) {
  const actor = await getAccessContext();
  if (actor.isOwner || !actor.tenantId) throw new Error("Akun ini bukan pengguna operasional perusahaan.");
  const isSuperadmin = actor.tenantRole === "superadmin";
  if (!isSuperadmin) {
    if (!actor.roles.includes("Cashier")) throw new Error("Bukti pembayaran tunai hanya dapat dikelola oleh Role Cashier.");
    const admin = createAdminClient();
    const { data: permission, error: permissionError } = await admin.from("tenant_user_permission_overrides")
      .select("effect").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId)
      .eq("permission_key", "payment.post").maybeSingle();
    if (permissionError || permission?.effect !== "allow") throw new Error("Izin payment.post belum aktif.");
  }

  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin.from("expense_payments")
    .select("id,tenant_id,expense_id,cashier_project_id,status")
    .eq("id", paymentId).eq("tenant_id", actor.tenantId).maybeSingle();
  if (paymentError || !payment || payment.status !== "Posted") throw new Error("Pembayaran tidak ditemukan atau tidak berstatus Posted.");

  const { data: expense, error: expenseError } = await admin.from("expenses")
    .select("id,tenant_id,project_id,ap_version")
    .eq("id", payment.expense_id).eq("tenant_id", actor.tenantId).maybeSingle();
  if (expenseError || !expense || expense.ap_version !== 2 || expense.project_id !== payment.cashier_project_id) {
    throw new Error("Dokumen AP atau Project pembayaran tidak valid.");
  }

  if (!isSuperadmin) {
    const { data: scope, error: scopeError } = await admin.from("tenant_user_work_scopes")
      .select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId)
      .eq("user_id", actor.userId).eq("dimension", "project").maybeSingle();
    if (scopeError || !(scope?.scope_mode === "all" || (scope?.scope_mode === "selected" && scope.resource_ids?.includes(expense.project_id)))) {
      throw new Error("Project pembayaran berada di luar Area Kerja akun Kasir.");
    }
  }
  return { actor, admin };
}

export async function uploadApPaymentEvidence(paymentId: string, file: File): Promise<EvidenceResult> {
  let objectPath: string | null = null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try {
    if (!UUID.test(paymentId)) return { ok: false, error: "Nomor pembayaran tidak valid." };
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
      return { ok: false, error: "File harus berukuran maksimal 10 MB." };
    }
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
    if (!allowed.has(file.type)) return { ok: false, error: "Format bukti harus PDF, JPG, atau PNG." };

    const { actor, admin: adminClient } = await verifyCashierPaymentAccess(paymentId);
    admin = adminClient;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
    if (!(isPdf && file.type === "application/pdf") && !(isJpeg && file.type === "image/jpeg") && !(isPng && file.type === "image/png")) {
      return { ok: false, error: "Isi file tidak sesuai dengan format yang dipilih." };
    }

    const rawName = file.name.split(/[\\/]/).pop() ?? "bukti";
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "bukti";
    const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : "png";
    objectPath = `${actor.tenantId}/${paymentId}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage.from(EVIDENCE_BUCKET).upload(objectPath, bytes, {
      contentType: file.type, cacheControl: "3600", upsert: false,
    });
    if (uploadError) throw new Error("Upload ke penyimpanan bukti gagal: " + uploadError.message);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: insertError } = await admin.from("expense_payment_evidence").insert({
      tenant_id: actor.tenantId,
      expense_payment_id: paymentId,
      object_path: objectPath,
      original_file_name: safeName,
      mime_type: file.type,
      byte_size: bytes.byteLength,
      sha256,
      uploaded_by: actor.userId,
    });
    if (insertError) throw new Error("File terunggah tetapi pencatatan bukti gagal: " + insertError.message);

    revalidatePath("/dashboard/kas-pembayaran");
    return { ok: true, fileName: safeName };
  } catch (error) {
    if (objectPath && admin) {
      try { await admin.storage.from(EVIDENCE_BUCKET).remove([objectPath]); } catch { /* best-effort cleanup */ }
    }
    return { ok: false, error: error instanceof Error ? error.message : "Upload bukti pembayaran gagal." };
  }
}

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
    if (typeof input.paymentDate !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(input.paymentDate)) {
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
