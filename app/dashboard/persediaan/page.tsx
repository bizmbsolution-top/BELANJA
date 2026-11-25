import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import InventoryClient from "./inventory-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Movement = {
  id: string; movement_type: string; receipt_id: string | null; lot_id: string | null; project_id: string;
  warehouse_id: string; category_id: string; weight_kg: number; value: number;
  value_unit: string; created_at: string;
};
type Lot = {
  id: string; code: string; source_receipt_id: string; purchase_request_id: string; is_cancelled: boolean;
  supplier_id: string; inbound_date: string; project_id: string; warehouse_id: string;
  category_id: string; initial_weight_kg: number; grade_value: number; grade_unit: string;
  purchase_price_per_kg: number; total_purchase_cost: number;
};

export default async function PersediaanPage() {
  const actor = await requireAnyRole(["Warehouse", "Management", "Finance", "Cashier", "Sales", "Procurement"]);
  const admin = createAdminClient();
  const broadAccess = actor.tenantRole === "superadmin" || actor.roles.includes("Management") || actor.roles.includes("Finance");
  const cashierAccess = actor.roles.includes("Cashier");
  let warehouseIds: string[] | null = null, projectIds: string[] | null = null;

  if (!broadAccess) {
    const projectScopePromise = admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle();
    const warehouseScopePromise = cashierAccess
      ? Promise.resolve({ data: null, error: null })
      : admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "warehouse").maybeSingle();
    const [{ data: ws, error: we }, { data: ps, error: pe }] = await Promise.all([warehouseScopePromise, projectScopePromise]);
    if (pe || !ps) throw new Error("Area kerja Project belum dapat diverifikasi.");
    projectIds = ps.scope_mode === "all" ? null : ps.scope_mode === "selected" ? ps.resource_ids ?? [] : [];
    if (!cashierAccess) {
      if (we || !ws) throw new Error("Area kerja Warehouse belum dapat diverifikasi.");
      warehouseIds = ws.scope_mode === "all" ? null : ws.scope_mode === "selected" ? ws.resource_ids ?? [] : [];
    }
  }

  const [{ data: movements, error }, { data: allWarehouses }, { data: projects }, { data: categories },
    { data: rawLots, error: lotError }, { data: suppliers }] = await Promise.all([
    admin.from("inventory_movements").select("id,movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_at").eq("tenant_id", actor.tenantId).order("created_at", { ascending: false }).limit(5000),
    admin.from("warehouses").select("id,code,name,location").eq("tenant_id", actor.tenantId).order("name"),
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).order("name"),
    admin.from("purchase_categories").select("id,name").eq("tenant_id", actor.tenantId).order("name"),
    admin.from("inventory_lots").select("id,code,source_receipt_id,purchase_request_id,supplier_id,inbound_date,project_id,warehouse_id,category_id,initial_weight_kg,grade_value,grade_unit,purchase_price_per_kg,total_purchase_cost,is_cancelled").eq("tenant_id", actor.tenantId).order("inbound_date", { ascending: false }).limit(5000),
    admin.from("suppliers").select("id,name").eq("tenant_id", actor.tenantId).order("name"),
  ]);
  if (error) throw new Error("Data pergerakan persediaan gagal dimuat.");
  if (lotError) throw new Error("Data Lot persediaan gagal dimuat.");

  const cancelledLotIds = new Set(((rawLots ?? []) as Lot[]).filter(l => l.is_cancelled).map(l => l.id));
  const visible = ((movements ?? []) as Movement[]).filter(m =>
    (!m.lot_id || !cancelledLotIds.has(m.lot_id)) &&
    (warehouseIds === null || warehouseIds.includes(m.warehouse_id)) &&
    (projectIds === null || projectIds.includes(m.project_id))
  );
  const visibleLots = ((rawLots ?? []) as Lot[]).filter(l =>
    !l.is_cancelled &&
    (warehouseIds === null || warehouseIds.includes(l.warehouse_id)) &&
    (projectIds === null || projectIds.includes(l.project_id))
  );
  const receiptIds = [...new Set(visible.map(m => m.receipt_id).filter((id): id is string => Boolean(id)))];
  const { data: receipts } = receiptIds.length
    ? await admin.from("purchase_receipts").select("id,code").eq("tenant_id", actor.tenantId).in("id", receiptIds)
    : { data: [] };
  const receiptMap = new Map((receipts ?? []).map(r => [r.id, r.code]));
  const projectMap = new Map((projects ?? []).map(p => [p.id, p]));
  const categoryMap = new Map((categories ?? []).map(c => [c.id, c]));
  const warehouseMap = new Map((allWarehouses ?? []).map(w => [w.id, w]));
  const supplierMap = new Map((suppliers ?? []).map(s => [s.id, s.name]));
  const lotMap = new Map(visibleLots.map(l => [l.id, l]));

  const balances = new Map<string, { warehouse_id:string; project_id:string; category_id:string; value_unit:string; weight:number; valueWeight:number }>();
  const lotBalances = new Map<string, number>();
  for (const m of visible) {
    const key = [m.warehouse_id,m.project_id,m.category_id,m.value_unit].join("|");
    const row = balances.get(key) ?? { warehouse_id:m.warehouse_id,project_id:m.project_id,category_id:m.category_id,value_unit:m.value_unit,weight:0,valueWeight:0 };
    const sign = m.movement_type === "issue" || m.movement_type === "transfer_out" || m.movement_type === "sale_dispatch" ? -1 : 1;
    const kg = Number(m.weight_kg);
    row.weight += sign*kg; row.valueWeight += sign*kg*Number(m.value);
    balances.set(key,row);
    if (m.lot_id) lotBalances.set(m.lot_id, (lotBalances.get(m.lot_id) ?? 0) + sign*kg);
  }
  const warehouseGroups = new Map<string, typeof balances extends Map<string,infer V> ? V[] : never>();
  for (const row of balances.values()) {
    if (row.weight <= 0.0001) continue;
    const group = warehouseGroups.get(row.warehouse_id) ?? [];
    group.push(row); warehouseGroups.set(row.warehouse_id,group);
  }
  const warehouses = [...warehouseGroups.entries()].map(([id,rows]) => {
    const w = warehouseMap.get(id);
    const projectLabels = [...new Set(rows.map(r => projectMap.get(r.project_id)).filter((project): project is NonNullable<typeof project> => Boolean(project)).map(project => `${project.code} · ${project.name}`))];
    const total = rows.reduce((s,r)=>s+r.weight,0);
    const valueUnits = [...new Set(rows.map(r=>r.value_unit))];
    const averageValueUnit = valueUnits.length === 1 ? valueUnits[0] : null;
    const averageValue = averageValueUnit && total > 0
      ? rows.reduce((sum,r)=>sum+r.valueWeight,0)/total
      : null;
    return { id, code:w?.code ?? "GDG", name:w?.name ?? "Gudang", location:w?.location ?? null,
      projectLabel:projectLabels.join(", "),
      totalKg:total, averageValue, averageValueUnit,
      categories: [...rows.reduce((map,r) => { const name=categoryMap.get(r.category_id)?.name ?? "Barang"; const key=name+"|"+r.value_unit; const item=map.get(key) ?? {name,weight:0,valueWeight:0,valueUnit:r.value_unit}; item.weight+=r.weight; item.valueWeight+=r.valueWeight; map.set(key,item); return map; },new Map<string,{name:string;weight:number;valueWeight:number;valueUnit:string}>()).values()].map(r=>({name:r.name,weight:r.weight,averageValue:r.weight?r.valueWeight/r.weight:0,valueUnit:r.valueUnit})).sort((a,b)=>a.name.localeCompare(b.name))
    };
  }).sort((a,b)=>a.name.localeCompare(b.name));

  const lotGroups: Record<string, {id:string;code:string;inboundDate:string;category:string;supplier:string;initialWeight:number;availableWeight:number;gradeValue:number;gradeUnit:string;purchasePricePerKg:number;totalPurchaseCost:number}[]> = {};
  for (const lot of visibleLots) {
    const availableWeight = Math.max(0, lotBalances.get(lot.id) ?? 0);
    if (availableWeight <= 0.0001) continue;
    (lotGroups[lot.warehouse_id] ??= []).push({
      id:lot.id,code:lot.code,inboundDate:lot.inbound_date,
      category:categoryMap.get(lot.category_id)?.name ?? "Barang",
      supplier:supplierMap.get(lot.supplier_id) ?? "Supplier",
      initialWeight:Number(lot.initial_weight_kg),availableWeight,
      gradeValue:Number(lot.grade_value),gradeUnit:lot.grade_unit,
      purchasePricePerKg:Number(lot.purchase_price_per_kg),totalPurchaseCost:Number(lot.total_purchase_cost)
    });
  }
  for (const rows of Object.values(lotGroups)) rows.sort((a,b)=>b.inboundDate.localeCompare(a.inboundDate)||a.code.localeCompare(b.code));

  const movementGroups: Record<string, {id:string;type:string;date:string;category:string;weight:number;value:number;valueUnit:string;reference:string;lotCode:string;projectCode:string;projectName:string}[]> = {};
  for (const m of visible) {
    const p=projectMap.get(m.project_id);
    const lotCode=m.lot_id ? lotMap.get(m.lot_id)?.code ?? "" : "";
    const receiptCode=m.receipt_id ? receiptMap.get(m.receipt_id) ?? "" : "";
    (movementGroups[m.warehouse_id] ??= []).push({
      id:m.id,type:m.movement_type,date:m.created_at,category:categoryMap.get(m.category_id)?.name ?? "Barang",
      weight:Number(m.weight_kg),value:Number(m.value),valueUnit:m.value_unit,
      reference:[receiptCode ? `Penerimaan ${receiptCode}` : "",lotCode].filter(Boolean).join(" · "),
      lotCode,projectCode:p?.code ?? "",projectName:p?.name ?? ""
    });
  }
  const totalKg=warehouses.reduce((s,w)=>s+w.totalKg,0);
  const categoryCount=new Set(warehouses.flatMap(w=>w.categories.map(c=>c.name))).size;
  return <InventoryClient warehouses={warehouses} lots={lotGroups} movements={movementGroups} totalKg={totalKg} movementCount={visible.length} categoryCount={categoryCount}/>;
}
