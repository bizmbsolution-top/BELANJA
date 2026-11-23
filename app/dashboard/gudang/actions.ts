"use server";

import { requireAnyRole, requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const WAREHOUSE_ROLES = ["Procurement", "Warehouse", "Finance", "Management"] as const;
type WarehouseInput = { name: string; location: string; description: string; isActive?: boolean };
type CleanWarehouse = { name: string; location: string | null; description: string | null };
type ActionResult = { ok: true } | { ok: false; error: string };

function cleanInput(input: WarehouseInput): CleanWarehouse | string {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const location = typeof input?.location === "string" ? input.location.trim() : "";
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  if (!name) return "Nama gudang wajib diisi.";
  if (name.length > 160) return "Nama gudang maksimal 160 karakter.";
  if (location.length > 200) return "Lokasi maksimal 200 karakter.";
  if (description.length > 500) return "Keterangan maksimal 500 karakter.";
  return { name, location: location || null, description: description || null };
}

export async function createWarehouse(input: WarehouseInput): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(WAREHOUSE_ROLES);
    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };
    const admin = createAdminClient();
    const { error } = await admin.rpc("create_warehouse_with_audit", {
      p_actor_user_id: actor.userId, p_name: values.name,
      p_location: values.location, p_description: values.description,
    });
    if (error?.code === "23505") return { ok: false, error: "Nama gudang tersebut sudah digunakan." };
    if (error) return { ok: false, error: "Gudang gagal disimpan. Silakan coba lagi." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau penyimpanan gudang gagal. Silakan muat ulang halaman." };
  }
}

export async function updateWarehouse(id: string, input: WarehouseInput): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(WAREHOUSE_ROLES);
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Data gudang tidak valid." };
    if (typeof input?.isActive !== "boolean") return { ok: false, error: "Status gudang tidak valid." };
    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };
    const admin = createAdminClient();
    const { error } = await admin.rpc("update_warehouse_with_audit", {
      p_warehouse_id: id, p_actor_user_id: actor.userId, p_name: values.name,
      p_location: values.location, p_description: values.description, p_is_active: input.isActive,
    });
    if (error?.code === "23505") return { ok: false, error: "Nama gudang tersebut sudah digunakan." };
    if (error) return { ok: false, error: "Perubahan gudang gagal disimpan. Silakan coba lagi." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau perubahan gudang gagal. Silakan muat ulang halaman." };
  }
}


export async function setWarehouseProjects(input: { warehouseId: string; projectIds: string[] }): Promise<ActionResult> {
  try {
    const owner = await requireOwner();
    if (!/^[0-9a-f-]{36}$/i.test(input?.warehouseId ?? "")) return { ok: false, error: "Gudang tidak valid." };
    const projectIds = Array.isArray(input.projectIds) ? [...new Set(input.projectIds)] : [];
    if (!projectIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))) return { ok: false, error: "Project tidak valid." };
    const { error } = await createAdminClient().rpc("set_warehouse_projects_with_audit", {
      p_actor_user_id: owner.userId,
      p_warehouse_id: input.warehouseId,
      p_project_ids: projectIds,
    });
    if (error) return { ok: false, error: "Hubungan Project dan Warehouse gagal disimpan." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Hanya Superadmin yang dapat mengatur Project untuk gudang." };
  }
}
