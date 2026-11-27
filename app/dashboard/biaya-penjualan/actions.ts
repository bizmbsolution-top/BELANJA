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
  if(input.id){const {data:existing,error:lookupError}=await createAdminClient().from("sales_expense_masters").select("id").eq("tenant_id",actor.tenantId).eq("id",input.id).maybeSingle();if(lookupError||!existing)return{ok:false,error:"Master biaya tidak ditemukan pada perusahaan aktif."};}
  const {error}=await createAdminClient().rpc("save_sales_expense_master_with_audit",{p_master_id:input.id||null,p_actor_user_id:actor.userId,p_tenant_id:actor.tenantId,p_name:input.name.trim(),p_expense_category_id:input.categoryId||null,p_expense_type:input.expenseType,p_calculation_method:input.method,p_calculation_basis:input.basis,p_rate:rate,p_recipient_name:input.recipient.trim()||null,p_description:input.description.trim()||null,p_is_active:input.active});
  if(error)return{ok:false,error:error.message.includes("sudah digunakan")?error.message:"Master Biaya Penjualan gagal disimpan."};
  revalidatePath("/dashboard/kategori-expenses");revalidatePath("/dashboard/biaya-penjualan");revalidatePath("/dashboard/penerimaan-penjualan");return{ok:true};
 }catch(e){return{ok:false,error:e instanceof Error?e.message:"Akses Manajemen diperlukan."};}
}
export async function generateSalesExpenseVouchers(_salesOrderId:string):Promise<Result>{
 return {ok:false,error:"Biaya BA tidak lagi dibuat otomatis. Catat biaya secara manual melalui modul Pengeluaran (AP)."};
}
