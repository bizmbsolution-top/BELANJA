"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "cashier-fund-evidence";
const MAX_FILE = 10 * 1024 * 1024;
type Result = { ok: true; id?: string; url?: string } | { ok: false; error: string };
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

async function assertProjectAccess(userId: string, projectId: string, isOwner: boolean, tenantId: string | null) {
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id,is_active").eq("tenant_id", tenantId).eq("id", projectId).maybeSingle();
  if (!project || project.is_active !== true) throw new Error("Project tidak aktif atau tidak ditemukan.");
  if (isOwner) return;
  const { data: scope, error } = await admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", tenantId).eq("user_id", userId).eq("dimension", "project").maybeSingle();
  if (error || !scope) throw new Error("Area kerja Project belum diatur oleh Superadmin perusahaan.");
  if (scope.scope_mode === "all") return;
  if (scope.scope_mode !== "selected" || !Array.isArray(scope.resource_ids) || !scope.resource_ids.includes(projectId)) {
    throw new Error("Project di luar area kerja akun Anda.");
  }
}

export async function createFundRequest(input: { projectId: string; amount: string; purpose: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Cashier"]);
    const projectId = typeof input?.projectId === "string" ? input.projectId : "";
    const amount = Number(input?.amount);
    const purpose = typeof input?.purpose === "string" ? input.purpose.trim() : "";
    if (!isUuid(projectId)) return { ok: false, error: "Project wajib dipilih." };
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 9999999999999999) return { ok: false, error: "Nominal permintaan tidak valid." };
    if (!purpose || purpose.length > 1000) return { ok: false, error: "Tujuan penggunaan dana wajib diisi (maksimal 1.000 karakter)." };
    await assertProjectAccess(actor.userId, projectId, actor.tenantRole === "superadmin", actor.tenantId);
    const { data, error } = await createAdminClient().rpc("create_fund_request_with_audit", {
      p_actor_user_id: actor.userId, p_project_id: projectId, p_request_amount: amount, p_purpose: purpose,
    });
    if (error || !data) return { ok: false, error: "Permintaan dana gagal disimpan. Periksa Project dan nominal." };
    revalidatePath("/dashboard/permintaan-penggunaan-dana");
    return { ok: true, id: data as string };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Akses atau penyimpanan permintaan dana gagal." };
  }
}

export async function uploadFundRequestDocuments(requestId: string, formData: FormData): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Finance"]);
    if (!isUuid(requestId)) return { ok: false, error: "Permintaan dana tidak valid." };
    const admin = createAdminClient();
    const { data: request } = await admin.from("fund_requests").select("id,project_id,status").eq("tenant_id",actor.tenantId).eq("id", requestId).maybeSingle();
    if (!request || request.status !== "Menunggu Eksekusi") return { ok: false, error: "Bukti hanya dapat ditambahkan sebelum eksekusi selesai." };
    await assertProjectAccess(actor.userId, request.project_id, actor.tenantRole === "superadmin" || actor.roles.includes("Finance"), actor.tenantId);
    const files = formData.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    if (!files.length) return { ok: false, error: "Pilih minimal satu file." };
    if (files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 20 * 1024 * 1024) return { ok: false, error: "Maksimal 10 file dan total 20 MB per unggahan." };
    for (const file of files) {
      if (file.size > MAX_FILE) return { ok: false, error: `File ${file.name} melebihi 10 MB.` };
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return { ok: false, error: `Format ${file.name} tidak didukung. Gunakan PDF, JPG, atau PNG.` };
    }
    for (const file of files) {
      const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "evidence";
      const path = `${actor.tenantId}/${requestId}/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) return { ok: false, error: `File ${file.name} gagal diunggah.` };
      const { error: recordError } = await admin.rpc("register_fund_request_document_with_audit", {
        p_fund_request_id: requestId, p_actor_user_id: actor.userId, p_storage_path: path,
        p_file_name: file.name.slice(0, 255), p_mime_type: file.type, p_file_size: file.size,
      });
      if (recordError) {
        await admin.storage.from(BUCKET).remove([path]);
        return { ok: false, error: `File ${file.name} terunggah tetapi pencatatan gagal.` };
      }
    }
    revalidatePath("/dashboard/permintaan-penggunaan-dana");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Akses atau unggah bukti gagal." };
  }
}

export async function openFundRequestDocument(documentId: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Cashier", "Finance", "Management"]);
    if (!isUuid(documentId)) return { ok: false, error: "Dokumen tidak valid." };
    const admin = createAdminClient();
    const { data: doc } = await admin.from("fund_request_documents").select("storage_path,fund_request_id").eq("tenant_id",actor.tenantId).eq("id", documentId).maybeSingle();
    if (!doc) return { ok: false, error: "Dokumen tidak ditemukan." };
    const { data: request } = await admin.from("fund_requests").select("project_id").eq("tenant_id",actor.tenantId).eq("id", doc.fund_request_id).maybeSingle();
    if (!request) return { ok: false, error: "Permintaan dana tidak ditemukan." };
    await assertProjectAccess(actor.userId, request.project_id, actor.tenantRole === "superadmin" || actor.roles.includes("Finance") || actor.roles.includes("Management"), actor.tenantId);
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
    if (error || !data?.signedUrl) return { ok: false, error: "Bukti gagal dibuka." };
    return { ok: true, url: data.signedUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Akses dokumen ditolak." };
  }
}

export async function executeFundRequest(input: { requestId: string; amount: string; paymentMethod: string; note: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Finance"]);
    const requestId = typeof input?.requestId === "string" ? input.requestId : "";
    const amount = Number(input?.amount);
    const method = input?.paymentMethod;
    const note = typeof input?.note === "string" ? input.note.trim() : "";
    if (!isUuid(requestId)) return { ok: false, error: "Permintaan dana tidak valid." };
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "Nominal aktual tidak valid." };
    if (!["Tunai", "Transfer"].includes(method)) return { ok: false, error: "Metode penyerahan dana tidak valid." };
    if (note.length > 500) return { ok: false, error: "Catatan maksimal 500 karakter." };
    const admin = createAdminClient();
    const { data: request } = await admin.from("fund_requests").select("project_id,request_amount,status").eq("tenant_id",actor.tenantId).eq("id", requestId).maybeSingle();
    if (!request || request.status !== "Menunggu Eksekusi") return { ok: false, error: "Permintaan tidak ditemukan atau sudah dieksekusi." };
    await assertProjectAccess(actor.userId, request.project_id, actor.tenantRole === "superadmin" || actor.roles.includes("Finance"));
    if (amount < Number(request.request_amount)) return { ok: false, error: "Nominal aktual tidak boleh kurang dari nominal yang diminta." };
    const { error } = await admin.rpc("execute_fund_request_with_audit", {
      p_fund_request_id: requestId, p_actor_user_id: actor.userId, p_executed_amount: amount,
      p_payment_method: method, p_execution_note: note || null,
    });
    if (error) return { ok: false, error: error.message.includes("less than") ? "Nominal aktual tidak boleh kurang dari nominal yang diminta." : "Eksekusi dana gagal. Permintaan mungkin sudah diproses." };
    revalidatePath("/dashboard/permintaan-penggunaan-dana");
    revalidatePath("/dashboard/kas-pembayaran");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Akses atau eksekusi dana gagal." };
  }
}
