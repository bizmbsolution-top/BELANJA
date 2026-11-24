import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePublicKey, resolveSupabaseUrl } from "@/lib/supabase/env";
import {
  evaluateOwnerAccess,
  evaluateRouteAccess,
  isOwnerEmail,
  type DenialReason,
} from "@/lib/auth/access-policy";
const DASHBOARD_PREFIX = "/dashboard";

type ProfileRow = { is_active: boolean; roles: unknown };

/**
 * Loads the stored access profile for a user.
 *
 * Returns a discriminated result rather than throwing, so that callers can
 * apply their own fail-closed policy. In particular the Owner path must be
 * able to distinguish "no profile row" from "lookup failed".
 */
type ProfileLookup =
  | { status: "found"; profile: ProfileRow }
  | { status: "absent" }
  | { status: "error" };

async function hasActiveTenantSuperadminMembership(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data: membership, error: membershipError } = await admin
      .from("tenant_memberships")
      .select("tenant_id, tenant_role")
      .eq("user_id", userId)
      .eq("tenant_role", "superadmin")
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError || !membership) return false;

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("status")
      .eq("id", membership.tenant_id)
      .maybeSingle();

    return !tenantError && tenant?.status === "active";
  } catch {
    return false;
  }
}

async function loadTenantProfile(userId: string, tenantId: string): Promise<ProfileLookup> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenant_user_access_profiles")
      .select("is_active, roles")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return { status: "error" };
    if (!data) return { status: "absent" };
    return { status: "found", profile: { is_active: data.is_active === true, roles: data.roles } };
  } catch {
    return { status: "error" };
  }
}

async function loadProfile(userId: string): Promise<ProfileLookup> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: "error" };
  }

  try {
    const { data, error } = await admin
      .from("user_access_profiles")
      .select("is_active, roles")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return { status: "error" };
    if (!data) return { status: "absent" };

    return {
      status: "found",
      profile: { is_active: data.is_active === true, roles: data.roles },
    };
  } catch {
    return { status: "error" };
  }
}

function redirectTo(request: NextRequest, path: string, reason?: DenialReason) {
  const target = request.nextUrl.clone();
  target.pathname = path;
  target.search = "";
  if (reason) target.searchParams.set("reason", reason);
  return NextResponse.redirect(target);
}

export async function updateSession(request: NextRequest) {
  const url = resolveSupabaseUrl();
  const publicKey = resolvePublicKey();
  const pathname = request.nextUrl.pathname;
  const isDashboard = pathname.startsWith(DASHBOARD_PREFIX);

  // Fail closed for dashboard routes: without a configured client no
  // authorization decision can be made, so access must not be granted.
  if (!url || !publicKey) {
    return isDashboard ? redirectTo(request, "/login") : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publicKey.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isDashboard && !user) {
    return redirectTo(request, "/login");
  }

  if (isDashboard && user) {
    const isOwner = isOwnerEmail(user.email);

    if (isOwner) {
      // Owner authority requires a verified active profile (owner decision B).
      // Identity comes from BELANJA_OWNER_EMAIL; the active flag is evaluated by
      // the same shared rule the server helpers use, so the two cannot drift apart.
      const lookup = await loadProfile(user.id);

      const decision = evaluateOwnerAccess(
        lookup.status === "found"
          ? { status: "found", is_active: lookup.profile.is_active }
          : { status: lookup.status },
      );

      if (!decision.allowed) {
        // Covers a failed lookup, a missing profile, and a deactivated Owner.
        return redirectTo(request, "/akses-ditolak", "inactive");
      }
    } else {
      const tenantId = request.cookies.get("belanja_active_tenant")?.value;
      if (!tenantId) return redirectTo(request, "/login", "inactive");

      const admin = createAdminClient();
      const { data: membership, error: membershipError } = await admin
        .from("tenant_memberships")
        .select("tenant_role, tenants!inner(status)")
        .eq("user_id", user.id)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .eq("tenants.status", "active")
        .maybeSingle();

      if (membershipError || !membership) {
        return redirectTo(request, "/login", "inactive");
      }

      const lookup = await loadTenantProfile(user.id, tenantId);
      if (lookup.status !== "found" || !lookup.profile.is_active) {
        return redirectTo(request, "/akses-ditolak", "inactive");
      }

      // Superadmin is tenant-scoped by the selected membership. Other users
      // must also hold an operational role in that same tenant profile.
      if (membership.tenant_role !== "superadmin") {
        const decision = evaluateRouteAccess({
          isOwner: false,
          profile: lookup.profile,
          requireActiveRole: true,
        });
        if (!decision.allowed) {
          return redirectTo(request, "/akses-ditolak", decision.reason);
        }
      }
    }
  }

  if (pathname === "/login" && user) {
    if (isOwnerEmail(user.email)) return redirectTo(request, "/platform");
    if (request.cookies.get("belanja_active_tenant")?.value) {
      return redirectTo(request, "/dashboard");
    }
  }

  return response;
}
