import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PenjualanPage() {
  await guardPage(() => requireAnyRole(["Sales", "Management"]));
  return <ModulePlaceholder title="Penjualan" description="Modul penjualan dapat dibuka oleh Sales dan Management." />;
}
