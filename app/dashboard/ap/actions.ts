"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, requireApPermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type ApLineInput = {
  expense_category_id: string;
  description: string;
  amount: number;
};
type ApDraftInput = {
  expense_date: string;
  recipient_supplier_id: string;
  project_id: string;
  sales_order_id?: string | null;
  summary?: string;
  lines: ApLineInput[];
};
type ApActionResult = { ok: true; id?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validate(input: ApDraftInput): string | null {
  if (!validDate(input?.expense_date)) return "Tanggal AP tidak valid.";
  if (!UUID.test(input?.recipient_supplier_id ?? "")) return "Supplier wajib dipilih.";
  if (!UUID.test(input?.project_id ?? "")) return "Project wajib dipilih.";
  if (input.sales_order_id && !UUID.test(input.sales_order_id)) return "Referensi BA/Invoice tidak valid.";
  if (input.summary !== undefined && (typeof input.summary !== "string" || input.summary.length > 1000)) return "Keterangan maksimal 1.000 karakter.";
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) return "AP harus memiliki 1 sampai 50 rincian biaya.";
  for (const [index, line] of input.lines.entries()) {
    if (!UUID.test(line?.expense_category_id ?? "")) return `Kategori pada rincian ${index + 1} wajib dipilih.`;
    if (typeof line.description !== "string" || line.description.length > 500) {
      return `Keterangan rincian ${index + 1} maksimal 500 karakter.`;
    }
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) return `Nominal rincian ${index + 1} harus berupa Rupiah positif.`;
  }
  return null;
}

function authorizationMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthorizationError) return error.message;
  return fallback;
}

function databaseMessage(message: string | undefined, fallback: string): string {
  const known: Array<[string, string]> = [
    ["Explicit AP permission is required", "Izin AP belum terbaca oleh layanan penyimpanan. Keluar lalu masuk kembali, kemudian coba lagi."],
    ["Finance role is required for AP", "Akun aktif belum terbaca dengan Role Finance. Periksa Role pengguna."],
    ["Project work scope does not permit AP access", "Scope Project akun ini belum mengizinkan Project yang dipilih."],
    ["Project is outside the actor work scope", "Project yang dipilih berada di luar Area Kerja akun ini."],
    ["Project is unavailable in the active tenant", "Project tidak tersedia pada perusahaan aktif."],
    ["Supplier is unavailable in the active tenant", "Supplier tidak tersedia atau tidak aktif pada perusahaan ini."],
    ["BA/Invoice is unavailable for the selected Project", "Referensi BA/Invoice tidak sesuai dengan Project yang dipilih."],
    ["Kategori ini memerlukan referensi BA", "Kategori biaya yang dipilih menggunakan formula. Pilih referensi BA agar nominal dapat dihitung."],
    ["Nilai dasar persentase belum tersedia pada BA", "Nilai dasar persentase belum tersedia pada BA yang dipilih."],
    ["Berat diterima belum tersedia pada BA", "Data berat diterima pada BA belum tersedia untuk menghitung biaya."],
    ["Nilai grade final belum tersedia pada BA", "Data grade final pada BA belum tersedia untuk menghitung biaya."],
    ["Berat diterima atau grade final belum tersedia pada BA", "Data berat atau grade final pada BA belum lengkap untuk menghitung biaya."],
    ["Formula menghasilkan nominal nol atau tidak valid", "Hasil formula kategori biaya nol atau tidak valid. Periksa tarif dan data BA."],
    ["Transaction deduction categories cannot be recorded as company AP", "Kategori ini merupakan potongan transaksi dan tidak dapat dicatat sebagai AP perusahaan."],
    ["Expense category is unavailable in the active tenant", "Kategori biaya tidak aktif atau tidak tersedia pada perusahaan ini."],
    ["AP line", "Rincian AP ditolak oleh validasi kategori atau nominal. Periksa kembali rincian biaya."],
    ["AP actor or tenant is inactive", "Akun Finance atau perusahaan aktif tidak dapat diverifikasi oleh layanan AP."],
  ];
  const match = known.find(([needle]) => message?.includes(needle));
  if (match) return match[1];
  if (message && /^[A-Za-z0-9 _.,:()%-]{1,180}$/.test(message)) {
    return `Penyimpanan ditolak oleh validasi: ${message}`;
  }
  return fallback;
}

