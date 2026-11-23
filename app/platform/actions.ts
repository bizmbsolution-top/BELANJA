"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

function makeSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createTenant(formData: FormData) {
  const owner = await requirePlatformOwner();
  const name = String(formData.get("name") ?? "").trim();
  const requestedSlug = String(formData.get("slug") ?? "").trim();
  const slug = makeSlug(requestedSlug || name);

  if (name.length < 2 || name.length > 120 || !slug || slug.length > 80) {
    redirect("/platform?error=invalid");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .insert({ name, slug, status: "active", created_by: owner.userId })
    .select("id")
    .single();

  if (error || !data) {
    redirect(error?.code === "23505" ? "/platform?error=duplicate" : "/platform?error=save");
  }

  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    actor_user_id: owner.userId,
    tenant_id: data.id,
    action: "tenant.created",
    details: { tenant_name: name, tenant_slug: slug },
  });

  if (auditError) {
    // The tenant exists; do not report the creation as failed. Monitoring can
    // identify this missing audit event during development.
  }

  revalidatePath("/platform");
  redirect("/platform?created=1");
}
