"use server";

import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

const SUPPLIER_ROLES = ["Procurement", "Finance", "Management"] as const;

type SupplierInput = {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive?: boolean;
};

type CleanSupplier = {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

type ActionResult = { ok: true } | { ok: false; error: string };

function cleanInput(input: SupplierInput): CleanSupplier | string {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const contactPerson = typeof input?.contactPerson === "string" ? input.contactPerson.trim() : "";
  const phone = typeof input?.phone === "string" ? input.phone.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const address = typeof input?.address === "string" ? input.address.trim() : "";
  const notes = typeof input?.notes === "string" ? input.notes.trim() : "";

  if (!name) return "Nama supplier wajib diisi.";
  if (name.length > 160) return "Nama supplier maksimal 160 karakter.";
  if (contactPerson.length > 120) return "Nama kontak maksimal 120 karakter.";
  if (phone.length > 40) return "Nomor telepon maksimal 40 karakter.";
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    return "Alamat email supplier tidak valid.";
  }
  if (address.length > 500) return "Alamat maksimal 500 karakter.";
  if (notes.length > 1000) return "Catatan maksimal 1.000 karakter.";

  return {
    name,
    contactPerson: contactPerson || null,
    phone: phone || null,
    email: email || null,
    address: address || null,
    notes: notes || null,
  };
}

export async function createSupplier(input: SupplierInput): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(SUPPLIER_ROLES);
    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };

    if (!actor.tenantId) return { ok: false, error: "Tenant aktif tidak ditemukan." };
    const admin = createAdminClient();
    const { error } = await admin.rpc("create_supplier_with_audit", {
      p_actor_user_id: actor.userId,
      p_tenant_id: actor.tenantId,
      p_name: values.name,
      p_contact_person: values.contactPerson,
      p_phone: values.phone,
      p_email: values.email,
      p_address: values.address,
      p_notes: values.notes,
    });

    if (error) {
      return { ok: false, error: "Supplier gagal disimpan. Silakan periksa data dan coba lagi." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau penyimpanan supplier gagal. Silakan muat ulang halaman." };
  }
}

export async function updateSupplier(
  supplierId: string,
  input: SupplierInput,
): Promise<ActionResult> {
  try {
    const actor = await requireAnyRole(SUPPLIER_ROLES);
    if (typeof supplierId !== "string" || !/^[0-9a-f-]{36}$/i.test(supplierId)) {
      return { ok: false, error: "Data supplier tidak valid." };
    }
    if (typeof input?.isActive !== "boolean") {
      return { ok: false, error: "Status supplier tidak valid." };
    }

    const values = cleanInput(input);
    if (typeof values === "string") return { ok: false, error: values };

    if (!actor.tenantId) return { ok: false, error: "Tenant aktif tidak ditemukan." };
    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin.from("suppliers").select("id").eq("tenant_id", actor.tenantId).eq("id", supplierId).maybeSingle();
    if (lookupError || !existing) return { ok: false, error: "Supplier tidak ditemukan pada perusahaan aktif." };
    const { error } = await admin.rpc("update_supplier_with_audit", {
      p_supplier_id: supplierId,
      p_actor_user_id: actor.userId,
      p_name: values.name,
      p_contact_person: values.contactPerson,
      p_phone: values.phone,
      p_email: values.email,
      p_address: values.address,
      p_notes: values.notes,
      p_is_active: input.isActive,
    });

    if (error) {
      return { ok: false, error: "Perubahan supplier gagal disimpan. Silakan periksa data dan coba lagi." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Akses atau perubahan supplier gagal. Silakan muat ulang halaman." };
  }
}
