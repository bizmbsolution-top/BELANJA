import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
import ExpenseCategoryManager,{type ExpenseCategory} from "./manager";
export const dynamic="force-dynamic";
export const revalidate=0;
const ROLES=["Cashier","Finance","Management"] as const;
export default async function ExpenseCategoryPage(){
 const context = await requireAnyRole(ROLES);
 const admin=createAdminClient();
 let {data:accounts,error}=await admin.from("expense_categories").select("id,code,name,description,is_active,cost_classification,expense_type,calculation_method,calculation_basis,calculation_rate").eq("tenant_id",context.tenantId).order("code").limit(500);
 if(error){const legacy=await admin.from("expense_categories").select("id,code,name,description,is_active,cost_classification").eq("tenant_id",context.tenantId).order("code").limit(500);accounts=(legacy.data??[]).map(x=>({...x,expense_type:"company_payable",calculation_method:"manual",calculation_basis:"manual",calculation_rate:null}));error=legacy.error;}
 if(error)throw new Error("Data master kategori pengeluaran gagal dimuat.");
 return <ExpenseCategoryManager initialItems={(accounts??[]) as ExpenseCategory[]}/>;
}
