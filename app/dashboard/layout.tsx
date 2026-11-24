import { redirect } from "next/navigation";
import { guardPage, requireActiveUser } from "@/lib/auth/authorization";
import DashboardShell from "./dashboard-shell";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await guardPage(requireActiveUser);

  // Platform Owner has a separate console and is not a tenant Superadmin.
  if (context.isOwner) redirect("/platform");
  if (!context.tenantId) redirect("/akses-ditolak?reason=inactive");

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("tenant_memberships")
    .select("tenant_id, tenants!inner(id, name, status)")
    .eq("user_id", context.userId)
    .eq("is_active", true)
    .eq("tenants.status", "active");

  const tenantIds = (memberships ?? []).map((item) => item.tenant_id);
  const { data: activeProfiles } = tenantIds.length
    ? await admin
        .from("tenant_user_access_profiles")
        .select("tenant_id")
        .eq("user_id", context.userId)
        .in("tenant_id", tenantIds)
        .eq("is_active", true)
    : { data: [] as { tenant_id: string }[] };
  const validTenantIds = new Set((activeProfiles ?? []).map((item) => item.tenant_id));
  const availableTenants = (memberships ?? [])
    .filter((item) => validTenantIds.has(item.tenant_id))
    .map((item) => {
      const tenant = Array.isArray(item.tenants) ? item.tenants[0] : item.tenants;
      return tenant ? { id: item.tenant_id, name: tenant.name } : null;
    })
    .filter((item): item is { id: string; name: string } => Boolean(item));

  return (
    <DashboardShell
      email={context.email}
      roles={context.displayRoles}
      isSuperadmin={context.tenantRole === "superadmin"}
      activeTenantId={context.tenantId}
      availableTenants={availableTenants}
    >
      {children}
    </DashboardShell>
  );
}
