import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import SalesExpenseManager,{type SalesExpenseMaster,type SalesBA,type ExpenseCategory} from "./manager";
export const dynamic="force-dynamic";
export const revalidate=0;
export default async function SalesExpensePage(){
 await requireAnyRole(["Management"]);
 const db=createAdminClient();
 const [{data:masters,error:me},{data:categories,error:ce},{data:orders,error:oe},{data:items,error:ie},{data:customers},{data:projects}]=await Promise.all([
  db.from("sales_expense_masters").select("id,code,name,expense_category_id,expense_type,calculation_method,calculation_basis,rate,recipient_name,description,is_active").order("code"),
  db.from("expense_categories").select("id,code,name").eq("is_active",true).order("name"),
  db.from("sales_orders").select("id,code,project_id,customer_id,received_weight_kg,final_amount,ba_number,ba_date,final_price_per_kg").eq("status","Selesai").order("finalized_at",{ascending:false}).limit(100),
  db.from("sales_order_expense_items").select("sales_order_id,expense_type,final_amount"),
  db.from("customers").select("id,name"),db.from("projects").select("id,code,name")
 ]);
 if(me||ce||oe||ie)throw new Error("Data Biaya Penjualan gagal dimuat.");
 const customerMap=new Map((customers??[]).map(x=>[x.id,x.name]));
 const projectMap=new Map((projects??[]).map(x=>[x.id,x.code+" · "+x.name]));
 const generated=new Set((items??[]).map(x=>x.sales_order_id));
 const baRows=(orders??[]).map(o=>({...o,customer_name:customerMap.get(o.customer_id)??"Pembeli",project_label:projectMap.get(o.project_id)??"Project",already_generated:generated.has(o.id)}));
 return <SalesExpenseManager masters={(masters??[]) as SalesExpenseMaster[]} categories={(categories??[]) as ExpenseCategory[]} orders={baRows as SalesBA[]}/>;
}
