import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  evaluateOwnerAccess,
  evaluateRouteAccess,
  normalizeOperationalRoles,
  ROLE_SUPERADMIN,
  type DenialReason,
  type OperationalRole,
} from "./access-policy";

/** Thrown when a caller does not satisfy the required access rule. */
export class AuthorizationError extends Error {
  readonly reason: DenialReason;

  constructor(reason: DenialReason, message?: string) {
    super(message ?? defaultMessage(reason));
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

function defaultMessage(reason: DenialReason): string {
  switch (reason) {
    case "unauthenticated":
      return "Anda belum masuk.";
    case "inactive":
      return "Akun Anda belum aktif.";
    case "no-role":
      return "Akun Anda belum memiliki Role.";
    case "not-owner":
      return "Akses hanya untuk Owner.";
    case "role-not-permitted":
      return "Role Anda tidak memiliki akses ke halaman ini.";
    case "invalid-role":
      return "Data Role tidak valid.";
    default:
      return "Akses ditolak.";
  }
}

/** The authenticated, authorized caller. */
export type AccessContext = {
  userId: string;
  email: string;
  /** True when the caller matches BELANJA_OWNER_EMAIL on the server. */
  isOwner: boolean;
  /** All assigned tenant roles from `tenant_user_access_profiles`; never from the browser. */
  roles: OperationalRole[];
  /** Synthetic display role for the Owner; never a stored value. */
  displayRoles: string[];
  /** Active tenant resolved from server-side membership; null for Platform Owner. */
  tenantId: string | null;
  tenantRole: "superadmin" | "member" | null;
  activeRole: OperationalRole | null;
  availableRoles: OperationalRole[];
};

type ProfileRow = { is_active: boolean; roles: unknown };

/**
 * Loads the stored access profile.
 *
 * Returns a discriminated result so callers can apply their own fail-closed
 * policy and, for the Owner path, distinguish "no profile row" from
 * "lookup failed".
 */
type ProfileLookup =
  | { status: "found"; profile: ProfileRow }
  | { status: "absent" }
  | { status: "error" };

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

/**
 * Verifies the application-level active status of an authenticated Owner.
 *
 * Shares the single rule in access-policy.ts with the middleware, so the two
 * cannot diverge. One profile lookup per call; callers must not repeat it.
 *
 * Owner decision B (2026-11-20): the Owner MUST have an active profile row.
 * Every failure mode denies:
 *
 *   lookup error            -> deny
 *   no profile row          -> deny  (Owner is unverified)
 *   profile found, inactive -> deny
 *   profile found, active   -> allow
 */
async function loadTenantProfile(userId: string, tenantId: string): Promise<ProfileLookup> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: "error" };
  }

  try {
    const { data, error } = await admin
      .from("tenant_user_access_profiles")
      .select("is_active, roles")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
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

async function verifyOwnerActive(userId: string): Promise<void> {
  const lookup = await loadProfile(userId);

  const decision = evaluateOwnerAccess(
    lookup.status === "found"
      ? { status: "found", is_active: lookup.profile.is_active }
      : { status: lookup.status },
  );

  if (decision.allowed) return;

  if (lookup.status === "error") {
    throw new AuthorizationError(
      "inactive",
      "Status akun Owner tidak dapat diverifikasi.",
    );
  }

  if (lookup.status === "absent") {
    throw new AuthorizationError(
      "inactive",
      "Profil Owner tidak ditemukan. Hubungi Superadmin untuk menyiapkan profil akses.",
    );
  }

  throw new AuthorizationError("inactive", "Akun Owner tidak aktif.");
}

/**
 * Verifies identity with Supabase Auth and resolves the caller profile.
 *
 * Owner handling (owner decision B, 2026-11-20):
 *   1. Identity is verified by Supabase Auth — a valid session, not banned.
 *   2. The email must match BELANJA_OWNER_EMAIL on the server.
 *   3. The Owner MUST have a row in `user_access_profiles`.
 *   4. That row MUST have `is_active = true`.
 *
 * Every other outcome denies: no profile row, an inactive profile, or a failed
 * lookup. The email match alone never grants access. The previous behaviour of
 * allowing an Owner without a profile row has been withdrawn; there is no
 * inferred or synthetic active status.
 *
 * The same rule is applied by the middleware through the shared
 * `evaluateOwnerAccess` function, so the two paths cannot diverge.
 */
export async function getAccessContext(): Promise<AccessContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    throw new AuthorizationError("unauthenticated");
  }

  const admin = createAdminClient();
  const { data: ownerRow, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (ownerError) {
    throw new AuthorizationError("inactive", "Status Platform Owner tidak dapat diverifikasi.");
  }

  if (ownerRow) {
    await verifyOwnerActive(user.id);
    return {
      userId: user.id,
      email: user.email,
      isOwner: true,
      roles: [],
      displayRoles: ["Platform Owner"],
      tenantId: null,
      tenantRole: null,
      activeRole: null,
      availableRoles: [],
    };
  }

  const cookieStore = await cookies();
  const activeTenantId = cookieStore.get("belanja_active_tenant")?.value;
  if (!activeTenantId) {
    throw new AuthorizationError("inactive", "Pilih perusahaan untuk melanjutkan.");
  }

  const membershipResult = await admin
    .from("tenant_memberships")
    .select("tenant_id, tenant_role, is_active, tenants!inner(status)")
    .eq("user_id", user.id)
    .eq("tenant_id", activeTenantId)
    .eq("is_active", true)
    .eq("tenants.status", "active")
    .maybeSingle();

  if (membershipResult.error || !membershipResult.data) {
    throw new AuthorizationError("inactive", "Anda tidak memiliki akses aktif ke perusahaan yang dipilih.");
  }

  const lookup = await loadTenantProfile(user.id, activeTenantId);
  if (lookup.status === "error") {
    throw new AuthorizationError("inactive", "Data akses pengguna tidak dapat dimuat.");
  }

  if (lookup.status !== "found" || !lookup.profile.is_active) {
    throw new AuthorizationError("inactive", "Akun pengguna belum aktif.");
  }

  const tenantRole = membershipResult.data.tenant_role === "superadmin" ? "superadmin" : "member";
  const allRoles = normalizeOperationalRoles(lookup.profile.roles);
  const requestedRole = cookieStore.get("belanja_active_role")?.value;
  const activeRole = allRoles.find((role) => role === requestedRole) ?? allRoles[0] ?? null;
  return {
    userId: user.id,
    email: user.email,
    isOwner: false,
    // Role switching changes the selected work mode, not the user's authorization.
    // Keep every assigned role for direct-route and server-action checks.
    roles: allRoles,
    displayRoles: tenantRole === "superadmin" ? ["Superadmin"] : activeRole ? [activeRole] : [],
    tenantId: membershipResult.data.tenant_id,
    tenantRole,
    activeRole,
    availableRoles: allRoles,
  };
}