export async function createApDraft(input: ApDraftInput): Promise<ApActionResult> {
  try {
    const actor = await requireApPermission("ap.create_edit");
    const invalid = validate(input);
    if (invalid) return { ok: false, error: invalid };
    if (!actor.tenantId) return { ok: false, error: "Perusahaan aktif tidak ditemukan." };

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("ap_create_draft_with_audit", {
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
      p_expense_date: input.expense_date,
      p_recipient_supplier_id: input.recipient_supplier_id,
      p_project_id: input.project_id,
      p_sales_order_id: input.sales_order_id || null,
      p_summary: (input.summary ?? "").trim() || null,
      p_lines: input.lines.map((line) => ({
        expense_category_id: line.expense_category_id,
        description: line.description.trim(),
        amount: line.amount,
      })),
    });
    if (error) {
      return { ok: false, error: databaseMessage(error.message, "Draft AP gagal disimpan. Periksa data dan Area Kerja akun Anda.") };
    }
    if (typeof data !== "string" || !UUID.test(data)) {
      return { ok: false, error: "Draft AP belum tersimpan karena layanan tidak mengembalikan nomor dokumen. Coba muat ulang." };
    }
    revalidatePath("/dashboard/ap");
    return { ok: true, id: data };
  } catch (error) {
    return { ok: false, error: authorizationMessage(error, "Penyimpanan Draft AP gagal karena sesi atau layanan akses tidak dapat diverifikasi. Muat ulang halaman dan coba lagi.") };
  }
}

export async function updateApDraft(expenseId: string, input: ApDraftInput): Promise<ApActionResult> {
  try {
    const actor = await requireApPermission("ap.create_edit");
    const invalid = validate(input);
    if (invalid) return { ok: false, error: invalid };
    if (!UUID.test(expenseId) || !actor.tenantId) return { ok: false, error: "Dokumen AP tidak valid." };

    const admin = createAdminClient();
    const { error } = await admin.rpc("ap_update_draft_with_audit", {
      p_expense_id: expenseId,
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
      p_expense_date: input.expense_date,
      p_recipient_supplier_id: input.recipient_supplier_id,
      p_project_id: input.project_id,
      p_sales_order_id: input.sales_order_id || null,
      p_summary: (input.summary ?? "").trim() || null,
      p_lines: input.lines.map((line) => ({
        expense_category_id: line.expense_category_id,
        description: line.description.trim(),
        amount: line.amount,
      })),
    });
    if (error) return { ok: false, error: databaseMessage(error.message, "Perubahan Draft AP gagal disimpan. Periksa status dokumen dan Area Kerja akun Anda.") };
    revalidatePath("/dashboard/ap");
    return { ok: true, id: expenseId };
  } catch (error) {
    return { ok: false, error: authorizationMessage(error, "Perubahan Draft AP gagal karena sesi atau layanan akses tidak dapat diverifikasi. Muat ulang halaman dan coba lagi.") };
  }
}

export async function submitApDocument(expenseId: string): Promise<ApActionResult> {
  try {
    const actor = await requireApPermission("ap.submit");
    if (!UUID.test(expenseId) || !actor.tenantId) return { ok: false, error: "Dokumen AP tidak valid." };
    const admin = createAdminClient();
    const { error } = await admin.rpc("ap_submit_with_audit", {
      p_expense_id: expenseId,
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
    });
    if (error) return { ok: false, error: databaseMessage(error.message, "AP gagal disubmit. Pastikan dokumen masih Draft dan datanya valid.") };
    revalidatePath("/dashboard/ap");
    return { ok: true, id: expenseId };
  } catch (error) {
    return { ok: false, error: authorizationMessage(error, "Proses submit AP gagal karena sesi atau layanan akses tidak dapat diverifikasi. Muat ulang halaman dan coba lagi.") };
  }
}
