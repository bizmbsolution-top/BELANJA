"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
type Result={ok:true;id?:string}|{ok:false;error:string};
const uuid=(v:string)=>/^[0-9a-f-]{36}$/i.test(v);
async function canWrite(userId:string,isOwner:boolean){if(isOwner)return true;const {data,error}=await createAdminClient().from("user_permission_overrides").select("effect").eq("user_id",userId).eq("permission_key","transaction.post_recognition").maybeSingle();return !error&&data?.effect==="allow";}
async function assertScope(userId:string,projectId:string,warehouseIds:string[],isOwner:boolean,roles:string[]){
 if(isOwner||roles.includes("Management"))return;
 const admin=createAdminClient();
 const {data:ps,error:pe}=await admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id",userId).eq("dimension","project").maybeSingle();
 if(pe||!ps)throw new Error("Area kerja Project belum diatur oleh Owner.");
 if(ps.scope_mode!=="all"&&(ps.scope_mode!=="selected"||!ps.resource_ids?.includes(projectId)))throw new Error("Project di luar area kerja akun Anda.");
 const {data:ws,error:we}=await admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id",userId).eq("dimension","warehouse").maybeSingle();
 if(we||!ws)throw new Error("Area kerja Warehouse belum diatur oleh Owner.");
 if(ws.scope_mode!=="all"&&(ws.scope_mode!=="selected"||warehouseIds.some(id=>!ws.resource_ids?.includes(id))))throw new Error("Salah satu Warehouse di luar area kerja akun Anda.");
}
export async function createSalesDraft(input:{customerId:string;projectId:string;deliveryAddressId:string;salePricePerKg:string;notes:string;allocations:{lotId:string;weightKg:string}[]}):Promise<Result>{
 try{
  const actor=await requireAnyRole(["Sales"]);
  if(!(await canWrite(actor.userId,actor.isOwner)))return{ok:false,error:"Permission transaksi belum diberikan oleh Owner."};
  if(!uuid(input.customerId)||!uuid(input.projectId)||!uuid(input.deliveryAddressId))return{ok:false,error:"Pilih Pelanggan, Project, dan Alamat Gudang tujuan pengiriman."};
  const price=Number(input.salePricePerKg);if(!Number.isFinite(price)||price<=0)return{ok:false,error:"Harga jual per kg harus lebih besar dari nol."};
  if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>100)return{ok:false,error:"Pilih minimal satu Lot."};
  const allocations=input.allocations.map(a=>({lotId:a.lotId,weightKg:Number(a.weightKg)}));
  if(allocations.some(a=>!uuid(a.lotId)||!Number.isFinite(a.weightKg)||a.weightKg<=0)||new Set(allocations.map(a=>a.lotId)).size!==allocations.length)return{ok:false,error:"Periksa pilihan Lot dan berat yang dialokasikan."};
  const admin=createAdminClient();
  const lotIds=allocations.map(a=>a.lotId);
  const {data:lots,error}=await admin.from("inventory_lots").select("id,project_id,warehouse_id").in("id",lotIds);
  if(error||!lots||lots.length!==lotIds.length)return{ok:false,error:"Data Lot tidak ditemukan."};
  const warehouseIds=[...new Set(lots.map(l=>l.warehouse_id))];
  if(lots.some(l=>l.project_id!==input.projectId))return{ok:false,error:"Semua Lot harus berasal dari Project yang sama."};
  await assertScope(actor.userId,input.projectId,warehouseIds,actor.isOwner,actor.roles);
  const {data:deliveryAddress,error:addressError}=await admin.from("customer_warehouse_addresses").select("id,customer_id,label,address").eq("id",input.deliveryAddressId).eq("customer_id",input.customerId).eq("is_active",true).maybeSingle();
  if(addressError||!deliveryAddress)return{ok:false,error:"Alamat Gudang tidak ditemukan pada Master Pelanggan yang dipilih."};
  const destinationSnapshot=`${deliveryAddress.label} — ${deliveryAddress.address}`;
  const {data,error:rpcError}=await admin.rpc("create_sales_draft_with_audit",{
   p_actor_user_id:actor.userId,p_customer_id:input.customerId,p_project_id:input.projectId,
   p_destination:destinationSnapshot,p_sale_price_per_kg:price,p_notes:input.notes?.trim()||null,
   p_allocations:allocations.map(a=>({lot_id:a.lotId,weight_kg:a.weightKg}))
  });
  if(rpcError||!data)return{ok:false,error:rpcError?.message?.includes("available Lot stock")?"Berat melebihi stok Lot yang tersedia. Muat ulang data Persediaan.":rpcError?.message??"Draft Penjualan gagal disimpan."};
  revalidatePath("/dashboard/penjualan");revalidatePath("/dashboard/persediaan");return{ok:true,id:data as string};
 }catch(error){return{ok:false,error:error instanceof Error?error.message:"Draft Penjualan gagal disimpan."};}
}

