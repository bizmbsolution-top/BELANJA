import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import PurchaseManager, { type PurchasePageData } from "./purchase-manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MODULE_ROLES = ["Procurement", "Cashier", "Finance", "Management"] as const;

export default async function PembelianPage() {
  const actor = await requireAnyRole(MODULE_ROLES);
  const admin = createAdminClient();
  let projectIds: string[] | null = null;
  if (actor.tenantRole !== "superadmin" && !actor.roles.includes("Finance") && !actor.roles.includes("Management")) {
    const { data: scope, error } = await admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId)
      .eq("user_id", actor.userId).eq("dimension", "project").maybeSingle();
    if (error || !scope) projectIds = [];
    else if (scope.scope_mode === "selected") projectIds = scope.resource_ids ?? [];
    else if (scope.scope_mode === "all") {
      const { data } = await admin.from("projects").select("id").eq("tenant_id", actor.tenantId).eq("is_active", true);
      projectIds = (data ?? []).map(row => row.id);
    } else projectIds = [];
  }

  let warehouseIds: string[] | null = null;
  if ((actor.roles.includes("Procurement") || actor.roles.includes("Cashier")) && actor.tenantRole !== "superadmin" && !actor.roles.includes("Finance") && !actor.roles.includes("Management")) {
    const { data: scope } = await admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId)
      .eq("user_id", actor.userId).eq("dimension", "warehouse").maybeSingle();
    if (!scope) warehouseIds = [];
    else if (scope.scope_mode === "selected") warehouseIds = scope.resource_ids ?? [];
    else if (scope.scope_mode === "all") warehouseIds = null;
    else warehouseIds = [];
  }

  const [{ data: projects }, { data: suppliers }, { data: categories }, { data: warehouses }, { data: mappings }] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("suppliers").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("purchase_categories").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("warehouses").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("warehouse_projects").select("warehouse_id,project_id").eq("tenant_id", actor.tenantId),
  ]);
  const scopedProjects = (projects ?? []).filter(row => projectIds === null || projectIds.includes(row.id));
  const scopedWarehouses = (warehouses ?? []).filter(row =>
    (warehouseIds === null || warehouseIds.includes(row.id)) &&
    (mappings ?? []).some(m => m.warehouse_id === row.id && scopedProjects.some(p => p.id === m.project_id))
  );

  let requestQuery = admin.from("purchase_requests").select("*").eq("tenant_id", actor.tenantId).order("created_at", { ascending: false }).limit(300);
  if (projectIds !== null) requestQuery = requestQuery.in("project_id", projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"]);
  if (warehouseIds !== null && (actor.roles.includes("Procurement") || actor.roles.includes("Cashier"))) {
    requestQuery = requestQuery.in("warehouse_id", warehouseIds.length ? warehouseIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: requests, error: requestError } = await requestQuery;
  if (requestError) throw new Error("Data permintaan pembelian gagal dimuat.");
  const requestIds = (requests ?? []).map(row => row.id);
  const { data: receipts } = requestIds.length
    ? await admin.from("purchase_receipts").select("*").eq("tenant_id", actor.tenantId).in("purchase_request_id", requestIds).order("created_at", { ascending: false })
    : { data: [] };
  const receiptIds = (receipts ?? []).map(row => row.id);
  const [{ data: payments }, { data: lots }] = await Promise.all([
    receiptIds.length
      ? admin.from("purchase_payment_requests").select("*").eq("tenant_id", actor.tenantId).in("receipt_id", receiptIds).order("requested_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    receiptIds.length
      ? admin.from("inventory_lots").select("id,source_receipt_id,is_problematic,problematic_reason,is_cancelled,cancellation_reason,is_returned").eq("tenant_id", actor.tenantId).in("source_receipt_id", receiptIds)
      : Promise.resolve({ data: [] }),
  ]);
  const { data: supplierCredits, error: creditError } = await admin.from("purchase_return_supplier_credits")
    .select("id,supplier_id,returned_weight_kg,unit_price_per_kg,credit_amount,remaining_amount,status")
    .eq("tenant_id", actor.tenantId).in("status", ["available", "partially_used"])
    .order("created_at", { ascending: true });
  if (creditError) throw new Error("Data Kredit Return Supplier gagal dimuat.");

  const lotIds = (lots ?? []).map(row => row.id);
  const { data: returnMovements } = lotIds.length
    ? await admin.from("inventory_movements").select("lot_id,weight_kg").eq("tenant_id", actor.tenantId).eq("movement_type", "purchase_return").in("lot_id", lotIds)
    : { data: [] };
  const returnedByLot = new Map<string, number>();
  for (const movement of returnMovements ?? []) { if (!movement.lot_id) continue; returnedByLot.set(movement.lot_id, (returnedByLot.get(movement.lot_id) ?? 0) + Number(movement.weight_kg)); }

  const paymentIds = (payments ?? []).map(row => row.id);
  const [{ data: receiptDocs }, { data: paymentDocs }] = await Promise.all([
    receiptIds.length ? admin.from("purchase_receipt_documents").select("*").eq("tenant_id", actor.tenantId).in("receipt_id", receiptIds) : Promise.resolve({ data: [] }),
    paymentIds.length ? admin.from("purchase_payment_documents").select("*").eq("tenant_id", actor.tenantId).in("payment_request_id", paymentIds) : Promise.resolve({ data: [] }),
  ]);
  const signedReceiptDocs = await Promise.all((receiptDocs ?? []).map(async doc => {
    const { data } = await admin.storage.from("purchase-receipt-evidence").createSignedUrl(doc.storage_path, 3600);
    return { ...doc, signed_url: data?.signedUrl ?? null };
  }));
  const signedPaymentDocs = await Promise.all((paymentDocs ?? []).map(async doc => {
    const { data } = await admin.storage.from("purchase-payment-evidence").createSignedUrl(doc.storage_path, 3600);
    return { ...doc, signed_url: data?.signedUrl ?? null };
  }));

  const data: PurchasePageData = {
    actorRoles: actor.tenantRole === "superadmin" ? ["Superadmin"] : actor.activeRole ? [actor.activeRole] : [],
    projects: scopedProjects, suppliers: suppliers ?? [], categories: categories ?? [], warehouses: scopedWarehouses,
    requests: requests ?? [], receipts: receipts ?? [], payments: payments ?? [], lots: (lots ?? []).map(lot => ({ ...lot, returned_weight_kg: returnedByLot.get(lot.id) ?? 0 })),
    receiptDocs: signedReceiptDocs, paymentDocs: signedPaymentDocs, warehouseProjects: mappings ?? [],
    supplierCredits: (supplierCredits ?? []).map(credit => ({
      ...credit,
      return_code: "Kredit " + String(credit.id).slice(0, 8).toUpperCase(),
    })),
  };
  return <PurchaseManager data={data} />;
}
