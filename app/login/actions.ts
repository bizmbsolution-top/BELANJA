"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Only same-origin dashboard paths are accepted as a post-login destination.
 * Anything else - an external URL, a protocol-relative URL, or a path outside
 * /dashboard - falls back to /dashboard. This prevents an open redirect.
 */
function safeNextPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/dashboard";
  const candidate = value.trim();
  if (!candidate.startsWith("/dashboard")) return "/dashboard";
  if (candidate.startsWith("//")) return "/dashboard";
  return candidate;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const supabase = await createClient();
  const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !authData.user) {
    redirect("/login?error=invalid");
  }

  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (ownerError) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const cookieStore = await cookies();
  if (owner) {
    cookieStore.delete("belanja_active_tenant");
    cookieStore.delete("belanja_active_role");
    redirect("/platform");
  }

  const { data: memberships, error: membershipsError } = await admin
    .from("tenant_memberships")
    .select("tenant_id, created_at, tenants!inner(status)")
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .eq("tenants.status", "active")
    .order("created_at", { ascending: true });

  if (membershipsError || !memberships?.length) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const tenantIds = memberships.map((item) => item.tenant_id);
  const { data: profiles, error: profilesError } = await admin
    .from("tenant_user_access_profiles")
    .select("tenant_id, is_active")
    .eq("user_id", authData.user.id)
    .in("tenant_id", tenantIds)
    .eq("is_active", true);

  if (profilesError || !profiles?.length) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const validTenantIds = new Set(profiles.map((profile) => profile.tenant_id));
  const defaultMembership = memberships.find((membership) => validTenantIds.has(membership.tenant_id));

  if (!defaultMembership) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const tenantId = defaultMembership.tenant_id;
  cookieStore.delete("belanja_active_role");
  cookieStore.set("belanja_active_tenant", tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(next);
}

export async function switchTenant(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) redirect("/dashboard");

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownerError) redirect("/akses-ditolak?reason=inactive");
  if (owner) redirect("/platform");

  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id, tenants!inner(status)")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("tenants.status", "active")
    .maybeSingle();

  if (membershipError || !membership) redirect("/akses-ditolak?reason=inactive");

  const { data: profile, error: profileError } = await admin
    .from("tenant_user_access_profiles")
    .select("is_active")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (profileError || profile?.is_active !== true) redirect("/akses-ditolak?reason=inactive");

  const cookieStore = await cookies();
  cookieStore.delete("belanja_active_role");
  cookieStore.set("belanja_active_tenant", tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}

export async function switchRole(formData: FormData) {
  const requestedRole = String(formData.get("role") ?? "").trim();
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const cookieStore = await cookies();
  const tenantId = cookieStore.get("belanja_active_tenant")?.value;
  if (!tenantId) redirect("/login");

  const admin = createAdminClient();
  const { data: owner, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownerError) redirect("/akses-ditolak?reason=inactive");
  if (owner) redirect("/platform");

  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id, tenants!inner(status)")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("tenants.status", "active")
    .maybeSingle();
  if (membershipError || !membership) redirect("/akses-ditolak?reason=inactive");

  const { data: profile, error: profileError } = await admin
    .from("tenant_user_access_profiles")
    .select("roles, is_active")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (profileError || profile?.is_active !== true || !Array.isArray(profile.roles) || !profile.roles.includes(requestedRole)) {
    redirect("/akses-ditolak?reason=role-not-permitted");
  }

  const allowed = ["Procurement", "Sales", "Cashier", "Finance", "Warehouse", "Management"];
  if (!allowed.includes(requestedRole)) redirect("/akses-ditolak?reason=invalid-role");

  cookieStore.set("belanja_active_role", requestedRole, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("belanja_active_tenant");
  cookieStore.delete("belanja_active_role");
  redirect("/login");
}