import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import FinancialReport, { type FinancialOrder, type FinancialProject, type FinancialExpenseItem, type FinancialVoucher, type FinancialSettlement, type FinancialDeduction } from "./report";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function FinancialReportPage() {
  await requireAnyRole(["Finance", "Management"]);
  const db = createAdminClient();
  const [{ data: orders, error }, { data: projects }, { data: customers }, { data: settlements }, { data: items, error: itemError }] = await Promise.all([
    db.from("sales_orders").select("id,code,customer_id,project_id,status,dispatched_weight_kg,received_weight_kg,final_amount,dispatched_purchase_cost,ba_number,ba_date").eq("status", "Selesai").not("ba_date", "is", null).order("ba_date", { ascending: false }).limit(1500),
    db.from("projects").select("id,code,name"), db.from("customers").select("id,name"),
    db.from("sales_order_settlements").select("id,sales_order_id,gross_amount,total_deductions,amount,payment_method,received_at"),
    db.from("sales_order_expense_items").select("id,sales_order_id,master_code_snapshot,master_name_snapshot,expense_type,final_amount,recipient_name_snapshot").limit(10000),
  ]);
  if (error || itemError) throw new Error("Data laporan keuangan gagal dimuat.");
  const orderRows = orders ?? [];
  const orderIds = orderRows.map(row => row.id);
  const itemIds = (items ?? []).filter(item => orderIds.includes(item.sales_order_id)).map(item => item.id);
  const [{ data: vouchers, error: voucherError }, { data: deductions, error: deductionError }] = await Promise.all([
    itemIds.length ? db.from("expenses").select("id,code,status,amount,paid_amount,sales_order_expense_item_id").in("sales_order_expense_item_id", itemIds).limit(10000) : Promise.resolve({ data: [], error: null }),
    db.from("sales_order_settlement_deductions").select("settlement_id,component_code,component_name,deduction_amount").limit(10000),
  ]);
  if (voucherError || deductionError) throw new Error("Rincian biaya atau potongan settlement gagal dimuat.");
  const customerMap = new Map((customers ?? []).map(row => [row.id, row.name]));
  return <FinancialReport orders={orderRows.map(row => ({ ...row, customer_name: customerMap.get(row.customer_id) ?? "Pembeli" })) as FinancialOrder[]} projects={(projects ?? []) as FinancialProject[]} expenseItems={(items ?? []).filter(item => orderIds.includes(item.sales_order_id)) as FinancialExpenseItem[]} vouchers={(vouchers ?? []) as FinancialVoucher[]} settlements={(settlements ?? []) as FinancialSettlement[]} deductions={(deductions ?? []) as FinancialDeduction[]} />;
}
