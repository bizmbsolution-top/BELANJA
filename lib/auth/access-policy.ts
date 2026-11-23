/**
 * Pure access-policy functions.
 *
 * This module must stay free of Next.js and Supabase imports so that it can be
 * shared by the Edge middleware (which builds its own cookie-bound client) and
 * by the Node server helpers in `lib/auth/authorization.ts`.
 *
 * Keeping the policy here — rather than duplicating predicates in middleware,
 * layout and pages — is what prevents the access rules from drifting apart.
 */

/** Roles that may be assigned through the user-administration screen. */
export const APPROVED_OPERATIONAL_ROLES = [
  "Cashier",
  "Finance",
  "Warehouse",
  "Management",
] as const;

export type OperationalRole = (typeof APPROVED_OPERATIONAL_ROLES)[number];

/**
 * Synthetic role used for display only. It is never stored in
 * `user_access_profiles` and must never be accepted by the role validator.
 */
export const ROLE_SUPERADMIN = "Superadmin";

/** Stable machine-readable denial reasons, safe to surface via query string. */
export type DenialReason =
  | "unauthenticated"
  | "inactive"
  | "no-role"
  | "not-owner"
  | "role-not-permitted"
  | "invalid-role";

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: DenialReason };

const ALLOW: AccessDecision = { allowed: true };

function deny(reason: DenialReason): AccessDecision {
  return { allowed: false, reason };
}

/**
 * Owner identity is derived exclusively from the server-side environment
 * variable. The email comparison is case-insensitive and trims surrounding
 * whitespace on the configured value.
 */
export function resolveOwnerEmail(): string | null {
  const raw = process.env.BELANJA_OWNER_EMAIL;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = resolveOwnerEmail();
  if (!owner) return false;
  if (typeof email !== "string") return false;
  return email.trim().toLowerCase() === owner;
}

/**
 * Accepts only an array of non-empty strings drawn from the approved
 * operational role list. Anything else — non-arrays, unknown role names,
 * duplicates, or the synthetic Superadmin label — is rejected.
 *
 * Rejecting unknown names matters: a row containing an unrecognised role must
 * not be able to widen access.
 */
export function normalizeOperationalRoles(value: unknown): OperationalRole[] {
  if (!Array.isArray(value)) return [];

  const accepted = new Set<OperationalRole>();

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (ROLE_SUPERADMIN === entry) continue;
    if (!APPROVED_OPERATIONAL_ROLES.includes(entry as OperationalRole)) continue;
    accepted.add(entry as OperationalRole);
  }

  return [...accepted];
}

/**
 * Evaluates an authenticated non-owner user against the stored profile.
 * Fails closed: a missing, malformed, or inactive profile denies access.
 */
export function evaluateProfileAccess(profile: {
  is_active: boolean;
  roles: unknown;
}): AccessDecision {
  if (!profile || profile.is_active !== true) return deny("inactive");

  const roles = normalizeOperationalRoles(profile.roles);
  if (roles.length === 0) return deny("no-role");

  return ALLOW;
}

export type RouteAccessInput = {
  isOwner: boolean;
  /** Raw profile; ignored when isOwner is true. */
  profile?: { is_active: boolean; roles: unknown } | null;
  /** When set, the user must hold at least one of these roles. */
  requireAnyRole?: readonly string[];
  /** When true, only the Owner may proceed. */
  requireOwner?: boolean;
  /** When true, reject users with no operational role (default true). */
  requireActiveRole?: boolean;
};

/**
 * Single decision point shared by middleware and server helpers.
 *
 * Evaluation order is deliberate:
 *   1. Owner gate, if the route requires it.
 *   2. Inactive check.
 *   3. Role presence check, unless explicitly waived.
 *   4. Required-role intersection, if any.
 *
 * The Owner bypasses the profile checks only because the Owner identity is
 * itself verified server-side from the environment; it is not a role assignment.
 */
export function evaluateRouteAccess(input: RouteAccessInput): AccessDecision {
  if (input.requireOwner && !input.isOwner) return deny("not-owner");

  if (input.isOwner) return ALLOW;

  const profile = input.profile ?? null;
  if (!profile || profile.is_active !== true) return deny("inactive");

  const roles = normalizeOperationalRoles(profile.roles);

  if (input.requireActiveRole !== false && roles.length === 0) {
    return deny("no-role");
  }

  if (input.requireAnyRole && input.requireAnyRole.length > 0) {
    const permitted = new Set(input.requireAnyRole);
    const matched = roles.some((role) => permitted.has(role));
    if (!matched) return deny("role-not-permitted");
  }

  return ALLOW;
}
/**
 * The outcome of a profile lookup, reduced to what the Owner rule needs.
 * `absent` means no row exists; `error` means the lookup itself failed.
 */
