import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ReturnClient from "./return-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PurchaseReturnPage() {
  const actor = await requireAnyRole(["Procurement"]);
  const admin = createAdminClient();
  const [{data: cases,error:caseError},{data:returns,error:returnError},{data:items,error:itemError}] = await Promise.all([
    admin.from("inventory_lot_quarantines")
      .select("id,lot_id,quarantined_weight_kg,returned_weight_kg,released_weight_kg,reason,created_at,inventory_lots!inner(code,project_id,warehouse_id,tenant_id)")
      .eq("tenant_id",actor.tenantId).eq("status","Active").order("created_at",{ascending:false}),
    admin.from("purchase_returns")
      .select("id,code,status,return_date,reason,created_at,posted_at")
      .eq("tenant_id",actor.tenantId).order("created_at",{ascending:false}).limit(100),
    admin.from("purchase_return_items")
      .select("quarantine_id,weight_kg,purchase_return_id,purchase_returns!inner(status)")
      .eq("tenant_id",actor.tenantId)
  ]);
  if(caseError||returnError||itemError) throw new Error("Data Karantina atau Return Pembelian gagal dimuat.");
  const reserved = new Map<string,number>();
  for(const item of items??[]) {
    const header = Array.isArray(item.purchase_returns)?item.purchase_returns[0]:item.purchase_returns;
    if(header?.status==="Draft") reserved.set(item.quarantine_id,(reserved.get(item.quarantine_id)??0)+Number(item.weight_kg));
  }
  const activeCases=(cases??[]).map(q=>{
    const lot=Array.isArray(q.inventory_lots)?q.inventory_lots[0]:q.inventory_lots;
    return {id:q.id,lotCode:lot?.code??"Lot",lotId:q.lot_id,projectId:lot?.project_id,warehouseId:lot?.warehouse_id,
      quarantinedWeightKg:Number(q.quarantined_weight_kg),returnedWeightKg:Number(q.returned_weight_kg),
      releasedWeightKg:Number(q.released_weight_kg),reservedWeightKg:reserved.get(q.id)??0,
      availableWeightKg:Math.max(0,Number(q.quarantined_weight_kg)-Number(q.returned_weight_kg)-Number(q.released_weight_kg)-(reserved.get(q.id)??0)),
      reason:q.reason,createdAt:q.created_at};
  }).filter(q=>q.availableWeightKg>0.0001);
  return <ReturnClient cases={activeCases} returns={returns??[]} />;
}
