"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const RECEIPT_BUCKET = "purchase-receipt-evidence";
const PAYMENT_BUCKET = "purchase-payment-evidence";
const MAX_FILE = 10 * 1024 * 1024;
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
type Result = { ok: true; id?: string } | { ok: false; error: string };

async function hasPermission(userId: string, key: string, isOwner: boolean, tenantId: string | null) {
  if (isOwner) return true;
  const { data, error } = await createAdminClient().from("tenant_user_permission_overrides").select("effect").eq("tenant_id", tenantId)
    .eq("user_id", userId).eq("permission_key", key).maybeSingle();
  return !error && data?.effect === "allow";
}
async function assertProjectAccess(userId: string, projectId: string, isOwner: boolean, roles: string[], tenantId: string | null) {
  if (isOwner || roles.includes("Finance") || roles.includes("Management")) return;
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id,is_active").eq("tenant_id", tenantId).eq("id", projectId).maybeSingle();
  if (!project?.is_active) throw new Error("Project tidak aktif atau tidak ditemukan.");
  const { data: scope, error } = await admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", tenantId)
    .eq("user_id", userId).eq("dimension", "project").maybeSingle();
  if (error || !scope) throw new Error("Area kerja Project belum diatur oleh Superadmin perusahaan.");
  if (scope.scope_mode === "all") return;
  if (scope.scope_mode !== "selected" || !scope.resource_ids?.includes(projectId)) throw new Error("Project di luar area kerja akun Anda.");
}
async function assertWarehouseAccess(userId: string, projectId: string, warehouseId: string, isOwner: boolean, roles: string[], tenantId: string | null) {
  const admin = createAdminClient();
  const { data: mapping } = await admin.from("warehouse_projects").select("warehouse_id").eq("tenant_id", tenantId).eq("warehouse_id", warehouseId).eq("project_id", projectId).maybeSingle();
  if (!mapping) throw new Error("Warehouse tidak terhubung dengan Project yang dipilih.");
  if (isOwner || roles.includes("Finance") || roles.includes("Management")) return;
  const { data: scope, error } = await admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", tenantId)
    .eq("user_id", userId).eq("dimension", "warehouse").maybeSingle();
  if (error || !scope) throw new Error("Area kerja Warehouse belum diatur oleh Superadmin perusahaan.");
  if (scope.scope_mode === "all") return;
  if (scope.scope_mode !== "selected" || !scope.resource_ids?.includes(warehouseId)) throw new Error("Warehouse di luar area kerja akun Anda.");
}
async function getRequest(id: string, tenantId: string | null) {
  return createAdminClient().from("purchase_requests").select("id,project_id,warehouse_id,status,price_per_kg,code").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
}
async function getPaymentContext(id: string, tenantId: string | null) {
  const admin = createAdminClient();
  const { data: payment } = await admin.from("purchase_payment_requests").select("id,receipt_id,status,amount").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!payment) return null;
  const { data: receipt } = await admin.from("purchase_receipts").select("purchase_request_id").eq("tenant_id", tenantId).eq("id", payment.receipt_id).maybeSingle();
  if (!receipt) return null;
  const { data: request } = await admin.from("purchase_requests").select("id,project_id,warehouse_id,status").eq("tenant_id", tenantId).eq("id", receipt.purchase_request_id).maybeSingle();
  return request ? { payment, request } : null;
}

