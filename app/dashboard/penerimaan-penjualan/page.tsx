import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
import SettlementManager from "./manager";
export const dynamic="force-dynamic";
export const revalidate=0;
export default async function SalesSettlementPage(){
 await requireAnyRole(["Finance"]);
 const db=createAdminClient();
 const [{data:orders,error},{data:settlements},{data:components},{data:customers},{data:projects},{data:deductions}]=await Promise.all([
  db.from("sales_orders").select("id,code,customer_id,project_id,final_amount,ba_number,ba_date,finalized_at").eq("status","Selesai").order("ba_date",{ascending:false}).limit(300),
  db.from("sales_order_settlements").select("id,sales_order_id,amount,gross_amount,total_deductions,payment_method,payment_reference,received_at,received_by,evidence_file_name,evidence_storage_path").order("received_at",{ascending:false}).limit(300),
  db.from("sales_invoice_deduction_components").select("id,customer_id,code,name,calculation_method,default_value,is_active,sort_order").eq("is_active",true).order("sort_order"),
  db.from("customers").select("id,name"),db.from("projects").select("id,code,name"),
  db.from("sales_order_settlement_deductions").select("settlement_id,component_name,deduction_amount")
 ]);
 if(error)throw new Error("Daftar BA untuk settlement gagal dimuat.");
 const cMap=new Map((customers??[]).map(x=>[x.id,x.name]));
 const pMap=new Map((projects??[]).map(x=>[x.id,x.code+" · "+x.name]));
 const settled=new Set((settlements??[]).map(x=>x.sales_order_id));
 const rows=(orders??[]).map(o=>({...o,customer_name:cMap.get(o.customer_id)??"Pembeli",project_label:pMap.get(o.project_id)??"Project",settled:settled.has(o.id)}));
 const history=await Promise.all((settlements??[]).map(async s=>{const signed=s.evidence_storage_path?await db.storage.from("sales-settlement-evidence").createSignedUrl(s.evidence_storage_path,3600):{data:null};return {...s,evidence_url:signed.data?.signedUrl??null,customer_name:cMap.get((orders??[]).find(o=>o.id===s.sales_order_id)?.customer_id)??"Pembeli",ba_number:(orders??[]).find(o=>o.id===s.sales_order_id)?.ba_number??"—"};}));
 return <SettlementManager orders={rows} components={components??[]} settlements={history} deductions={deductions??[]}/>;
}