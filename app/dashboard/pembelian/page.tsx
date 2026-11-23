import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PembelianPage() {
  await guardPage(() => requireAnyRole(["Finance", "Management"]));
  return <ModulePlaceholder title="Pembelian" description="Modul pembelian hanya dapat dibuka oleh Finance dan Management." />;
}
