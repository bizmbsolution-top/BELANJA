import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { describeMissingSupabaseConfig, resolvePublicKey, resolveSupabaseUrl } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const url = resolveSupabaseUrl();
  const publicKey = resolvePublicKey();

  if (!url || !publicKey) {
    const missing = describeMissingSupabaseConfig();
    throw new Error(
      `Supabase is not configured. Missing: ${missing.join(", ")}. ` +
        "Set the variables in .env.local and restart the development server.",
    );
  }

  return createServerClient(url, publicKey.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes sessions.
        }
      },
    },
  });
}