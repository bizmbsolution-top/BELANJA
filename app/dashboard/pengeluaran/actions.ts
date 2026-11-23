"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "expense-billings";
const MAX_SIZE = 10 * 1024 * 1024;
type Result = { ok: true; id?: string; url?: string } | { ok: false; error: string };
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

async function hasPermission(userId: string, key: string, isOwner: boolean) {
  if (isOwner) return true;
  const { data, error } = await createAdminClient().from("user_permission_overrides")
    .select("effect").eq("user_id", userId).eq("permission_key", key).maybeSingle();
  return !error && data?.effect === "allow";
}
async function assertProjectAccess(userId: string, projectId: string, isOwner: boolean, roles: string[]) {
  if (isOwner || roles.includes("Finance") || roles.includes("Management")) return;
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id,is_active").eq("id", projectId).maybeSingle();
  if (!project?.is_active) throw new Error("Project tidak aktif atau tidak ditemukan.");
  const { data: scope, error } = await admin.from("user_work_scopes").select("scope_mode,resource_ids")
    .eq("user_id", userId).eq("dimension", "project").maybeSingle();
  if (error || !scope) throw new Error("Area kerja Project belum diatur oleh Owner.");
  if (scope.scope_mode === "all") return;
  if (scope.scope_mode !== "selected" || !scope.resource_ids?.includes(projectId)) {
    throw new Error("Project di luar area kerja akun Anda.");
  }
}
async function getExpense(expenseId: string) {
  return createAdminClient().from("expenses").select("id,project_id,status,created_by").eq("id", expenseId).maybeSingle();
}
async function canCreate(actor: Awaited<ReturnType<typeof requireAnyRole>>) {
  if (actor.isOwner) return true;
  if (!actor.roles.some(role => role === "Procurement" || role === "Sales")) return false;
  return hasPermission(actor.userId, "transaction.post_recognition", false);
}

export async function createExpenseDraft(input: { expenseDate: string; projectId: string; categoryId: string; description: string; amount: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement", "Sales"]);
    if (!(await canCreate(actor))) return { ok: false, error: "Permission membuat voucher Expenses belum diberikan oleh Owner." };
    const amount = Number(input?.amount);
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.expenseDate ?? "")) return { ok: false, error: "Tanggal tidak valid." };
    if (!uuid(input?.projectId ?? "") || !uuid(input?.categoryId ?? "")) return { ok: false, error: "Project dan kategori wajib dipilih." };
    if (!description || description.length > 1000) return { ok: false, error: "Keterangan wajib diisi (maksimal 1.000 karakter)." };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "Nominal tidak valid." };
    await assertProjectAccess(actor.userId, input.projectId, actor.isOwner, actor.roles);
    const { data, error } = await createAdminClient().rpc("create_expense_draft_with_audit", {
      p_actor_user_id: actor.userId, p_expense_date: input.expenseDate, p_project_id: input.projectId,
      p_expense_category_id: input.categoryId, p_description: description, p_amount: amount,
    });
    if (error || !data) return { ok: false, error: "Draft voucher gagal disimpan." };
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true, id: data as string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses atau penyimpanan voucher gagal." }; }
}

export async function updateExpenseDraft(input: { expenseId: string; expenseDate: string; projectId: string; categoryId: string; description: string; amount: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement", "Sales"]);
    if (!(await canCreate(actor))) return { ok: false, error: "Permission membuat voucher Expenses belum diberikan oleh Owner." };
    if (!uuid(input?.expenseId ?? "") || !uuid(input?.projectId ?? "") || !uuid(input?.categoryId ?? "")) return { ok: false, error: "Data voucher tidak valid." };
    const amount = Number(input.amount), description = input.description.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate) || !description || description.length > 1000 || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "Periksa tanggal, keterangan, dan nominal." };
    const admin = createAdminClient();
    const { data: current } = await getExpense(input.expenseId);
    if (!current || current.status !== "Draft") return { ok: false, error: "Hanya Draft yang dapat diubah." };
    await assertProjectAccess(actor.userId, current.project_id, actor.isOwner, actor.roles);
    await assertProjectAccess(actor.userId, input.projectId, actor.isOwner, actor.roles);
    const { error } = await admin.rpc("update_expense_draft_with_audit", {
      p_expense_id: input.expenseId, p_actor_user_id: actor.userId, p_expense_date: input.expenseDate,
      p_project_id: input.projectId, p_expense_category_id: input.categoryId, p_description: description, p_amount: amount,
    });
    if (error) return { ok: false, error: "Perubahan Draft gagal disimpan." };
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses perubahan Draft gagal." }; }
}

