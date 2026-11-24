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
  const tenantId = String(formData.get("tenantId") ?? "").trim();

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const supabase = await createClient();
  const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !authData.user) {
    redirect("/login?error=invalid");
  }

  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  const cookieStore = await cookies();
  if (owner) {
    cookieStore.delete("belanja_active_tenant");
    redirect("/platform");
  }

  if (!tenantId) {
    await supabase.auth.signOut();
    redirect("/login?error=tenant");
  }

  const { data: membership, error: membershipError } = await admin
    .from("tenant_memberships")
    .select("tenant_id, tenants!inner(status)")
    .eq("user_id", authData.user.id)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("tenants.status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    await supabase.auth.signOut();
    redirect("/login?error=invalid");
  }

  const { data: profile, error: profileError } = await admin
    .from("tenant_user_access_profiles")
    .select("is_active")
    .eq("tenant_id", tenantId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  cookieStore.set("belanja_active_tenant", tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("belanja_active_tenant");
  redirect("/login");
}