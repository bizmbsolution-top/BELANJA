import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PengeluaranPage() {
  await guardPage(() => requireAnyRole(["Cashier", "Finance", "Management"]));
  return <ModulePlaceholder title="Pengeluaran" description="Modul pengeluaran dapat dibuka oleh Cashier, Finance, dan Management." />;
}
