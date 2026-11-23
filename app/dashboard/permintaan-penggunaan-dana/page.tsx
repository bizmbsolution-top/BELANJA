import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PermintaanPenggunaanDanaPage() {
  await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  return <ModulePlaceholder title="Permintaan & Penggunaan Dana" description="Modul ini dapat dibuka oleh Cashier, Finance, dan Management." />;
}
