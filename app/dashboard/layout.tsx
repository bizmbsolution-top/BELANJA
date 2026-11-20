import { guardPage, requireActiveUser } from "@/lib/auth/authorization";
import DashboardShell from "./dashboard-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const context = await guardPage(requireActiveUser);

  return (
    <DashboardShell
      email={context.email}
      roles={context.displayRoles}
      isOwner={context.isOwner}
    >
      {children}
    </DashboardShell>
  );
}