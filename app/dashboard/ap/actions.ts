"use server";

import { revalidatePath } from "next/cache";
import { requireApPermission } from "@/lib/auth/authorization";
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
  if (typeof input.summary !== "string" || input.summary.length > 1000) return "Keterangan maksimal 1.000 karakter.";
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) return "AP harus memiliki 1 sampai 50 rincian biaya.";
  for (const [index, line] of input.lines.entries()) {
    if (!UUID.test(line?.expense_category_id ?? "")) return `Kategori pada rincian ${index + 1} wajib dipilih.`;
    if (typeof line.description !== "string" || !line.description.trim() || line.description.trim().length > 500) {
      return `Keterangan rincian ${index + 1} wajib diisi (maksimal 500 karakter).`;
    }
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) return `Nominal rincian ${index + 1} harus berupa Rupiah positif.`;
  }
  return null;
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
      p_summary: input.summary.trim() || null,
      p_lines: input.lines.map((line) => ({
        expense_category_id: line.expense_category_id,
        description: line.description.trim(),
        amount: line.amount,
      })),
    });
    if (error || typeof data !== "string" || !UUID.test(data)) {
      return { ok: false, error: "Draft AP gagal disimpan. Periksa kembali data dan akses Anda." };
    }
    revalidatePath("/dashboard/ap");
    return { ok: true, id: data };
  } catch {
    return { ok: false, error: "Akses atau penyimpanan Draft AP gagal. Muat ulang halaman dan coba lagi." };
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
      p_summary: input.summary.trim() || null,
      p_lines: input.lines.map((line) => ({
        expense_category_id: line.expense_category_id,
        description: line.description.trim(),
        amount: line.amount,
      })),
    });
    if (error) return { ok: false, error: "Perubahan Draft AP gagal disimpan. Periksa status dan akses Anda." };
    revalidatePath("/dashboard/ap");
    return { ok: true, id: expenseId };
  } catch {
    return { ok: false, error: "Akses atau perubahan Draft AP gagal. Muat ulang halaman dan coba lagi." };
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
    if (error) return { ok: false, error: "AP gagal disubmit. Pastikan dokumen masih Draft dan datanya valid." };
    revalidatePath("/dashboard/ap");
    return { ok: true, id: expenseId };
  } catch {
    return { ok: false, error: "Akses atau proses submit AP gagal. Muat ulang halaman dan coba lagi." };
  }
}
