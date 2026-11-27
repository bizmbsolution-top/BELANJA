"use server";
import {revalidatePath} from "next/cache";
import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
type Result={ok:true}|{ok:false;error:string};
const uuid=(v:string)=>/^[0-9a-f-]{36}$/i.test(v);
const BUCKET="sales-settlement-evidence";
export async function recordSalesSettlement(input:{salesOrderId:string;paymentMethod:string;receivedAt:string;paymentReference:string;notes:string;deductions:{componentId:string;amount:string}[]},file:File):Promise<Result>{
 let uploaded:string|null=null;let settlementCreated=false;
 try{
  const actor=await requireAnyRole(["Finance"]);
  if(!uuid(input.salesOrderId))return{ok:false,error:"BA penjualan tidak valid."};
  if(!["Transfer","Tunai"].includes(input.paymentMethod))return{ok:false,error:"Metode penerimaan tidak valid."};
  if(!input.receivedAt||Number.isNaN(Date.parse(input.receivedAt)))return{ok:false,error:"Tanggal penerimaan wajib diisi."};
  if(input.paymentReference.length>120||input.notes.length>500)return{ok:false,error:"Referensi atau catatan terlalu panjang."};
  if(!Array.isArray(input.deductions)||input.deductions.length>30)return{ok:false,error:"Perincian potongan tidak valid."};
  if(!(file instanceof File)||file.size<=0||file.size>10*1024*1024||!["application/pdf","image/jpeg","image/png"].includes(file.type))return{ok:false,error:"Invoice breakdown wajib PDF/JPG/PNG, maksimal 10 MB."};
  const db=createAdminClient();
  const {data:order,error:oe}=await db.from("sales_orders").select("id,status,customer_id,project_id,final_amount,ba_number,ba_date").eq("tenant_id",actor.tenantId).eq("id",input.salesOrderId).maybeSingle();
  if(oe||!order||order.status!=="Selesai"||!order.ba_number||!order.ba_date)return{ok:false,error:"BA final tidak ditemukan atau belum selesai."};
  if(actor.tenantRole!=="superadmin"){
   const {data:permission,error:permissionError}=await db.from("tenant_user_permission_overrides").select("effect").eq("tenant_id",actor.tenantId).eq("user_id",actor.userId).eq("permission_key","payment.post").maybeSingle();
   if(permissionError||permission?.effect!=="allow")return{ok:false,error:"Permission payment.post belum diberikan oleh Superadmin perusahaan."};
   const {data:project,error:projectError}=await db.from("projects").select("id,is_active").eq("tenant_id",actor.tenantId).eq("id",order.project_id).maybeSingle();
   if(projectError||!project?.is_active)return{ok:false,error:"Project tidak aktif atau tidak ditemukan."};
   const {data:scope,error:scopeError}=await db.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id",actor.tenantId).eq("user_id",actor.userId).eq("dimension","project").maybeSingle();
   if(scopeError||!scope)return{ok:false,error:"Area kerja Project belum diatur oleh Superadmin perusahaan."};
   if(scope.scope_mode!=="all"&&!(scope.scope_mode==="selected"&&scope.resource_ids?.includes(order.project_id)))return{ok:false,error:"Project di luar area kerja akun Anda."};
  }
  const {data:existing}=await db.from("sales_order_settlements").select("id").eq("tenant_id",actor.tenantId).eq("sales_order_id",order.id).maybeSingle();
  if(existing)return{ok:false,error:"BA ini sudah memiliki settlement."};
  const componentIds=input.deductions.map(x=>x.componentId);
  if(new Set(componentIds).size!==componentIds.length||componentIds.some(id=>!uuid(id)))return{ok:false,error:"Komponen potongan ganda atau tidak valid."};
  const normalized=input.deductions.map(x=>({component_id:x.componentId,amount:Number(x.amount)}));
  if(normalized.some(x=>!Number.isFinite(x.amount)||x.amount<0))return{ok:false,error:"Nominal potongan harus nol atau lebih."};
  const path=actor.tenantId+"/"+order.id+"/"+crypto.randomUUID()+"_"+file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-100);
  const {error:up}=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
  if(up)return{ok:false,error:"Invoice breakdown gagal diunggah."};uploaded=path;
  const {data,error}=await db.rpc("record_sales_order_settlement",{p_sales_order_id:order.id,p_actor_user_id:actor.userId,p_payment_method:input.paymentMethod,p_received_at:new Date(input.receivedAt+"+07:00").toISOString(),p_payment_reference:input.paymentReference.trim()||null,p_notes:input.notes.trim()||null,p_deductions:normalized});
  if(error||!data)throw new Error(error?.message??"Settlement gagal disimpan.");settlementCreated=true;
  const {error:updateError}=await db.from("sales_order_settlements").update({evidence_storage_path:path,evidence_file_name:file.name.slice(0,255)}).eq("tenant_id",actor.tenantId).eq("id",data);
  if(updateError)throw new Error("Settlement tersimpan, tetapi metadata invoice gagal dicatat. Hubungi Owner.");
  revalidatePath("/dashboard/penerimaan-penjualan");revalidatePath("/dashboard/laporan-penjualan");revalidatePath("/dashboard/pengeluaran");
  return{ok:true};
 }catch(e){if(uploaded&&!settlementCreated){const db=createAdminClient();await db.storage.from(BUCKET).remove([uploaded]);}return{ok:false,error:e instanceof Error?e.message:"Pencatatan settlement gagal."};}
}
