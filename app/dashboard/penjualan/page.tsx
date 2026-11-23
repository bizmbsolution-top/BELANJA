import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import SalesManager, { type SalesPageData } from "./sales-manager";
export default async function PenjualanPage(){
 const actor=await requireAnyRole(["Sales","Warehouse","Management"]);
 const admin=createAdminClient();
 const broad=actor.isOwner||actor.roles.includes("Management");
 let projectIds:string[]|null=null;
 if(!broad){const {data:s}=await admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id",actor.userId).eq("dimension","project").maybeSingle();if(!s)projectIds=[];else if(s.scope_mode==="all")projectIds=null;else if(s.scope_mode==="selected")projectIds=s.resource_ids??[];else projectIds=[];}
 let warehouseIds:string[]|null=null;
 if(!broad){const {data:s}=await admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id",actor.userId).eq("dimension","warehouse").maybeSingle();if(!s)warehouseIds=[];else if(s.scope_mode==="all")warehouseIds=null;else if(s.scope_mode==="selected")warehouseIds=s.resource_ids??[];else warehouseIds=[];}
 const [{data:projects},{data:warehouses},{data:mappings},{data:customers}]=await Promise.all([
  admin.from("projects").select("id,code,name").eq("is_active",true).order("name"),
  admin.from("warehouses").select("id,code,name").eq("is_active",true).order("name"),
  admin.from("warehouse_projects").select("project_id,warehouse_id"),
  admin.from("customers").select("id,code,name,billing_address,customer_warehouse_addresses(id,label,address,is_active)").eq("is_active",true).order("name")
 ]);
 const scopedProjects=(projects??[]).filter(p=>projectIds===null||projectIds.includes(p.id));
 const scopedWarehouses=(warehouses??[]).filter(w=>(warehouseIds===null||warehouseIds.includes(w.id))&&(mappings??[]).some(m=>m.warehouse_id===w.id&&scopedProjects.some(p=>p.id===m.project_id)));
 const pids=scopedProjects.map(p=>p.id), wids=scopedWarehouses.map(w=>w.id);
 const {data:lots}=pids.length&&wids.length?await admin.from("inventory_lots").select("id,code,project_id,warehouse_id,category_id,supplier_id,initial_weight_kg,grade_value,grade_unit,purchase_price_per_kg,total_purchase_cost,inbound_date").in("project_id",pids).in("warehouse_id",wids).order("inbound_date",{ascending:true}):{data:[]};
 const lotIds=(lots??[]).map(l=>l.id);
 const [{data:movements},{data:suppliers},{data:categories}]=await Promise.all([
  lotIds.length?admin.from("inventory_movements").select("lot_id,movement_type,weight_kg").in("lot_id",lotIds):Promise.resolve({data:[]}),
  admin.from("suppliers").select("id,name"),
  admin.from("purchase_categories").select("id,name")
 ]);
 const available=(lots??[]).map(l=>({...l,available_weight_kg:(movements??[]).filter(m=>m.lot_id===l.id).reduce((sum,m)=>sum+(["issue","transfer_out"].includes(m.movement_type)?-1:1)*Number(m.weight_kg),0)})).filter(l=>l.available_weight_kg>0.0001);
 let orderQuery=admin.from("sales_orders").select("*").order("created_at",{ascending:false}).limit(300);
 if(projectIds!==null)orderQuery=orderQuery.in("project_id",projectIds.length?projectIds:["00000000-0000-0000-0000-000000000000"]);
 const {data:orders}=await orderQuery;
 const orderIds=(orders??[]).map(o=>o.id);
 const {data:allocations}=orderIds.length?await admin.from("sales_order_lot_allocations").select("*").in("sales_order_id",orderIds):{data:[]};
 const allocWarehouseIds=[...new Set((allocations??[]).map(a=>a.source_warehouse_id))];
 const visibleOrderIds=new Set((orders??[]).filter(o=>(allocations??[]).filter(a=>a.sales_order_id===o.id).every(a=>warehouseIds===null||warehouseIds.includes(a.source_warehouse_id))).map(o=>o.id));
 const visibleOrders=(orders??[]).filter(o=>visibleOrderIds.has(o.id));
 const data:SalesPageData={actorRoles:actor.isOwner?["Superadmin"]:actor.roles,projects:scopedProjects,warehouses:scopedWarehouses,warehouseProjects:mappings??[],customers:(customers??[]).map((c:any)=>({...c,warehouse_addresses:(c.customer_warehouse_addresses??[]).filter((a:any)=>a.is_active)})),lots:available.map(l=>({...l,category_name:(categories??[]).find(c=>c.id===l.category_id)?.name??"—",supplier_name:(suppliers??[]).find(s=>s.id===l.supplier_id)?.name??"—"})),orders:visibleOrders,allocations:(allocations??[]).filter(a=>visibleOrderIds.has(a.sales_order_id)),categories:categories??[],suppliers:suppliers??[]};
 return <SalesManager data={data}/>;
}
