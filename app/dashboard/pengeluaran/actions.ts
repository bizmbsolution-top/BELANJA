"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const ROLES = ["Cashier", "Finance", "Management"] as const;
const BUCKET = "expense-billings";
const MAX_SIZE = 10 * 1024 * 1024;
type Result = { ok: true; id?: string; url?: string } | { ok: false; error: string };
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export async function createExpense(input: { expenseDate: string; categoryId: string; description: string; amount: string; paymentMethod: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(ROLES);
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    const amount = Number(input?.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.expenseDate ?? "")) return { ok: false, error: "Tanggal pengeluaran tidak valid." };
    if (!uuid(input?.categoryId ?? "")) return { ok: false, error: "Kategori expenses wajib dipilih." };
    if (!description || description.length > 1000) return { ok: false, error: "Keterangan wajib diisi (maksimal 1.000 karakter)." };
    if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999999999) return { ok: false, error: "Nominal pengeluaran tidak valid." };
    if (!["Tunai", "Transfer", "Kartu", "E-Wallet", "Lainnya"].includes(input.paymentMethod)) return { ok: false, error: "Metode pembayaran tidak valid." };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("create_expense_with_audit", {
      p_actor_user_id: actor.userId, p_expense_date: input.expenseDate, p_expense_category_id: input.categoryId,
      p_description: description, p_amount: amount, p_payment_method: input.paymentMethod,
    });
    if (error || !data) return { ok: false, error: "Pengeluaran gagal disimpan. Periksa kategori dan data transaksi." };
    return { ok: true, id: data as string };
  } catch { return { ok: false, error: "Akses atau penyimpanan pengeluaran gagal. Silakan muat ulang halaman." }; }
}

export async function cancelExpense(expenseId: string, reason: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(ROLES);
    if (!uuid(expenseId)) return { ok: false, error: "Transaksi tidak valid." };
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason || cleanReason.length > 500) return { ok: false, error: "Alasan pembatalan wajib diisi (maksimal 500 karakter)." };
    const { error } = await createAdminClient().rpc("cancel_expense_with_audit", {
      p_expense_id: expenseId, p_actor_user_id: actor.userId, p_reason: cleanReason,
    });
    if (error) return { ok: false, error: "Transaksi gagal dibatalkan. Pastikan transaksi masih aktif." };
    return { ok: true };
  } catch { return { ok: false, error: "Akses pembatalan gagal. Silakan muat ulang halaman." }; }
}

