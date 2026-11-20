import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { describeMissingSupabaseConfig, resolveSecretKey, resolveSupabaseUrl } from "./env";

/**
 * Server-only privileged client. Bypasses Row Level Security.
 *
 * Never import this from a Client Component, never pass the returned client to
 * one, and never log the key.
 */
export function createAdminClient() {
  const url = resolveSupabaseUrl();
  const secret = resolveSecretKey();

  if (!url || !secret) {
    const missing = describeMissingSupabaseConfig();
    throw new Error(
      `Supabase admin client is not configured. Missing: ${missing.join(", ")}.`,
    );
  }

  return createSupabaseClient(url, secret.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}