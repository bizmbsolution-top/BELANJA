import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return NextResponse.next({ request });
  }

  const supabase = createServerClient(url, publishableKey, {
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

  const { data: { user } } = await supabase.auth.getUser();
  const isDashboard = request.nextUrl.pathname.startsWith("/dashboard");

  if (isDashboard && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isDashboard && user) {
    const ownerEmail = process.env.BELANJA_OWNER_EMAIL?.trim().toLowerCase();
    const isOwner = Boolean(ownerEmail && user.email?.toLowerCase() === ownerEmail);

    if (!isOwner) {
      const admin = createAdminClient();
      const { data: profile, error } = await admin
        .from("user_access_profiles")
        .select("roles, is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/akses-ditolak";
      redirectUrl.search = "";

      if (error || !profile || !profile.is_active) {
        redirectUrl.searchParams.set("reason", "inactive");
        return NextResponse.redirect(redirectUrl);
      }

      if (!Array.isArray(profile.roles) || profile.roles.length === 0) {
        redirectUrl.searchParams.set("reason", "no-role");
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  if (request.nextUrl.pathname === "/login" && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
