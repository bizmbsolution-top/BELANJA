"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
type Result={ok:true;items?:number;vouchers?:number}|{ok:false;error:string};
const uuid=(v:string)=>/^[0-9a-f-]{36}$/i.test(v);
export async function saveSalesExpenseMaster(input:{id?:string;name:string;categoryId:string;expenseType:string;method:string;basis:string;rate:string;recipient:string;description:string;active:boolean}):Promise<Result>{
 try{
  const actor=await requireAnyRole(["Management"]);
  if(!actor.tenantId)return{ok:false,error:"Tenant aktif tidak ditemukan."};
  const rate=Number(input.rate);
  if(input.id&&!uuid(input.id))return{ok:false,error:"Master biaya tidak valid."};
  if(input.name.trim().length<2||input.name.trim().length>120||!Number.isFinite(rate)||rate<=0)return{ok:false,error:"Nama dan tarif biaya harus valid."};
  if(input.expenseType==="company_payable"&&!uuid(input.categoryId))return{ok:false,error:"Kategori Expenses wajib dipilih untuk biaya yang dibayar perusahaan."};
  const {error}=await createAdminClient().rpc("save_sales_expense_master_with_audit",{p_master_id:input.id||null,p_actor_user_id:actor.userId,p_tenant_id:actor.tenantId,p_name:input.name.trim(),p_expense_category_id:input.categoryId||null,p_expense_type:input.expenseType,p_calculation_method:input.method,p_calculation_basis:input.basis,p_rate:rate,p_recipient_name:input.recipient.trim()||null,p_description:input.description.trim()||null,p_is_active:input.active});
  if(error)return{ok:false,error:error.message.includes("sudah digunakan")?error.message:"Master Biaya Penjualan gagal disimpan."};
  revalidatePath("/dashboard/kategori-expenses");revalidatePath("/dashboard/biaya-penjualan");return{ok:true};
 }catch(e){return{ok:false,error:e instanceof Error?e.message:"Akses Manajemen diperlukan."};}
}
export async function generateSalesExpenseVouchers(salesOrderId:string):Promise<Result>{
 try{
  const actor=await requireAnyRole(["Management"]);
  if(!uuid(salesOrderId))return{ok:false,error:"Transaksi penjualan tidak valid."};
  const admin=createAdminClient();
  const {data:order,error:orderError}=await admin.from("sales_orders")
   .select("id,project_id,status").eq("tenant_id",actor.tenantId).eq("id",salesOrderId).maybeSingle();
  if(orderError||!order||order.status!=="Selesai")return{ok:false,error:"BA final tidak ditemukan pada perusahaan aktif."};
  if(actor.tenantRole!=="superadmin"){
   const {data:project,error:projectError}=await admin.from("projects").select("id,is_active")
    .eq("tenant_id",actor.tenantId).eq("id",order.project_id).maybeSingle();
   if(projectError||!project?.is_active)return{ok:false,error:"Project tidak aktif atau tidak ditemukan."};
   const {data:scope,error:scopeError}=await admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
    .eq("tenant_id",actor.tenantId).eq("user_id",actor.userId).eq("dimension","project").maybeSingle();
   if(scopeError||!scope)return{ok:false,error:"Area kerja Project belum diatur oleh Superadmin perusahaan."};
   if(scope.scope_mode!=="all"&&!(scope.scope_mode==="selected"&&scope.resource_ids?.includes(order.project_id)))
    return{ok:false,error:"Project di luar area kerja akun Anda."};
  }
  const {data,error}=await admin.rpc("create_sales_expense_vouchers_from_ba",{p_sales_order_id:salesOrderId,p_actor_user_id:actor.userId});
  if(error)return{ok:false,error:error.message.includes("sudah pernah")?error.message:"Biaya BA gagal dihitung. Pastikan BA sudah final dan Master Biaya aktif."};
  revalidatePath("/dashboard/kategori-expenses");revalidatePath("/dashboard/biaya-penjualan");revalidatePath("/dashboard/pengeluaran");revalidatePath("/dashboard/laporan-penjualan");
  return{ok:true,items:Number(data?.items_created??0),vouchers:Number(data?.vouchers_created??0)};
 }catch(e){return{ok:false,error:e instanceof Error?e.message:"Akses Manajemen diperlukan."};}
}