export async function createPurchaseRequest(input: {
  requestDate: string; projectId: string; supplierId: string; warehouseId: string; categoryId: string;
  estimatedWeightKg: string; estimatedValue: string; pricePerKg: string; notes: string;
}): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement"]);
    if (actor.activeRole !== "Procurement" && actor.tenantRole !== "superadmin") return { ok: false, error: "Pilih Mode Kerja Pembelian untuk melakukan tindakan ini." };
    if (!(await hasPermission(actor.userId, "transaction.post_recognition", actor.tenantRole === "superadmin", actor.tenantId))) return { ok: false, error: "Permission transaksi belum diberikan oleh Superadmin perusahaan." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.requestDate ?? "") || !uuid(input?.projectId ?? "") ||
      !uuid(input?.supplierId ?? "") || !uuid(input?.warehouseId ?? "") || !uuid(input?.categoryId ?? "")) return { ok: false, error: "Lengkapi tanggal, Project, Supplier, Warehouse, dan Kategori." };
    const weight = Number(input.estimatedWeightKg), estimatedValue = Number(input.estimatedValue), price = Number(input.pricePerKg), notes = (input.notes ?? "").trim();
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(estimatedValue) || estimatedValue < 0 || estimatedValue > 100 || !Number.isFinite(price) || price <= 0 || notes.length > 1000) return { ok: false, error: "Estimasi berat, estimasi kadar (0–100%), harga per kg, atau keterangan tidak valid." };
    await assertProjectAccess(actor.userId, input.projectId, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    await assertWarehouseAccess(actor.userId, input.projectId, input.warehouseId, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    const { data, error } = await createAdminClient().rpc("create_purchase_request_with_audit", {
      p_actor_user_id: actor.userId, p_request_date: input.requestDate, p_project_id: input.projectId,
      p_supplier_id: input.supplierId, p_warehouse_id: input.warehouseId, p_category_id: input.categoryId,
      p_estimated_weight_kg: weight, p_estimated_value: estimatedValue, p_price_per_kg: price, p_notes: notes || null,
    });
    if (error || !data) return { ok: false, error: "Permintaan pembelian gagal disimpan." };
    revalidatePath("/dashboard/pembelian"); return { ok: true, id: data as string };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Akses atau penyimpanan permintaan gagal." }; }
}

export async function recordPurchaseReceipt(formData: FormData): Promise<Result> {
  let receiptId: string | null = null;
  const cleanupContext: { tenantId: string | null } = { tenantId: null };
  const uploadedPaths: string[] = [];
  try {
    const actor = await requireAnyRole(["Procurement"]);
    if (actor.activeRole !== "Procurement" && actor.tenantRole !== "superadmin") return { ok: false, error: "Pilih Mode Kerja Pembelian untuk melakukan tindakan ini." };
    cleanupContext.tenantId = actor.tenantId;
    if (!(await hasPermission(actor.userId, "transaction.post_recognition", actor.tenantRole === "superadmin", actor.tenantId))) return { ok: false, error: "Permission transaksi belum diberikan oleh Superadmin perusahaan." };
    const requestId = String(formData.get("requestId") ?? "");
    if (!uuid(requestId)) return { ok: false, error: "Permintaan pembelian tidak valid." };
    const { data: request } = await getRequest(requestId, actor.tenantId);
    if (!request || request.status !== "Menunggu Barang") return { ok: false, error: "Permintaan tidak tersedia untuk penerimaan." };
    await assertProjectAccess(actor.userId, request.project_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    await assertWarehouseAccess(actor.userId, request.project_id, request.warehouse_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    const receiptDate = String(formData.get("receiptDate") ?? ""), value = Number(formData.get("value"));
    const valueUnit = String(formData.get("valueUnit") ?? "%").trim(), weight = Number(formData.get("weight"));
    const weightUnit = String(formData.get("weightUnit") ?? "kg"), notes = String(formData.get("notes") ?? "").trim();
    const decision = String(formData.get("decision") ?? "Diterima"), reason = String(formData.get("reason") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || !Number.isFinite(value) || value < 0 ||
      !valueUnit || valueUnit.length > 20 || !Number.isFinite(weight) || weight <= 0 ||
      !["kg","ton"].includes(weightUnit) || !["Diterima","Ditolak"].includes(decision) ||
      notes.length > 1000 || (decision === "Ditolak" && reason.length < 3)) return { ok: false, error: "Periksa tanggal, Value, Berat, satuan, keputusan, dan alasan penolakan." };
    const weightFiles = formData.getAll("weightFiles").filter((v): v is File => v instanceof File && v.size > 0);
    const valueFiles = formData.getAll("valueFiles").filter((v): v is File => v instanceof File && v.size > 0);
    const files = [...weightFiles, ...valueFiles];
    if (!weightFiles.length || !valueFiles.length) return { ok: false, error: "Foto timbangan dan foto pengukuran wajib diunggah." };
    if (files.length > 15 || files.reduce((sum,f)=>sum+f.size,0)>20*1024*1024) return { ok: false, error: "Maksimal 15 foto dengan total ukuran 20 MB." };
    for (const file of files) if (file.size>MAX_FILE || !["image/jpeg","image/png","image/webp"].includes(file.type)) return { ok: false, error: "Foto harus JPG, PNG, atau WEBP dan maksimal 10 MB per file." };

    const admin = createAdminClient();
    const { data: newId, error: createError } = await admin.rpc("create_purchase_receipt_draft_with_audit", {
      p_actor_user_id: actor.userId, p_purchase_request_id: requestId, p_receipt_date: receiptDate,
      p_value: value, p_value_unit: valueUnit, p_weight: weight, p_weight_unit: weightUnit, p_notes: notes || null,
    });
    if (createError || !newId) return { ok: false, error: "Draft penerimaan gagal dibuat." };
    receiptId = newId as string;
    for (const [evidenceType, group] of [["weight",weightFiles],["value",valueFiles]] as const) {
      for (const file of group) {
        const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-100) || "evidence";
        const path = actor.tenantId + "/" + receiptId + "/" + crypto.randomUUID() + "_" + safeName;
        const { error: uploadError } = await admin.storage.from(RECEIPT_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
        if (uploadError) throw new Error("Foto " + file.name + " gagal diunggah.");
        uploadedPaths.push(path);
        const { error: recordError } = await admin.rpc("register_purchase_receipt_document_with_audit", {
          p_receipt_id: receiptId, p_actor_user_id: actor.userId, p_evidence_type: evidenceType,
          p_storage_path: path, p_file_name: file.name.slice(0,255), p_mime_type: file.type, p_file_size: file.size,
        });
        if (recordError) throw new Error("Pencatatan foto " + file.name + " gagal.");
      }
    }
    const { error: completeError } = await admin.rpc("complete_purchase_receipt_with_audit", {
      p_receipt_id: receiptId, p_actor_user_id: actor.userId, p_decision: decision, p_reason: reason || null,
    });
    if (completeError) throw new Error("Penerimaan gagal diselesaikan. Pastikan bukti foto lengkap dan permintaan masih terbuka.");
    revalidatePath("/dashboard/pembelian"); return { ok: true, id: receiptId };
  } catch (error) {
    if (receiptId) {
      const admin = createAdminClient();
      if (uploadedPaths.length) await admin.storage.from(RECEIPT_BUCKET).remove(uploadedPaths);
      await admin.from("purchase_receipt_documents").delete().eq("tenant_id", cleanupContext.tenantId).eq("receipt_id",receiptId);
      await admin.from("purchase_receipts").delete().eq("tenant_id", cleanupContext.tenantId).eq("id",receiptId).eq("status","Draft");
    }
    return { ok: false, error: error instanceof Error ? error.message : "Penerimaan gagal disimpan." };
  }
}

export async function uploadPurchasePaymentEvidence(paymentRequestId: string, formData: FormData): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Cashier"]);
    if (actor.activeRole !== "Cashier" && actor.tenantRole !== "superadmin") return { ok:false,error:"Pilih Mode Kerja Kasir untuk mengunggah bukti pembayaran." };
    if (!(await hasPermission(actor.userId,"payment.post",actor.tenantRole === "superadmin",actor.tenantId))) return { ok:false,error:"Permission pembayaran belum diberikan oleh Superadmin perusahaan." };
    if (!uuid(paymentRequestId)) return { ok:false,error:"Pengajuan pembayaran tidak valid." };
    const context = await getPaymentContext(paymentRequestId, actor.tenantId);
    if (!context || context.payment.status!=="Menunggu Pembayaran") return { ok:false,error:"Pengajuan tidak tersedia untuk pembayaran." };
    await assertProjectAccess(actor.userId,context.request.project_id,actor.tenantRole === "superadmin",actor.roles,actor.tenantId);
    const files=formData.getAll("files").filter((v):v is File=>v instanceof File&&v.size>0);
    if(!files.length||files.length>15||files.reduce((sum,f)=>sum+f.size,0)>20*1024*1024) return {ok:false,error:"Pilih 1–15 file dengan total maksimal 20 MB."};
    const admin=createAdminClient();
    for(const file of files){
      if(file.size>MAX_FILE||!["application/pdf","image/jpeg","image/png"].includes(file.type)) return {ok:false,error:"Bukti Transfer harus PDF, JPG, atau PNG dan maksimal 10 MB per file."};
      const safeName=file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-100)||"bukti-transfer";
      const path=actor.tenantId+"/"+paymentRequestId+"/"+crypto.randomUUID()+"_"+safeName;
      const {error:uploadError}=await admin.storage.from(PAYMENT_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError) return {ok:false,error:"Bukti Transfer gagal diunggah."};
      const {error:recordError}=await admin.rpc("register_purchase_payment_document_with_audit",{
        p_payment_request_id:paymentRequestId,p_actor_user_id:actor.userId,p_storage_path:path,
        p_file_name:file.name.slice(0,255),p_mime_type:file.type,p_file_size:file.size
      });
      if(recordError){await admin.storage.from(PAYMENT_BUCKET).remove([path]);return {ok:false,error:"Pencatatan bukti Transfer gagal."};}
    }
    revalidatePath("/dashboard/pembelian"); return {ok:true};
  }catch(error){return {ok:false,error:error instanceof Error?error.message:"Unggah bukti Transfer gagal."};}
}

