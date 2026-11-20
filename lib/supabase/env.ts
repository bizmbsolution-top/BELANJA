/**
 * Single resolution point for Supabase environment variables.
 *
 * Supabase ships two generations of key naming, and both are valid:
 *
 *   Public (safe for the browser)     Private (server only)
 *   --------------------------------  --------------------------------
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   SUPABASE_SECRET_KEY
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY          SUPABASE_SERVICE_ROLE_KEY
 *
 * `sb_publishable_…` and the legacy anon JWT are both public keys.
 * `sb_secret_…` and the legacy `service_role` JWT are both privileged keys.
 *
 * This module accepts either spelling so that an existing project using the
 * legacy names keeps working without editing `.env.local`.
 *
 * SECURITY: the private key must never be exposed to the browser. Only
 * `NEXT_PUBLIC_`-prefixed values are inlined into client bundles, so the
 * private resolvers below must only ever read non-public variable names.
 */

export type PublicKeySource =
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export type SecretKeySource =
  | "SUPABASE_SECRET_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";


function firstNonEmpty(
  values: ReadonlyArray<readonly [string, string | undefined]>,
): { value: string; source: string } | null {
  for (const [source, raw] of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return { value: trimmed, source };
  }
  return null;
}

/**
 * Resolves the project URL. Required for every client.
 * Returns null when unconfigured so callers can fail closed with a clear message.
 */
export function resolveSupabaseUrl(): string | null {
  const found = firstNonEmpty([
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
  ]);
  return found?.value ?? null;
}

/**
 * Resolves the public (browser-safe) key: publishable first, anon as fallback.
 * Both are safe to expose; neither grants privileged access.
 */
export function resolvePublicKey(): {
  key: string;
  keySource: PublicKeySource;
} | null {
  const found = firstNonEmpty([
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ]);

  if (!found) return null;

  return {
    key: found.value,
    keySource: found.source as PublicKeySource,
  };
}

/**
 * Resolves the privileged service key: secret first, service-role as fallback.
 *
 * This function must only be called from server-side code. The value it returns
 * bypasses Row Level Security and must never be passed to a Client Component,
 * embedded in a client bundle, or written to a log.
 */
export function resolveSecretKey(): {
  key: string;
  keySource: SecretKeySource;
} | null {
  const found = firstNonEmpty([
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY],
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]);

  if (!found) return null;

  return {
    key: found.value,
    keySource: found.source as SecretKeySource,
  };
}

/**
 * Describes which configuration is missing, by variable *name* only.
 * Never includes values.
 */
export function describeMissingSupabaseConfig(): string[] {
  const missing: string[] = [];

  if (!resolveSupabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL");

  if (!resolvePublicKey()) {
    missing.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }

  if (!resolveSecretKey()) {
    missing.push("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)");
  }

  return missing;
}