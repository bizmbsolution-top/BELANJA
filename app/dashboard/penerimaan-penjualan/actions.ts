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
  const {data:order,error:oe}=await db.from("sales_orders").select("id,status,customer_id,project_id,final_amount,ba_number,ba_date").eq("id",input.salesOrderId).maybeSingle();
  if(oe||!order||order.status!=="Selesai"||!order.ba_number||!order.ba_date)return{ok:false,error:"BA final tidak ditemukan atau belum selesai."};
  const {data:existing}=await db.from("sales_order_settlements").select("id").eq("sales_order_id",order.id).maybeSingle();
  if(existing)return{ok:false,error:"BA ini sudah memiliki settlement."};
  const componentIds=input.deductions.map(x=>x.componentId);
  if(new Set(componentIds).size!==componentIds.length||componentIds.some(id=>!uuid(id)))return{ok:false,error:"Komponen potongan ganda atau tidak valid."};
  const normalized=input.deductions.map(x=>({component_id:x.componentId,amount:Number(x.amount)}));
  if(normalized.some(x=>!Number.isFinite(x.amount)||x.amount<0))return{ok:false,error:"Nominal potongan harus nol atau lebih."};
  const path=order.id+"/"+crypto.randomUUID()+"_"+file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-100);
  const {error:up}=await db.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
  if(up)return{ok:false,error:"Invoice breakdown gagal diunggah."};uploaded=path;
  const {data,error}=await db.rpc("record_sales_order_settlement",{
   p_sales_order_id:order.id,p_actor_user_id:actor.userId,p_payment_method:input.paymentMethod,
   p_received_at:new Date(input.receivedAt+"+07:00").toISOString(),p_payment_reference:input.paymentReference.trim()||null,
   p_notes:input.notes.trim()||null,p_deductions:normalized
  });
  if(error||!data)throw new Error(error?.message??"Settlement gagal disimpan.");settlementCreated=true;
  const {error:updateError}=await db.from("sales_order_settlements").update({evidence_storage_path:path,evidence_file_name:file.name.slice(0,255)}).eq("id",data);
  if(updateError)throw new Error("Settlement tersimpan, tetapi metadata invoice gagal dicatat. Hubungi Owner.");
  revalidatePath("/dashboard/penerimaan-penjualan");revalidatePath("/dashboard/laporan-penjualan");
  return{ok:true};
 }catch(e){
  if(uploaded&&!settlementCreated){const db=createAdminClient();await db.storage.from(BUCKET).remove([uploaded]);}
  return{ok:false,error:e instanceof Error?e.message:"Pencatatan settlement gagal."};
 }
}