export async function payPurchasePayment(paymentRequestId: string): Promise<Result> {
  try {
    const actor=await requireAnyRole(["Cashier"]);
    if(actor.activeRole !== "Cashier" && actor.tenantRole !== "superadmin") return {ok:false,error:"Pilih Mode Kerja Kasir untuk mengeksekusi pembayaran."};
    if(!(await hasPermission(actor.userId,"payment.post",actor.tenantRole === "superadmin",actor.tenantId))) return {ok:false,error:"Permission pembayaran belum diberikan oleh Superadmin perusahaan."};
    if(!uuid(paymentRequestId)) return {ok:false,error:"Pengajuan pembayaran tidak valid."};
    const context=await getPaymentContext(paymentRequestId, actor.tenantId);
    if(!context||context.payment.status!=="Menunggu Pembayaran") return {ok:false,error:"Pengajuan sudah diproses atau tidak ditemukan."};
    await assertProjectAccess(actor.userId,context.request.project_id,actor.tenantRole === "superadmin",actor.roles,actor.tenantId);
    const {error}=await createAdminClient().rpc("pay_purchase_payment_with_audit",{p_payment_request_id:paymentRequestId,p_actor_user_id:actor.userId});
    if(error) return {ok:false,error:error.message.toLowerCase().includes("insufficient")?"Saldo Kasir Project tidak mencukupi. Pembayaran diblokir; tidak ada pembayaran parsial.":"Pembayaran gagal. Pastikan bukti Transfer sudah diunggah."};
    revalidatePath("/dashboard/pembelian"); revalidatePath("/dashboard/permintaan-penggunaan-dana"); return {ok:true};
  }catch(error){return {ok:false,error:error instanceof Error?error.message:"Akses pembayaran ditolak."};}
}

