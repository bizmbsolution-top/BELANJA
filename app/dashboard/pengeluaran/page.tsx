import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ExpenseManager, { type Expense, type ExpenseCategory } from "./manager";

const ROLES = ["Cashier", "Finance", "Management"] as const;

export default async function PengeluaranPage() {
  await guardPage(() => requireAnyRole(ROLES));
  const admin = createAdminClient();
  const [{ data: categories, error: categoryError }, { data: expenses, error: expenseError }] = await Promise.all([
    admin.from("expense_categories").select("id,code,name").eq("is_active", true).order("name"),
    admin.from("expenses").select("id,code,expense_date,expense_category_id,description,amount,payment_method,status,cancellation_reason,cancelled_at,created_at,expense_categories(name),expense_documents(id,file_name,mime_type,file_size,uploaded_at)").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
  ]);
  if (categoryError || expenseError) throw new Error("Data pengeluaran gagal dimuat.");
  return <ExpenseManager categories={(categories ?? []) as ExpenseCategory[]} initialItems={(expenses ?? []) as unknown as Expense[]} />;
}
