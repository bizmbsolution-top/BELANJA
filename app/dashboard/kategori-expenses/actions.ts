"use server";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
const ROLES=["Cashier","Finance","Management"] as const;
type Classification="direct_cost"|"general_overhead"|"flexible";
type Method="manual"|"percentage"|"per_kg"|"per_grade_point"|"per_kg_grade"|"per_transaction"|"fixed";
type Basis="manual"|"final_amount"|"purchase_cost"|"received_weight_kg"|"final_grade_value"|"received_weight_x_grade"|"per_transaction"|"fixed";
type Input={name:string;description:string;isActive?:boolean;costClassification:Classification;expenseType:"company_payable"|"transaction_deduction";calculationMethod:Method;calculationRate:string};
type Result={ok:true}|{ok:false;error:string};
function clean(input:Input){
 const name=typeof input?.name==="string"?input.name.trim():"";
 const description=typeof input?.description==="string"?input.description.trim():"";
 if(!name)return "Nama kategori wajib diisi.";
 if(name.length>120)return "Nama kategori maksimal 120 karakter.";
 if(description.length>500)return "Keterangan maksimal 500 karakter.";
 if(!["direct_cost","general_overhead","flexible"].includes(input?.costClassification))return "Klasifikasi biaya tidak valid.";
 if(!["company_payable","transaction_deduction"].includes(input?.expenseType))return "Jenis biaya tidak valid.";
 const methods:Record<Method,Basis>={manual:"manual",percentage:"final_amount",per_kg:"received_weight_kg",per_grade_point:"final_grade_value",per_kg_grade:"received_weight_x_grade",per_transaction:"per_transaction",fixed:"fixed"};
 if(!(input.calculationMethod in methods))return "Metode perhitungan tidak valid.";
 const rate=input.calculationMethod==="manual"?null:Number(input.calculationRate);
 if(rate!==null&&(!Number.isFinite(rate)||rate<=0||rate>1000000000000))return "Tarif harus lebih besar dari nol.";
 return {name,description:description||null,costClassification:input.costClassification,expenseType:input.expenseType,calculationMethod:input.calculationMethod,calculationBasis:methods[input.calculationMethod],calculationRate:rate};
}
export async function createExpenseCategory(input:Input):Promise<Result>{
 try{
  const actor=await requireAnyRole(ROLES);const v=clean(input);if(typeof v==="string")return{ok:false,error:v};
  if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
  const admin=createAdminClient();
  const {data,error}=await admin.from("expense_categories").insert({
   tenant_id:actor.tenantId,name:v.name,description:v.description,cost_classification:v.costClassification,
   expense_type:v.expenseType,calculation_method:v.calculationMethod,calculation_basis:v.calculationBasis,
   calculation_rate:v.calculationRate,created_by:actor.userId,updated_by:actor.userId
  }).select("id,code,name").single();
  if(error?.code==="23505")return{ok:false,error:"Nama kategori tersebut sudah digunakan."};
  if(error)return{ok:false,error:"Kategori gagal disimpan. Pastikan migrasi formula sudah diterapkan pada database preview."};
  await admin.from("audit_logs").insert({tenant_id:actor.tenantId,actor_user_id:actor.userId,action:"expense_category.created",entity_type:"expense_category",entity_id:data.id,after_data:{code:data.code,name:data.name,expense_type:v.expenseType,calculation_method:v.calculationMethod,calculation_basis:v.calculationBasis,calculation_rate:v.calculationRate}});
  return{ok:true};
 }catch{return{ok:false,error:"Akses atau penyimpanan kategori gagal. Silakan muat ulang halaman."};}
}
export async function updateExpenseCategory(id:string,input:Input):Promise<Result>{
 try{
  const actor=await requireAnyRole(ROLES);
  if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))return{ok:false,error:"Data kategori tidak valid."};
  if(typeof input?.isActive!=="boolean")return{ok:false,error:"Status kategori tidak valid."};
  const v=clean(input);if(typeof v==="string")return{ok:false,error:v};
  if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
  const admin=createAdminClient();
  const {data:before,error:lookupError}=await admin.from("expense_categories").select("*").eq("tenant_id",actor.tenantId).eq("id",id).maybeSingle();
  if(lookupError||!before)return{ok:false,error:"Kategori tidak ditemukan pada perusahaan aktif."};
  const {error}=await admin.from("expense_categories").update({
   name:v.name,description:v.description,is_active:input.isActive,cost_classification:v.costClassification,
   expense_type:v.expenseType,calculation_method:v.calculationMethod,calculation_basis:v.calculationBasis,
   calculation_rate:v.calculationRate,updated_at:new Date().toISOString(),updated_by:actor.userId
  }).eq("tenant_id",actor.tenantId).eq("id",id);
  if(error?.code==="23505")return{ok:false,error:"Nama kategori tersebut sudah digunakan."};
  if(error)return{ok:false,error:"Perubahan kategori gagal disimpan. Pastikan migrasi formula sudah diterapkan pada database preview."};
  await admin.from("audit_logs").insert({tenant_id:actor.tenantId,actor_user_id:actor.userId,action:"expense_category.updated",entity_type:"expense_category",entity_id:id,before_data:before,after_data:{...v,is_active:input.isActive}});
  return{ok:true};
 }catch{return{ok:false,error:"Akses atau perubahan kategori gagal. Silakan muat ulang halaman."};}
}