/**
 * Requires an authenticated caller. Does not require an active profile, so it
 * is suitable for pages that render a "pending activation" state.
 */
export async function requireAuthenticatedUser(): Promise<AccessContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    throw new AuthorizationError("unauthenticated");
  }

  const admin = createAdminClient();
  const { data: ownerRow, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (ownerError) {
    throw new AuthorizationError("inactive", "Status akses tidak dapat diverifikasi.");
  }

  return {
    userId: user.id,
    email: user.email,
    isOwner: Boolean(ownerRow),
    roles: [],
    displayRoles: ownerRow ? ["Platform Owner"] : [],
    tenantId: null,
    tenantRole: null,
    activeRole: null,
    availableRoles: [],
  };
}

/**
 * Requires an authenticated user whose account is active and who holds at
 * least one approved operational role, or who is the Owner.
 */
export async function requireActiveUser(): Promise<AccessContext> {
  return getAccessContext();
}

/**
 * Requires the caller to hold at least one of the given operational roles.
 * The Owner always passes, because Owner authority is verified server-side.
 */
export async function requireAnyRole(roles: readonly string[]): Promise<AccessContext> {
  const context = await getAccessContext();

  // Platform Owner is not an operational tenant user.
  if (context.isOwner) {
    throw new AuthorizationError("not-owner", "Platform Owner tidak memiliki akses ke transaksi tenant.");
  }

  if (context.tenantRole === "superadmin") return context;

  const decision = evaluateRouteAccess({
    isOwner: false,
    profile: { is_active: true, roles: context.roles },
    requireAnyRole: roles,
  });

  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }


  return context;
}

