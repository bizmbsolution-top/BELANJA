import { requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import DeductionMaster from "./manager";
export const dynamic="force-dynamic";
export default async function DeductionMasterPage(){
 const context = await requireOwner();
 const db=createAdminClient();
 const [{data:components,error},{data:customers}]=await Promise.all([
  db.from("sales_invoice_deduction_components").select("id,customer_id,code,name,calculation_method,default_value,is_active,sort_order,notes").eq("tenant_id", context.tenantId).order("sort_order").order("name"),
  db.from("customers").select("id,code,name").eq("tenant_id", context.tenantId).eq("is_active",true).order("name")
 ]);
 if(error)throw new Error("Master Potongan Invoice gagal dimuat.");
 return <DeductionMaster components={components??[]} customers={customers??[]}/>;
}