import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import CategoryManager, { type PurchaseCategory } from "./category-manager";

const CATEGORY_ROLES = ["Finance", "Management"] as const;

export default async function CategoryPage() {
  await requireAnyRole(CATEGORY_ROLES);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchase_categories")
    .select("id, code, name, description, is_active")
    .order("name", { ascending: true })
    .limit(500);

  if (error) throw new Error("Data kategori pembelian gagal dimuat. Silakan muat ulang halaman.");

  return <CategoryManager initialCategories={(data ?? []) as PurchaseCategory[]} />;
}
