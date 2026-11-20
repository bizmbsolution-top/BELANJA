"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) redirect("/login");

  const ownerEmail = process.env.BELANJA_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail && user.email?.toLowerCase() === ownerEmail) {
    return <>{children}</>;
  }

  try {
    const admin = createAdminClient();
    const { data: profile, error } = await admin
      .from("user_access_profiles")
      .select("roles, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !profile || profile.is_active !== true || !Array.isArray(profile.roles) || profile.roles.length === 0) {
      redirect("/akses");
    }
  } catch {
    redirect("/akses");
  }

  return <>{children}</>;
}
