"use server";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
const ROLES=["Cashier","Finance","Management"] as const;
type Classification="direct_cost"|"general_overhead"|"flexible";
type Input={name:string;description:string;isActive?:boolean;costClassification:Classification};
type Result={ok:true}|{ok:false;error:string};
function clean(input:Input){
 const name=typeof input?.name==="string"?input.name.trim():"";
 const description=typeof input?.description==="string"?input.description.trim():"";
 const allowed=["direct_cost","general_overhead","flexible"];
 if(!name)return "Nama kategori wajib diisi.";
 if(name.length>120)return "Nama kategori maksimal 120 karakter.";
 if(description.length>500)return "Keterangan maksimal 500 karakter.";
 if(!allowed.includes(input?.costClassification))return "Klasifikasi biaya tidak valid.";
 return {name,description:description||null,costClassification:input.costClassification};
}
export async function createExpenseCategory(input:Input):Promise<Result>{
 try{
  const actor=await requireAnyRole(ROLES);const v=clean(input);if(typeof v==="string")return{ok:false,error:v};
  if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
  const {error}=await createAdminClient().rpc("create_expense_category_with_audit",{
   p_actor_user_id:actor.userId,p_tenant_id:actor.tenantId,p_name:v.name,p_description:v.description,p_cost_classification:v.costClassification
  });
  if(error?.code==="23505")return{ok:false,error:"Nama kategori tersebut sudah digunakan."};
  if(error)return{ok:false,error:"Kategori gagal disimpan. Silakan coba lagi."};
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
  const {data:existing,error:lookupError}=await createAdminClient().from("expense_categories").select("id").eq("tenant_id",actor.tenantId).eq("id",id).maybeSingle();
  if(lookupError||!existing)return{ok:false,error:"Kategori tidak ditemukan pada perusahaan aktif."};
  const {error}=await createAdminClient().rpc("update_expense_category_with_audit",{
   p_category_id:id,p_actor_user_id:actor.userId,p_name:v.name,p_description:v.description,
   p_is_active:input.isActive,p_cost_classification:v.costClassification
  });
  if(error?.code==="23505")return{ok:false,error:"Nama kategori tersebut sudah digunakan."};
  if(error)return{ok:false,error:"Perubahan kategori gagal disimpan. Silakan coba lagi."};
  return{ok:true};
 }catch{return{ok:false,error:"Akses atau perubahan kategori gagal. Silakan muat ulang halaman."};}
}