import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
import ExpenseCategoryManager,{type ExpenseCategory} from "./manager";
const ROLES=["Cashier","Finance","Management"] as const;
export default async function ExpenseCategoryPage(){await requireAnyRole(ROLES);const {data,error}=await createAdminClient().from("expense_categories").select("id,code,name,description,is_active").order("name").limit(500);if(error)throw new Error("Data kategori expenses gagal dimuat.");return <ExpenseCategoryManager initialItems={(data??[]) as ExpenseCategory[]}/>;}