export async function confirmSalesDispatch(salesOrderId:string):Promise<Result>{
 try{
  const actor=await requireAnyRole(["Sales","Warehouse"]);
  if(!uuid(salesOrderId))return{ok:false,error:"Transaksi penjualan tidak valid."};
  if(!(await canWrite(actor.userId,actor.isOwner)))return{ok:false,error:"Permission transaksi belum diberikan oleh Owner."};
  const admin=createAdminClient();
  const {data:order,error:orderError}=await admin.from("sales_orders").select("id,project_id,status").eq("id",salesOrderId).maybeSingle();
  if(orderError||!order)return{ok:false,error:"Transaksi penjualan tidak ditemukan."};
  if(order.status!=="Draft")return{ok:false,error:"Hanya Draft yang dapat dikonfirmasi keluar."};
  const {data:allocations,error:allocationError}=await admin.from("sales_order_lot_allocations").select("source_warehouse_id").eq("sales_order_id",salesOrderId);
  if(allocationError||!allocations?.length)return{ok:false,error:"Daftar Lot penjualan tidak ditemukan."};
  const warehouseIds=[...new Set(allocations.map(a=>a.source_warehouse_id))];
  await assertScope(actor.userId,order.project_id,warehouseIds,actor.isOwner,actor.roles);
  const {data,error}=await admin.rpc("confirm_sales_dispatch_with_audit",{p_sales_order_id:salesOrderId,p_actor_user_id:actor.userId});
  if(error||!data)return{ok:false,error:error?.message?.includes("available Lot stock")?"Stok Lot tidak lagi mencukupi. Muat ulang data Persediaan.":error?.message??"Konfirmasi barang keluar gagal."};
  revalidatePath("/dashboard/penjualan");revalidatePath("/dashboard/persediaan");
  return{ok:true,id:data as string};
 }catch(error){return{ok:false,error:error instanceof Error?error.message:"Konfirmasi barang keluar gagal."};}
}

const BA_BUCKET="sales-buyer-ba-evidence";
const MAX_BA_FILE=10*1024*1024;
export async function finalizeSalesOrder(input:{salesOrderId:string;receivedWeightKg:string;finalGradeValue:string;finalGradeUnit:string;finalPricePerKg:string;baNumber:string;baDate:string;discrepancyNotes:string},file:File):Promise<Result>{
 let uploadedPath:string|null=null;
 try{
  const actor=await requireAnyRole(["Sales"]);
  if(!uuid(input.salesOrderId))return{ok:false,error:"Transaksi penjualan tidak valid."};
  if(!(await canWrite(actor.userId,actor.isOwner)))return{ok:false,error:"Permission transaksi belum diberikan oleh Owner."};
  const weight=Number(input.receivedWeightKg),grade=Number(input.finalGradeValue),price=Number(input.finalPricePerKg);
  if(!Number.isFinite(weight)||weight<=0||!Number.isFinite(grade)||grade<0||!Number.isFinite(price)||price<=0)return{ok:false,error:"Berat, kadar, dan harga final harus valid."};
  if(!input.baNumber.trim()||input.baNumber.trim().length>100||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.baDate)||!input.finalGradeUnit.trim()||input.finalGradeUnit.length>20||input.discrepancyNotes.length>1000)return{ok:false,error:"Lengkapi nomor/tanggal BA dan satuan kadar."};
  if(!(file instanceof File)||file.size<=0||file.size>MAX_BA_FILE||!["application/pdf","image/jpeg","image/png"].includes(file.type))return{ok:false,error:"Lampiran BA wajib PDF, JPG, atau PNG, maksimal 10 MB."};
  const admin=createAdminClient();
  const {data:order,error:oe}=await admin.from("sales_orders").select("id,project_id,status").eq("id",input.salesOrderId).maybeSingle();
  if(oe||!order||order.status!=="Dikirim")return{ok:false,error:"Hanya transaksi Dikirim yang dapat difinalisasi."};
  const {data:allocs,error:ae}=await admin.from("sales_order_lot_allocations").select("source_warehouse_id").eq("sales_order_id",order.id);
  if(ae||!allocs?.length)return{ok:false,error:"Alokasi Lot transaksi tidak ditemukan."};
  await assertScope(actor.userId,order.project_id,[...new Set(allocs.map(a=>a.source_warehouse_id))],actor.isOwner,actor.roles);
  const path=order.id+"/"+crypto.randomUUID()+"_"+file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-100);
  const {error:uploadError}=await admin.storage.from(BA_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
  if(uploadError)return{ok:false,error:"Dokumen BA gagal diunggah."};
  uploadedPath=path;
  const {error:docError}=await admin.from("sales_order_documents").insert({sales_order_id:order.id,document_type:"buyer_ba",storage_path:path,file_name:file.name.slice(0,255),mime_type:file.type,file_size:file.size,created_by:actor.userId});
  if(docError)throw new Error("Pencatatan dokumen BA gagal.");
  const {data,error}=await admin.rpc("finalize_sales_order_with_audit",{
   p_sales_order_id:order.id,p_actor_user_id:actor.userId,p_received_weight_kg:weight,
   p_final_grade_value:grade,p_final_grade_unit:input.finalGradeUnit.trim(),
   p_final_price_per_kg:price,p_ba_number:input.baNumber.trim(),p_ba_date:input.baDate,
   p_discrepancy_notes:input.discrepancyNotes.trim()||null
  });
  if(error||!data)throw new Error(error?.message??"Finalisasi penjualan gagal.");
  revalidatePath("/dashboard/penjualan");revalidatePath("/dashboard/persediaan");
  return{ok:true,id:data as string};
 }catch(error){
  if(uploadedPath){const admin=createAdminClient();await admin.from("sales_order_documents").delete().eq("storage_path",uploadedPath);await admin.storage.from(BA_BUCKET).remove([uploadedPath]);}
  return{ok:false,error:error instanceof Error?error.message:"Finalisasi penjualan gagal."};
 }
}
