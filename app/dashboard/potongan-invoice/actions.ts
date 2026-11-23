"use server";
import {revalidatePath} from "next/cache";
import {requireOwner} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
type Result={ok:true}|{ok:false;error:string};
const uuid=(v:string)=>/^[0-9a-f-]{36}$/i.test(v);
export async function saveInvoiceDeduction(input:{id?:string;customerId:string;code:string;name:string;method:string;value:string;sortOrder:string;notes:string;active:boolean}):Promise<Result>{
 try{
  const actor=await requireOwner();const db=createAdminClient();
  const value=Number(input.value),sort=Number(input.sortOrder||100);
  if(input.id&&!uuid(input.id))return{ok:false,error:"Komponen tidak valid."};
  if(input.customerId&&!uuid(input.customerId))return{ok:false,error:"Pembeli tidak valid."};
  if(!/^[A-Z0-9_-]{2,24}$/.test(input.code.trim().toUpperCase())||input.name.trim().length<2||input.name.trim().length>100)return{ok:false,error:"Kode atau nama komponen tidak valid."};
  if(!["percent","fixed"].includes(input.method)||!Number.isFinite(value)||value<0||value>1000000000000||!Number.isInteger(sort))return{ok:false,error:"Metode atau nilai default tidak valid."};
  const payload={customer_id:input.customerId||null,code:input.code.trim().toUpperCase(),name:input.name.trim(),calculation_method:input.method,default_value:value,is_active:input.active,sort_order:sort,notes:input.notes.trim()||null,updated_at:new Date().toISOString(),updated_by:actor.userId};
  let before:any=null;
  if(input.id){const {data}=await db.from("sales_invoice_deduction_components").select("*").eq("id",input.id).maybeSingle();before=data;
   const {error}=await db.from("sales_invoice_deduction_components").update(payload).eq("id",input.id);if(error)return{ok:false,error:error.code==="23505"?"Kode sudah dipakai untuk pembeli tersebut.":"Master potongan gagal diperbarui."};
  }else{const {error}=await db.from("sales_invoice_deduction_components").insert({...payload,created_by:actor.userId});if(error)return{ok:false,error:error.code==="23505"?"Kode sudah dipakai untuk pembeli tersebut.":"Master potongan gagal disimpan."};}
  await db.from("audit_logs").insert({actor_user_id:actor.userId,action:input.id?"sales.invoice_deduction_updated":"sales.invoice_deduction_created",entity_type:"sales_invoice_deduction_component",entity_id:input.id??null,before_data:before,after_data:payload});
  revalidatePath("/dashboard/potongan-invoice");revalidatePath("/dashboard/penerimaan-penjualan");return{ok:true};
 }catch(e){return{ok:false,error:e instanceof Error?e.message:"Akses Owner diperlukan."};}
}