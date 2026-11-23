import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PenjualanPage() {
  await guardPage(() => requireAnyRole(["Management"]));
  return <ModulePlaceholder title="Penjualan" description="Modul penjualan hanya dapat dibuka oleh Management." />;
}
