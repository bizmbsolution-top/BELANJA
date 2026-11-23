import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
import ExpenseCategoryManager,{type ExpenseCategory} from "./manager";
export const dynamic="force-dynamic";
export const revalidate=0;
const ROLES=["Cashier","Finance","Management"] as const;
export default async function ExpenseCategoryPage(){
 const context = await requireAnyRole(ROLES);
 const {data:accounts,error}=await createAdminClient().from("expense_categories")
  .select("id,code,name,description,is_active,cost_classification").eq("tenant_id", context.tenantId).eq("tenant_id", context.tenantId).order("code").limit(500);
 if(error)throw new Error("Data master akun biaya gagal dimuat.");
 return <ExpenseCategoryManager initialItems={(accounts??[]) as ExpenseCategory[]}/>;
}