/**
 * Requires a user explicitly registered in the platform_owners table.
 * This is the platform-level authority and is independent from tenant roles.
 */
export async function requirePlatformOwner(): Promise<AccessContext> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    throw new AuthorizationError("unauthenticated");
  }

  const admin = createAdminClient();
  const { data, error: ownerError } = await admin
    .from("platform_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (ownerError) {
    throw new AuthorizationError("inactive", "Status Platform Owner tidak dapat diverifikasi.");
  }
  if (!data) {
    throw new AuthorizationError("not-owner");
  }

  // Keep the Platform Owner console consistent with getAccessContext() and
  // middleware: a registered Owner must also have an active access profile.
  await verifyOwnerActive(user.id);

  return {
    userId: user.id,
    email: user.email,
    isOwner: true,
    roles: [],
    displayRoles: ["Platform Owner"],
    tenantId: null,
    tenantRole: null,
    activeRole: null,
    availableRoles: [],
  };
}

/**
 * Requires the caller to be the Owner.
 *
 * Two independent checks, in this order:
 *   1. Identity  - Supabase Auth session must be valid, and the email must
 *      match BELANJA_OWNER_EMAIL on the server. Non-owners fail here with
 *      ``not-owner``.
 *   2. Status    - the Owner MUST have an active row in user_access_profiles,
 *      verified through the shared ``evaluateOwnerAccess`` rule exactly as the
 *      middleware does. A missing row, an inactive row, or a failed lookup all
 *      deny.
 *
 * The identity check runs first so that a non-owner receives the precise
 * ``not-owner`` reason rather than a status error. Exactly one profile lookup
 * is performed, and only for callers who are actually the Owner, so there is
 * no duplicated work.
 *
 * Owner decision B (2026-11-20): the previous behaviour of allowing an Owner
 * with no profile row has been withdrawn. The email match alone never grants
 * access.
 */
export async function requireOwner(): Promise<AccessContext> {
  const context = await getAccessContext();

  if (context.isOwner) {
    throw new AuthorizationError("not-owner", "Platform Owner tidak memiliki akses administrasi internal tenant.");
  }
  if (context.tenantRole !== "superadmin") {
    throw new AuthorizationError("not-owner", "Menu ini hanya tersedia untuk Superadmin perusahaan.");
  }

  return context;
}

/**
 * Convenience wrapper for Server Components: runs an access rule and redirects
 * to a denial destination on failure, instead of surfacing an exception.
 *
 * `redirect` throws, so this helper never returns on the failure path.
 */
export async function guardPage(
  check: () => Promise<AccessContext>,
  options?: { deniedPath?: string },
): Promise<AccessContext> {
  try {
    return await check();
  } catch (error) {
    const reason: DenialReason =
      error instanceof AuthorizationError ? error.reason : "inactive";

    if (reason === "unauthenticated") {
      redirect("/login");
    }

    redirect(`${options?.deniedPath ?? "/akses-ditolak"}?reason=${reason}`);
  }
}

/** Re-exported so callers can narrow roles without importing the policy module. */
export { normalizeOperationalRoles, ROLE_SUPERADMIN };
export type { OperationalRole, DenialReason };
