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

  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
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

  // Supabase Auth email is globally unique. Reuse an existing Auth identity
  // for another tenant instead of trying to create a duplicate login account.
  let existingUser: { id: string; email?: string } | null = null;
  let page = 1;
  while (!existingUser) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) redirect("/platform?adminError=lookup");
    existingUser = data.users.find((user) => (user.email ?? "").toLowerCase() === email) ?? null;
    if (existingUser || data.users.length < 1000) break;
    page += 1;
  }

  if (!existingUser && password.length < 8) {
    redirect("/platform?adminError=password");
  }

  const { data: created, error: createError } = existingUser
    ? { data: { user: existingUser }, error: null }
    : await admin.auth.admin.createUser({ email, password, email_confirm: true });

  if (createError || !created.user) {
    redirect("/platform?adminError=create");
  }

  const userId = created.user.id;
  const createdNewAuthUser = !existingUser;

  const { error: membershipError } = await admin.from("tenant_memberships").insert({
    tenant_id: tenantId, user_id: userId, tenant_role: "superadmin",
    is_active: true, created_by: owner.userId,
  });
  if (membershipError) {
    if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
    redirect("/platform?adminError=membership");
  }

  const { error: profileError } = await admin.from("tenant_user_access_profiles").insert({
    tenant_id: tenantId, user_id: userId, roles: [], is_active: true,
    created_by: owner.userId, updated_by: owner.userId,
  });
  if (profileError) {
    await admin.from("tenant_memberships").delete().eq("tenant_id", tenantId).eq("user_id", userId);
    if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
    redirect("/platform?adminError=profile");
  }

  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    actor_user_id: owner.userId,
    tenant_id: tenantId,
    action: "tenant.admin_invited",
    details: {
      email,
      tenant_name: tenant.name,
      auth_user_reused: !createdNewAuthUser,
    },
  });

  if (auditError) {
    await admin.from("tenant_user_access_profiles").delete().eq("tenant_id", tenantId).eq("user_id", userId);
    await admin.from("tenant_memberships").delete().eq("tenant_id", tenantId).eq("user_id", userId);
    if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
    redirect("/platform?adminError=audit");
  }

  revalidatePath("/platform");
  redirect(createdNewAuthUser
    ? "/platform?adminCreated=1"
    : "/platform?adminCreated=1&accountReused=1");
}
