import { guardPage, requireAnyRole } from "@/lib/auth/authorization";
import ModulePlaceholder from "../module-placeholder";

export default async function PersediaanPage() {
  await guardPage(() => requireAnyRole(["Warehouse", "Management"]));
  return <ModulePlaceholder title="Persediaan" description="Modul persediaan hanya dapat dibuka oleh Warehouse dan Management." />;
}