export type OwnerProfileLookup =
  | { status: "found"; is_active: boolean }
  | { status: "absent" }
  | { status: "error" };

/**
 * Evaluates the application-level active status of an authenticated Owner.
 *
 * This is the single rule shared by the middleware and by the server helpers so
 * that the two cannot drift apart. Owner status is a **required, verified
 * attribute**, never inferred from the email match:
 *
 *   email match required   (evaluated by the caller, before this function)
 *   error            -> deny  (a failed status check is not proof of activity)
 *   absent           -> deny  (no profile row: the Owner is unverified)
 *   found, inactive  -> deny  (a deactivated Owner must not enter by email)
 *   found, active    -> allow
 *
 * Owner decision B (2026-11-20): the Owner MUST have a row in
 * `user_access_profiles` and that row MUST be active. The previous behaviour,
 * which allowed an Owner with no profile row, has been withdrawn. There is no
 * inferred, default, or synthetic active status for the Owner.
 */
export function evaluateOwnerAccess(lookup: OwnerProfileLookup): AccessDecision {
  if (lookup.status === "error") return deny("inactive");

  if (lookup.status === "absent") return deny("inactive");

  if (lookup.status === "found" && lookup.is_active !== true) {
    return deny("inactive");
  }

  return ALLOW;
}

/**
 * Scope assignments are independent for each organizational dimension.
 * "all" includes current and future records in this Organization.
 * "selected" is an explicit allow-list; an empty or malformed list denies.
 */
export type ScopeAssignment =
  | { mode: "all" }
  | { mode: "selected"; ids: readonly string[] };

export type WorkScope = {
  project: ScopeAssignment;
  department: ScopeAssignment;
  warehouse: ScopeAssignment;
};

export type ScopeDimension = keyof WorkScope;

/**
 * Fail-closed scope check. Missing, malformed, or unknown assignments never
 * widen access. The caller must supply the resource ID from trusted server
 * data, not from a browser-provided authorization claim.
 */
export function evaluateScopeAccess(
  assignment: unknown,
  resourceId: unknown,
): boolean {
  if (!assignment || typeof assignment !== "object") return false;
  if (typeof resourceId !== "string" || resourceId.trim().length === 0) {
    return false;
  }

  const candidate = assignment as { mode?: unknown; ids?: unknown };

  if (candidate.mode === "all") return true;
  if (candidate.mode !== "selected" || !Array.isArray(candidate.ids)) {
    return false;
  }

  return candidate.ids.some(
    (id) => typeof id === "string" && id === resourceId,
  );
}

/**
 * Permission keys that must only ever be granted directly to an individual
 * user. A Role grant must never enable one of these sensitive actions.
 */
export const INDIVIDUAL_ONLY_PERMISSIONS = [
  "transaction.post_recognition",
  "fund_utilization.post_recognition",
  "payment.post",
  "payment.allocate",
] as const;

export type IndividualOnlyPermission =
  (typeof INDIVIDUAL_ONLY_PERMISSIONS)[number];

export type PermissionOverride = "allow" | "deny";

/**
 * Evaluates effective permission:
 * - explicit individual deny overrides every Role grant;
 * - explicit individual allow grants ordinary permissions;
 * - ordinary permissions otherwise use the union of Role grants;
 * - sensitive individual-only permissions require an explicit user allow.
 *
 * Missing or malformed assignment data fails closed.
 */
export function evaluatePermissionAccess(input: {
  permission: unknown;
  roleGrants: unknown;
  userOverride: unknown;
}): boolean {
  const { permission, roleGrants, userOverride } = input;

  if (typeof permission !== "string" || permission.trim().length === 0) {
    return false;
  }

  if (userOverride === "deny") return false;

  const individualOnly = (
    INDIVIDUAL_ONLY_PERMISSIONS as readonly string[]
  ).includes(permission);

  if (individualOnly) return userOverride === "allow";
  if (userOverride === "allow") return true;

  if (!Array.isArray(roleGrants)) return false;
  return roleGrants.some((grant) => grant === permission);
}

