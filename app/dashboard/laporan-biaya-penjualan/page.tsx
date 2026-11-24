import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import SalesExpenseReport, { type ReportBA, type ReportItem, type ReportExpense, type ReportProject, type ReportClosing } from "./report";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesExpenseReportPage() {
  const actor = await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  const admin = createAdminClient();
  const broadAccess = actor.tenantRole === "superadmin" || actor.roles.some(role => role === "Finance" || role === "Management");
  const [{ data: allProjects, error: projectError }, { data: overrides, error: permissionError }, scopeResult] = await Promise.all([
    admin.from("projects").select("id,code,name").eq("tenant_id", actor.tenantId).eq("is_active", true).order("name"),
    admin.from("tenant_user_permission_overrides").select("permission_key,effect").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId),
    broadAccess ? Promise.resolve({ data: null, error: null }) :
      admin.from("tenant_user_work_scopes").select("scope_mode,resource_ids").eq("tenant_id", actor.tenantId).eq("user_id", actor.userId).eq("dimension", "project").maybeSingle(),
  ]);
  if (projectError || permissionError || scopeResult.error) throw new Error("Area kerja laporan biaya penjualan gagal dimuat.");
  const scope = scopeResult.data as { scope_mode?: string; resource_ids?: string[] } | null;
  const projects = broadAccess ? (allProjects ?? []) : scope?.scope_mode === "all" ? (allProjects ?? []) :
    (allProjects ?? []).filter(project => scope?.scope_mode === "selected" && scope.resource_ids?.includes(project.id));
  const projectIds = projects.map(project => project.id);
  const fallbackId = "00000000-0000-0000-0000-000000000000";
  const [{ data: orders, error: orderError }, { data: customers }, { data: items, error: itemError }, { data: expenses, error: expenseError }, { data: closings, error: closingError }] = await Promise.all([
    admin.from("sales_orders").select("id,code,customer_id,project_id,ba_number,ba_date,received_weight_kg,final_amount").eq("tenant_id", actor.tenantId).eq("status","Selesai").in("project_id", projectIds.length ? projectIds : [fallbackId]).not("ba_date","is",null).order("ba_date",{ascending:false}).limit(1500),
    admin.from("customers").select("id,name").eq("tenant_id", actor.tenantId),
    admin.from("sales_order_expense_items").select("id,sales_order_id,master_code_snapshot,master_name_snapshot,expense_type,final_amount,recipient_name_snapshot").eq("tenant_id", actor.tenantId).limit(5000),
    admin.from("expenses").select("id,code,status,amount,paid_amount,paid_at,paid_method,sales_order_expense_item_id").eq("tenant_id", actor.tenantId).not("sales_order_expense_item_id","is",null).limit(5000),
    admin.from("sales_expense_period_closings").select("id,project_id,period_month,total_paid_amount,voucher_count,component_count,closed_by,closed_at").eq("tenant_id", actor.tenantId).limit(1000),
  ]);
  if (orderError || itemError || expenseError || closingError) throw new Error("Data laporan biaya penjualan gagal dimuat.");
  const visibleOrderIds = new Set((orders ?? []).map(order => order.id));
  const visibleItems = (items ?? []).filter(item => visibleOrderIds.has(item.sales_order_id));
  const visibleItemIds = new Set(visibleItems.map(item => item.id));
  const visibleExpenses = (expenses ?? []).filter(expense => visibleItemIds.has(expense.sales_order_expense_item_id));
  const visibleClosings = (closings ?? []).filter(closing => projectIds.includes(closing.project_id));
  const canClose = actor.tenantRole === "superadmin" || (actor.roles.includes("Cashier") && (overrides ?? []).some(row => row.permission_key === "payment.post" && row.effect === "allow"));
  return <SalesExpenseReport
    orders={(orders ?? []).map(order => ({...order, customer_name:(customers ?? []).find(customer => customer.id === order.customer_id)?.name ?? "Pembeli"})) as ReportBA[]}
    items={visibleItems as ReportItem[]}
    expenses={visibleExpenses as ReportExpense[]}
    projects={projects as ReportProject[]}
    closings={visibleClosings as ReportClosing[]}
    canClose={canClose}
    viewerIsCashier={actor.tenantRole === "superadmin" || actor.roles.includes("Cashier")}
  />;
}