export async function setInventoryLotProblemStatus(input: {
  lotId: string;
  isProblematic: boolean;
  reason: string;
}): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement"]);
    if (actor.tenantRole !== "superadmin" && actor.activeRole !== "Procurement") {
      return { ok: false, error: "Pilih Mode Kerja Pembelian untuk mengubah status Lot." };
    }
    if (!(await hasPermission(actor.userId, "transaction.post_recognition", actor.tenantRole === "superadmin", actor.tenantId))) {
      return { ok: false, error: "Permission Pembelian belum diberikan oleh Superadmin perusahaan." };
    }
    if (!uuid(input?.lotId ?? "") || typeof input?.isProblematic !== "boolean" || (input?.reason ?? "").trim().length < 3 || input.reason.trim().length > 1000) {
      return { ok: false, error: "Lot dan alasan perubahan status wajib diisi." };
    }

    const admin = createAdminClient();
    const { data: lot, error: lotError } = await admin.from("inventory_lots")
      .select("id,project_id,warehouse_id,source_receipt_id,is_problematic")
      .eq("tenant_id", actor.tenantId).eq("id", input.lotId).maybeSingle();
    if (lotError || !lot) return { ok: false, error: "Purchase Lot tidak ditemukan." };
    if (lot.is_problematic === input.isProblematic) return { ok: false, error: "Status Lot sudah sesuai." };

    const { data: payment, error: paymentError } = await admin.from("purchase_payment_requests")
      .select("id,status").eq("tenant_id", actor.tenantId).eq("receipt_id", lot.source_receipt_id).maybeSingle();
    if (paymentError || payment?.status !== "Lunas") {
      return { ok: false, error: "Tag Bermasalah hanya dapat digunakan pada Purchase Lot yang sudah lunas." };
    }

    await assertProjectAccess(actor.userId, lot.project_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    await assertWarehouseAccess(actor.userId, lot.project_id, lot.warehouse_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);

    const { error } = await admin.rpc("set_inventory_lot_problem_status_with_audit", {
      p_lot_id: lot.id,
      p_actor_user_id: actor.userId,
      p_is_problematic: input.isProblematic,
      p_reason: input.reason.trim(),
    });
    if (error) return { ok: false, error: error.message || "Status Purchase Lot gagal diperbarui." };

    revalidatePath("/dashboard/pembelian");
    revalidatePath("/dashboard/penjualan");
    return { ok: true, id: lot.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Perubahan status Purchase Lot gagal." };
  }
}


