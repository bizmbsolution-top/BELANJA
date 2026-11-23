import { redirect } from "next/navigation";
import { guardPage, requireActiveUser } from "@/lib/auth/authorization";
import DashboardShell from "./dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await guardPage(requireActiveUser);

  // Platform Owner has a separate console and is not a tenant Superadmin.
  if (context.isOwner) redirect("/platform");

  return (
    <DashboardShell
      email={context.email}
      roles={context.displayRoles}
      isOwner={false}
    >
      {children}
    </DashboardShell>
  );
}