export async function submitExpense(expenseId: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement", "Sales"]);
    if (!(await canCreate(actor))) return { ok: false, error: "Permission submit voucher belum diberikan oleh Owner." };
    if (!uuid(expenseId)) return { ok: false, error: "Voucher tidak valid." };
    const { data: current } = await getExpense(expenseId);
    if (!current || current.status !== "Draft") return { ok: false, error: "Voucher bukan Draft yang dapat dikirim." };
    await assertProjectAccess(actor.userId, current.project_id, actor.isOwner, actor.roles);
    const { error } = await createAdminClient().rpc("submit_expense_with_audit", { p_expense_id: expenseId, p_actor_user_id: actor.userId });
    if (error) return { ok: false, error: "Voucher gagal dikirim ke antrean Kasir." };
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses submit voucher gagal." }; }
}

export async function payExpense(input: { expenseId: string; paymentMethod: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Cashier"]);
    if (!(await hasPermission(actor.userId, "payment.post", actor.isOwner))) return { ok: false, error: "Permission pembayaran voucher belum diberikan oleh Owner." };
    if (!uuid(input?.expenseId ?? "") || !["Tunai", "Transfer"].includes(input?.paymentMethod)) return { ok: false, error: "Data pembayaran tidak valid." };
    const { data: current } = await getExpense(input.expenseId);
    if (!current || current.status !== "Menunggu Pembayaran") return { ok: false, error: "Voucher tidak ditemukan atau sudah diproses." };
    await assertProjectAccess(actor.userId, current.project_id, actor.isOwner, actor.roles);
    const { error } = await createAdminClient().rpc("pay_expense_with_audit", {
      p_expense_id: input.expenseId, p_actor_user_id: actor.userId, p_payment_method: input.paymentMethod,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      return { ok: false, error: msg.includes("insufficient") ? "Saldo Kasir Project tidak mencukupi. Pembayaran diblokir; tidak ada pembayaran parsial." : "Pembayaran gagal. Voucher mungkin sudah diproses." };
    }
    revalidatePath("/dashboard/pengeluaran");
    revalidatePath("/dashboard/permintaan-penggunaan-dana");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses pembayaran ditolak." }; }
}

export async function cancelExpense(expenseId: string, reason: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement", "Sales", "Cashier", "Finance"]);
    if (!uuid(expenseId)) return { ok: false, error: "Voucher tidak valid." };
    const cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason || cleanReason.length > 500) return { ok: false, error: "Alasan pembatalan wajib diisi (maksimal 500 karakter)." };
    const { data: current } = await getExpense(expenseId);
    if (!current || !["Draft", "Menunggu Pembayaran"].includes(current.status)) return { ok: false, error: "Voucher yang sudah dibayar tidak dapat dibatalkan." };
    await assertProjectAccess(actor.userId, current.project_id, actor.isOwner, actor.roles);
    const { error } = await createAdminClient().rpc("cancel_expense_with_audit", { p_expense_id: expenseId, p_actor_user_id: actor.userId, p_reason: cleanReason });
    if (error) return { ok: false, error: "Voucher gagal dibatalkan." };
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses pembatalan gagal." }; }
}

export async function uploadExpenseDocuments(expenseId: string, formData: FormData): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement", "Sales"]);
    if (!(await canCreate(actor))) return { ok: false, error: "Permission membuat voucher Expenses belum diberikan oleh Owner." };
    if (!uuid(expenseId)) return { ok: false, error: "Voucher tidak valid." };
    const admin = createAdminClient();
    const { data: expense } = await getExpense(expenseId);
    if (!expense || expense.status !== "Draft") return { ok: false, error: "Dokumen hanya dapat ditambahkan pada Draft." };
    await assertProjectAccess(actor.userId, expense.project_id, actor.isOwner, actor.roles);
    const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    if (!files.length || files.length > 15 || files.reduce((n,f)=>n+f.size,0)>20*1024*1024) return { ok: false, error: "Pilih 1–15 file dengan total maksimal 20 MB." };
    for (const file of files) {
      if (file.size > MAX_SIZE) return { ok: false, error: `File ${file.name} melebihi 10 MB.` };
      if (!["application/pdf","image/jpeg","image/png"].includes(file.type)) return { ok: false, error: `Format ${file.name} tidak didukung. Gunakan PDF, JPG, atau PNG.` };
    }
    for (const file of files) {
      const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-120) || "billing";
      const path = `${expenseId}/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
      if (uploadError) return { ok: false, error: `File ${file.name} gagal diunggah.` };
      const { error: recordError } = await admin.rpc("register_expense_document_with_audit", {
        p_expense_id:expenseId,p_actor_user_id:actor.userId,p_storage_path:path,p_file_name:file.name.slice(0,255),p_mime_type:file.type,p_file_size:file.size,
      });
      if (recordError) { await admin.storage.from(BUCKET).remove([path]); return { ok:false,error:`Pencatatan dokumen ${file.name} gagal.` }; }
    }
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true };
  } catch (error) { return { ok:false,error:error instanceof Error?error.message:"Akses unggah dokumen gagal." }; }
}

export async function openExpenseDocument(documentId: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement","Sales","Cashier","Finance","Management"]);
    if (!uuid(documentId)) return { ok:false,error:"Dokumen tidak valid." };
    const admin = createAdminClient();
    const { data: doc } = await admin.from("expense_documents").select("storage_path,expense_id").eq("id",documentId).maybeSingle();
    if (!doc) return { ok:false,error:"Dokumen tidak ditemukan." };
    const { data: expense } = await getExpense(doc.expense_id);
    if (!expense) return { ok:false,error:"Voucher tidak ditemukan." };
    await assertProjectAccess(actor.userId,expense.project_id,actor.isOwner,actor.roles);
    const { data,error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path,60);
    if (error || !data?.signedUrl) return { ok:false,error:"Dokumen gagal dibuka." };
    return { ok:true,url:data.signedUrl };
  } catch (error) { return { ok:false,error:error instanceof Error?error.message:"Akses dokumen ditolak." }; }
}

export async function deleteExpenseDocument(documentId: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement","Sales"]);
    if (!(await canCreate(actor))) return { ok:false,error:"Permission membuat voucher Expenses belum diberikan oleh Owner." };
    if (!uuid(documentId)) return { ok:false,error:"Dokumen tidak valid." };
    const admin = createAdminClient();
    const { data: doc,error: lookupError } = await admin.from("expense_documents").select("storage_path,expense_id").eq("id",documentId).maybeSingle();
    if (lookupError || !doc) return { ok:false,error:"Dokumen tidak ditemukan." };
    const { data: expense } = await getExpense(doc.expense_id);
    if (!expense || expense.status!=="Draft") return { ok:false,error:"Dokumen hanya dapat dihapus selama voucher masih Draft." };
    await assertProjectAccess(actor.userId,expense.project_id,actor.isOwner,actor.roles);
    const { error } = await admin.rpc("delete_expense_document_with_audit",{p_document_id:documentId,p_actor_user_id:actor.userId});
    if (error) return { ok:false,error:"Catatan dokumen gagal dihapus. File belum dihapus dari penyimpanan." };
    const { error: storageError } = await admin.storage.from(BUCKET).remove([doc.storage_path]);
    if (storageError) return { ok:false,error:"Catatan dokumen sudah dihapus, tetapi file fisik gagal dibersihkan." };
    revalidatePath("/dashboard/pengeluaran");
    return {ok:true};
  } catch (error) { return {ok:false,error:error instanceof Error?error.message:"Akses penghapusan dokumen gagal."}; }
}
