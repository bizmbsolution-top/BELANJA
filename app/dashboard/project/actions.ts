"use server";
import { requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
type Input={name:string;location:string;description:string;isActive?:boolean};
type Clean={name:string;location:string|null;description:string|null};
type Result={ok:true}|{ok:false;error:string};
function clean(input:Input):Clean|string {
 const name=typeof input?.name==="string"?input.name.trim():"";
 const location=typeof input?.location==="string"?input.location.trim():"";
 const description=typeof input?.description==="string"?input.description.trim():"";
 if(!name)return "Nama Project wajib diisi.";
 if(name.length>160)return "Nama Project maksimal 160 karakter.";
 if(location.length>200)return "Lokasi maksimal 200 karakter.";
 if(description.length>500)return "Keterangan maksimal 500 karakter.";
 return {name,location:location||null,description:description||null};
}
export async function createProject(input:Input):Promise<Result>{
 try{const actor=await requireOwner();const v=clean(input);if(typeof v==="string")return{ok:false,error:v};
 if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
 const {error}=await createAdminClient().rpc("create_project_with_audit",{p_actor_user_id:actor.userId,p_tenant_id:actor.tenantId,p_name:v.name,p_location:v.location,p_description:v.description});
 if(error?.code==="23505")return{ok:false,error:"Nama Project tersebut sudah digunakan."};
 if(error)return{ok:false,error:"Project gagal disimpan. Silakan coba lagi."};return{ok:true};
 }catch{return{ok:false,error:"Akses atau penyimpanan Project gagal. Silakan muat ulang halaman."};}
}
export async function updateProject(id:string,input:Input):Promise<Result>{
 try{const actor=await requireOwner();if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))return{ok:false,error:"Data Project tidak valid."};
 if(typeof input?.isActive!=="boolean")return{ok:false,error:"Status Project tidak valid."};
 const v=clean(input);if(typeof v==="string")return{ok:false,error:v};
 if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
 const {data:existing,error:lookupError}=await createAdminClient().from("projects").select("id").eq("tenant_id",actor.tenantId).eq("id",id).maybeSingle();
 if(lookupError||!existing)return{ok:false,error:"Project tidak ditemukan pada perusahaan aktif."};
 const {error}=await createAdminClient().rpc("update_project_with_audit",{p_project_id:id,p_actor_user_id:actor.userId,p_name:v.name,p_location:v.location,p_description:v.description,p_is_active:input.isActive});
 if(error?.code==="23505")return{ok:false,error:"Nama Project tersebut sudah digunakan."};
 if(error)return{ok:false,error:"Perubahan Project gagal disimpan. Silakan coba lagi."};return{ok:true};
 }catch{return{ok:false,error:"Akses atau perubahan Project gagal. Silakan muat ulang halaman."};}
}
