import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ReturnClient from "./return-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PurchaseReturnPage() {
  const actor = await requireAnyRole(["Procurement"]);
  const admin = createAdminClient();
  let projectIds: string[] | null = null;
  let warehouseIds: string[] | null = null;

  if (actor.tenantRole !== "superadmin") {
    const [{ data: projectScope }, { data: warehouseScope }] = await Promise.all([
      admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
        .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle(),
      admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids")
        .eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "warehouse").maybeSingle()
    ]);
    projectIds = projectScope?.scope_mode === "all" ? null : projectScope?.scope_mode === "selected" ? projectScope.resource_ids ?? [] : [];
    warehouseIds = warehouseScope?.scope_mode === "all" ? null : warehouseScope?.scope_mode === "selected" ? warehouseScope.resource_ids ?? [] : [];
  }

  const [{ data: cases, error: caseError }, { data: returns, error: returnError }, { data: items, error: itemError }, { data: credits, error: creditError }, { data: creditSuppliers, error: creditSupplierError }] = await Promise.all([
    admin.from("inventory_lot_quarantines")
      .select("id,lot_id,quarantined_weight_kg,returned_weight_kg,released_weight_kg,reason,created_at,inventory_lots!inner(code,project_id,warehouse_id,tenant_id)")
      .eq("tenant_id", actor.tenantId).eq("status", "Active").order("created_at", { ascending: false }),
    // Keep return headers independent from item relations so Draft status is always read directly.
    admin.from("purchase_returns")
      .select("id,code,status,return_date,reason,created_at,posted_at")
      .eq("tenant_id", actor.tenantId).order("created_at", { ascending: false }).limit(100),
    admin.from("purchase_return_items")
      .select("id,quarantine_id,weight_kg,purchase_return_id,lot_id,inventory_lots!inner(code,project_id,warehouse_id)")
      .eq("tenant_id", actor.tenantId),
    admin.from("purchase_return_supplier_credits")
      .select("id,purchase_return_item_id,supplier_id,returned_weight_kg,unit_price_per_kg,credit_amount,remaining_amount,decision,status")
      .eq("tenant_id", actor.tenantId),
    admin.from("suppliers").select("id,code,name").eq("tenant_id", actor.tenantId)
  ]);

  if (caseError || returnError || itemError || creditError || creditSupplierError) throw new Error("Data Karantina, Return, atau Kredit Supplier gagal dimuat.");

  const allowed = (lot: { project_id: string; warehouse_id: string }) =>
    (projectIds === null || projectIds.includes(lot.project_id)) &&
    (warehouseIds === null || warehouseIds.includes(lot.warehouse_id));
  const allowedItems = (items ?? []).filter(item => {
    const lot = Array.isArray(item.inventory_lots) ? item.inventory_lots[0] : item.inventory_lots;
    return Boolean(lot && allowed(lot));
  });

  // Build the visible history first, then calculate reservations from those exact
  // Draft rows. This keeps the balance table consistent with the Draft list below.
  const allowedReturnIds = new Set(allowedItems.map(item => item.purchase_return_id));
  const returnItemsById = new Map<string, typeof allowedItems>();
  for (const item of allowedItems) {
    const current = returnItemsById.get(item.purchase_return_id) ?? [];
    current.push(item);
    returnItemsById.set(item.purchase_return_id, current);
  }
  const supplierNameById = new Map((creditSuppliers ?? []).map(supplier => [supplier.id, { code: supplier.code, name: supplier.name }]));
  type ReturnCredit = {
    id: string;
    supplier_id: string;
    returned_weight_kg: number;
    unit_price_per_kg: number;
    credit_amount: number;
    remaining_amount: number;
    decision: string;
    status: string;
  };
  // Normalize generated Supabase row types at the server boundary. The DB columns
  // are present for every credit row, although generated types may mark them optional.
  const creditByItemId = new Map<string, ReturnCredit>(
    (credits ?? []).map(credit => [String(credit.purchase_return_item_id), {
      id: String(credit.id),
      supplier_id: String(credit.supplier_id),
      returned_weight_kg: Number(credit.returned_weight_kg ?? 0),
      unit_price_per_kg: Number(credit.unit_price_per_kg ?? 0),
      credit_amount: Number(credit.credit_amount ?? 0),
      remaining_amount: Number(credit.remaining_amount ?? 0),
      decision: String(credit.decision ?? "pending"),
      status: String(credit.status ?? "pending_decision")
    }] as const)
  );
  const visibleReturns = (returns ?? [])
    .filter(returnHeader => allowedReturnIds.has(returnHeader.id))
    .map(returnHeader => ({
      ...returnHeader,
      purchase_return_items: (returnItemsById.get(returnHeader.id) ?? []).map(item => {
        const credit = creditByItemId.get(item.id);
        return {
          id: item.id,
          quarantine_id: item.quarantine_id,
          weight_kg: item.weight_kg,
          lot_id: item.lot_id,
          inventory_lots: item.inventory_lots,
          credit: credit ? {
            ...credit,
            supplier: supplierNameById.get(credit.supplier_id) ?? null
          } : null
        };
      })
    }));

  const reserved = new Map<string, number>();
  for (const returnHeader of visibleReturns) {
    if (returnHeader.status !== "Draft") continue;
    for (const item of returnHeader.purchase_return_items) {
      reserved.set(
        item.quarantine_id,
        (reserved.get(item.quarantine_id) ?? 0) + Number(item.weight_kg)
      );
    }
  }

  const activeCases = (cases ?? [])
    .filter(q => {
      const lot = Array.isArray(q.inventory_lots) ? q.inventory_lots[0] : q.inventory_lots;
      return Boolean(lot && allowed(lot));
    })
    .map(q => {
      const lot = Array.isArray(q.inventory_lots) ? q.inventory_lots[0] : q.inventory_lots;
      const reservedWeightKg = reserved.get(q.id) ?? 0;
      return {
        id: q.id,
        lotCode: lot?.code ?? "Lot",
        lotId: q.lot_id,
        projectId: lot?.project_id,
        warehouseId: lot?.warehouse_id,
        quarantinedWeightKg: Number(q.quarantined_weight_kg),
        returnedWeightKg: Number(q.returned_weight_kg),
        releasedWeightKg: Number(q.released_weight_kg),
        reservedWeightKg,
        availableWeightKg: Math.max(0,
          Number(q.quarantined_weight_kg) - Number(q.returned_weight_kg) -
          Number(q.released_weight_kg) - reservedWeightKg),
        reason: q.reason,
        createdAt: q.created_at
      };
    });

  return <ReturnClient cases={activeCases} returns={visibleReturns} />;
}