export async function uploadExpenseDocuments(expenseId: string, formData: FormData): Promise<Result> {
  try {
    const actor = await requireAnyRole(ROLES);
    if (!uuid(expenseId)) return { ok: false, error: "Transaksi tidak valid." };
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) return { ok: false, error: "Pilih minimal satu file." };
    if (files.length > 15) return { ok: false, error: "Maksimal 15 file dalam satu kali unggah." };
    if (files.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) return { ok: false, error: "Total ukuran file dalam satu kali unggah maksimal 20 MB." };
    const admin = createAdminClient();
    const { data: expense } = await admin.from("expenses").select("id,status").eq("id", expenseId).maybeSingle();
    if (!expense || expense.status !== "Aktif") return { ok: false, error: "Dokumen hanya dapat ditambahkan pada transaksi aktif." };
    for (const file of files) {
      if (file.size > MAX_SIZE) return { ok: false, error: `File ${file.name} melebihi 10 MB.` };
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return { ok: false, error: `Format file ${file.name} tidak didukung. Gunakan PDF, JPG, atau PNG.` };
    }
    for (const file of files) {
      const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "billing";
      const path = `${expenseId}/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) return { ok: false, error: `File ${file.name} gagal diunggah. ${uploadError.message}` };
      const { error: recordError } = await admin.rpc("register_expense_document_with_audit", {
        p_expense_id: expenseId, p_actor_user_id: actor.userId, p_storage_path: path,
        p_file_name: file.name.slice(0, 255), p_mime_type: file.type, p_file_size: file.size,
      });
      if (recordError) {
        await admin.storage.from(BUCKET).remove([path]);
        return { ok: false, error: `File ${file.name} terunggah tetapi pencatatan dokumen gagal. Silakan coba lagi.` };
      }
    }
    return { ok: true };
  } catch { return { ok: false, error: "Akses atau unggah dokumen gagal. Silakan muat ulang halaman." }; }
}

export async function openExpenseDocument(documentId: string): Promise<Result> {
  try {
    await requireAnyRole(ROLES);
    if (!uuid(documentId)) return { ok: false, error: "Dokumen tidak valid." };
    const admin = createAdminClient();
    const { data, error } = await admin.from("expense_documents").select("storage_path").eq("id", documentId).maybeSingle();
    if (error || !data) return { ok: false, error: "Dokumen tidak ditemukan." };
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(data.storage_path, 60);
    if (signedError || !signed?.signedUrl) return { ok: false, error: "Dokumen gagal dibuka." };
    return { ok: true, url: signed.signedUrl };
  } catch { return { ok: false, error: "Akses dokumen ditolak." }; }
}

export async function deleteExpenseDocument(documentId: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(ROLES);
    if (!uuid(documentId)) return { ok: false, error: "Dokumen tidak valid." };
    const admin = createAdminClient();
    const { data: doc, error: lookupError } = await admin.from("expense_documents").select("storage_path").eq("id", documentId).maybeSingle();
    if (lookupError) return { ok: false, error: "Data dokumen gagal diperiksa. Silakan coba lagi." };

    // If the database record was already removed by an earlier partial attempt,
    // use its immutable audit snapshot to clean up the matching orphaned object.
    if (!doc) {
      const { data: priorDelete, error: auditError } = await admin.from("audit_logs")
        .select("before_data").eq("action", "expense_document.deleted").eq("entity_id", documentId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const snapshot = priorDelete?.before_data as { file_name?: string; expense_code?: string } | null;
      if (auditError || !snapshot?.file_name || !snapshot?.expense_code) {
        return { ok: false, error: "Catatan dokumen tidak ditemukan. Muat ulang halaman Expenses." };
      }
      const { data: expense } = await admin.from("expenses").select("id").eq("code", snapshot.expense_code).maybeSingle();
      if (!expense) return { ok: false, error: "Transaksi asal dokumen tidak ditemukan. Hubungi administrator." };
      const { data: objects, error: listError } = await admin.storage.from(BUCKET).list(expense.id, { search: snapshot.file_name });
      if (listError) return { ok: false, error: "File billing tertinggal gagal diperiksa di penyimpanan." };
      const orphan = (objects ?? []).find((item) => item.name.endsWith("_" + snapshot.file_name));
      if (orphan) {
        const { error: cleanupError } = await admin.storage.from(BUCKET).remove([`${expense.id}/${orphan.name}`]);
        if (cleanupError) return { ok: false, error: "File billing tertinggal gagal dihapus dari penyimpanan." };
      }
      revalidatePath("/dashboard/pengeluaran");
      return { ok: true };
    }

    // Remove the database record and write its audit event first.
    const { error } = await admin.rpc("delete_expense_document_with_audit", { p_document_id: documentId, p_actor_user_id: actor.userId });
    if (error) {
      console.error("deleteExpenseDocument RPC failed:", error);
      return { ok: false, error: "Catatan dokumen gagal dihapus. File belum dihapus dari penyimpanan." };
    }
    const { error: storageError } = await admin.storage.from(BUCKET).remove([doc.storage_path]);
    if (storageError) {
      console.error("deleteExpenseDocument Storage cleanup failed:", storageError);
      return { ok: false, error: "Catatan dokumen sudah dihapus, tetapi file fisik gagal dibersihkan. Hubungi administrator." };
    }
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true };
  } catch { return { ok: false, error: "Akses atau penghapusan dokumen gagal." }; }
}
