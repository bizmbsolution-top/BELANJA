import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PembelianPage() {
  await guardPage(() => requireAnyRole(["Procurement", "Finance", "Management"]));
  return <ModulePlaceholder title="Pembelian" description="Modul pembelian dapat dibuka oleh Procurement, Finance, dan Management." />;
}
