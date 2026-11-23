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

 
export async function createTenantSuperadmin(formData: FormData) {
  const owner = await requirePlatformOwner();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || password.length < 8) {
    redirect("/platform?adminError=invalid");
  }

  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin.from("tenants")
    .select("id,name,status").eq("id", tenantId).maybeSingle();
  if (tenantError || !tenant || tenant.status !== "active") {
    redirect("/platform?adminError=tenant");
  }

  const { data: existingAdmin, error: existingError } = await admin.from("tenant_memberships")
    .select("id").eq("tenant_id", tenantId).eq("tenant_role", "superadmin").eq("is_active", true).limit(1);
  if (existingError) redirect("/platform?adminError=check");
  if (existingAdmin?.length) redirect("/platform?adminError=exists");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createError || !created.user) {
    const message = createError?.message.toLowerCase() ?? "";
    redirect(message.includes("already") || message.includes("registered")
      ? "/platform?adminError=duplicate"
      : "/platform?adminError=create");
  }

  const { error: profileError } = await admin.from("user_access_profiles").insert({
    user_id: created.user.id, roles: [], is_active: true,
    created_by: owner.userId, updated_by: owner.userId,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    redirect("/platform?adminError=profile");
  }

  const { error: membershipError } = await admin.from("tenant_memberships").insert({
    tenant_id: tenantId, user_id: created.user.id, tenant_role: "superadmin",
    is_active: true, created_by: owner.userId,
  });
  if (membershipError) {
    await admin.from("user_access_profiles").delete().eq("user_id", created.user.id);
    await admin.auth.admin.deleteUser(created.user.id);
    redirect("/platform?adminError=membership");
  }

  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    actor_user_id: owner.userId, tenant_id: tenantId, action: "tenant.admin_invited",
    details: { email, tenant_name: tenant.name },
  });
  revalidatePath("/platform");
  redirect(auditError ? "/platform?adminCreated=1&auditWarning=1" : "/platform?adminCreated=1");
}
