"use server";

import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const CATEGORY_ROLES = ["Procurement", "Finance", "Management"] as const;

type CategoryInput = { name: string; description: string; isActive?: boolean };
type CleanCategory = { name: string; description: string | null };
type ActionResult = { ok: true } | { ok: false; error: string };

function cleanInput(input: CategoryInput): CleanCategory | string {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  if (!name) return "Nama kategori wajib diisi.";
  if (name.length > 120) return "Nama kategori maksimal 120 karakter.";
  if (description.length > 500) return "Keterangan maksimal 500 karakter.";
  return { name, description: description || null };
}

export async function createPurchaseCategory(input: CategoryInput): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(CATEGORY_ROLES);
    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };

    if (!actor.tenantId) return { ok: false, error: "Tenant aktif tidak ditemukan." };
    const admin = createAdminClient();
    const { error } = await admin.rpc("create_purchase_category_with_audit", {
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
      p_name: values.name,
      p_description: values.description,
    });

    if (error?.code === "23505") return { ok: false, error: "Nama kategori tersebut sudah digunakan." };
    if (error) return { ok: false, error: "Kategori gagal disimpan. Silakan coba lagi." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau penyimpanan kategori gagal. Silakan muat ulang halaman." };
  }
}

export async function updatePurchaseCategory(
  categoryId: string,
  input: CategoryInput,
): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(CATEGORY_ROLES);
    if (typeof categoryId !== "string" || !/^[0-9a-f-]{36}$/i.test(categoryId)) {
      return { ok: false, error: "Data kategori tidak valid." };
    }
    if (typeof input?.isActive !== "boolean") return { ok: false, error: "Status kategori tidak valid." };

    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };

    const admin = createAdminClient();
    const { error } = await admin.rpc("update_purchase_category_with_audit", {
      p_category_id: categoryId,
      p_actor_user_id: actor.userId,
      p_name: values.name,
      p_description: values.description,
      p_is_active: input.isActive,
    });

    if (error?.code === "23505") return { ok: false, error: "Nama kategori tersebut sudah digunakan." };
    if (error) return { ok: false, error: "Perubahan kategori gagal disimpan. Silakan coba lagi." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau perubahan kategori gagal. Silakan muat ulang halaman." };
  }
}
