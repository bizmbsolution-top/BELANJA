import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function KasPembayaranPage() {
  await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  return <ModulePlaceholder title="Kas & Pembayaran" description="Modul kas dan pembayaran dapat dibuka oleh Cashier, Finance, dan Management." />;
}
