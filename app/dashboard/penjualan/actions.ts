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
export async function createSalesDraft(input:{customerId:string;projectId:string;destination:string;salePricePerKg:string;notes:string;allocations:{lotId:string;weightKg:string}[]}):Promise<Result>{
 try{
  const actor=await requireAnyRole(["Sales"]);
  if(!(await canWrite(actor.userId,actor.isOwner)))return{ok:false,error:"Permission transaksi belum diberikan oleh Owner."};
  if(!uuid(input.customerId)||!uuid(input.projectId)||!input.destination?.trim()||input.destination.trim().length<2)return{ok:false,error:"Lengkapi Pelanggan, Project, dan Tujuan Pengiriman."};
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
  const {data,error:rpcError}=await admin.rpc("create_sales_draft_with_audit",{
   p_actor_user_id:actor.userId,p_customer_id:input.customerId,p_project_id:input.projectId,
   p_destination:input.destination.trim(),p_sale_price_per_kg:price,p_notes:input.notes?.trim()||null,
   p_allocations:allocations.map(a=>({lot_id:a.lotId,weight_kg:a.weightKg}))
  });
  if(rpcError||!data)return{ok:false,error:rpcError?.message?.includes("available Lot stock")?"Berat melebihi stok Lot yang tersedia. Muat ulang data Persediaan.":rpcError?.message??"Draft Penjualan gagal disimpan."};
  revalidatePath("/dashboard/penjualan");revalidatePath("/dashboard/persediaan");return{ok:true,id:data as string};
 }catch(error){return{ok:false,error:error instanceof Error?error.message:"Draft Penjualan gagal disimpan."};}
}