export async function cancelReceivedPurchase(paymentRequestId: string, reason: string): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Procurement"]);
    if (actor.tenantRole !== "superadmin" && actor.activeRole !== "Procurement") {
      return { ok: false, error: "Pilih Mode Kerja Pembelian untuk membatalkan penerimaan." };
    }
    if (!(await hasPermission(actor.userId, "transaction.post_recognition", actor.tenantRole === "superadmin", actor.tenantId))) {
      return { ok: false, error: "Permission Pembelian belum diberikan oleh Superadmin perusahaan." };
    }
    if (!uuid(paymentRequestId) || typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 1000) {
      return { ok: false, error: "Alasan pembatalan wajib diisi minimal 3 karakter." };
    }
    const admin = createAdminClient();
    const { data: payment, error: paymentError } = await admin.from("purchase_payment_requests")
      .select("id,receipt_id,status").eq("tenant_id", actor.tenantId).eq("id", paymentRequestId).maybeSingle();
    if (paymentError || !payment || payment.status !== "Menunggu Pembayaran") {
      return { ok: false, error: "Hanya penerimaan berstatus Diterima dan Menunggu Pembayaran yang dapat dibatalkan." };
    }
    const { data: receipt } = await admin.from("purchase_receipts")
      .select("id,purchase_request_id").eq("tenant_id", actor.tenantId).eq("id", payment.receipt_id).maybeSingle();
    if (!receipt) return { ok: false, error: "Data penerimaan tidak ditemukan." };
    const { data: request } = await admin.from("purchase_requests")
      .select("id,project_id,warehouse_id").eq("tenant_id", actor.tenantId).eq("id", receipt.purchase_request_id).maybeSingle();
    if (!request) return { ok: false, error: "Permintaan pembelian tidak ditemukan." };
    await assertProjectAccess(actor.userId, request.project_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    await assertWarehouseAccess(actor.userId, request.project_id, request.warehouse_id, actor.tenantRole === "superadmin", actor.roles, actor.tenantId);
    const { error } = await admin.rpc("cancel_received_purchase_with_audit", {
      p_payment_request_id: paymentRequestId,
      p_actor_user_id: actor.userId,
      p_reason: reason.trim(),
    });
    if (error) return { ok: false, error: error.message || "Pembatalan penerimaan gagal." };
    revalidatePath("/dashboard/pembelian");
    revalidatePath("/dashboard/penjualan");
    revalidatePath("/dashboard/persediaan");
    return { ok: true, id: receipt.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Pembatalan penerimaan gagal." };
  }
}
