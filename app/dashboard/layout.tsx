import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import DashboardShell from "./dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) redirect("/login");

  const ownerEmail = process.env.BELANJA_OWNER_EMAIL?.trim().toLowerCase();
  const isOwner = Boolean(ownerEmail && user.email?.toLowerCase() === ownerEmail);
  let roles: string[] = [];

  if (!isOwner) {
    let hasAccess = false;
    try {
      const admin = createAdminClient();
      const { data: profile, error } = await admin
        .from("user_access_profiles")
        .select("roles, is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      hasAccess = !error
        && profile?.is_active === true
        && Array.isArray(profile.roles)
        && profile.roles.length > 0;

      if (hasAccess) roles = profile.roles;
    } catch {
      hasAccess = false;
    }

    if (!hasAccess) redirect("/akses");
  } else {
    roles = ["Superadmin"];
  }

  return (
    <DashboardShell email={user.email ?? ""} roles={roles} isOwner={isOwner}>
      {children}
    </DashboardShell>
  );
}
