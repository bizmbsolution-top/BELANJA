"use server";

import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export async function closeSalesExpensePeriod(input: { projectId: string; periodMonth: string }): Promise<Result> {
  try {
    const actor = await requireAnyRole(["Cashier"]);
    if (!uuid(input?.projectId ?? "") || !/^\d{4}-\d{2}-01$/.test(input?.periodMonth ?? "")) {
      return { ok: false, error: "Project atau periode closing tidak valid." };
    }
    if (actor.tenantRole !== "superadmin") {
      const { data: permission, error: permissionError } = await createAdminClient()
        .from("user_permission_overrides").select("effect")
        .eq("user_id", actor.userId).eq("permission_key", "payment.post").maybeSingle();
      if (permissionError || permission?.effect !== "allow") {
        return { ok: false, error: "Permission payment.post diperlukan untuk closing Kasir." };
      }
    }
    if (!actor.tenantRole === "superadmin") {
      const admin = createAdminClient();
      const { data: project } = await admin.from("projects").select("id,is_active").eq("id", input.projectId).maybeSingle();
      if (!project?.is_active) return { ok: false, error: "Project tidak aktif atau tidak ditemukan." };
      const { data: scope, error } = await admin.from("user_work_scopes").select("scope_mode,resource_ids")
        .eq("user_id", actor.userId).eq("dimension", "project").maybeSingle();
      if (error || !scope) return { ok: false, error: "Area kerja Project belum diatur oleh Superadmin perusahaan." };
      if (scope.scope_mode !== "all" && !(scope.scope_mode === "selected" && scope.resource_ids?.includes(input.projectId))) {
        return { ok: false, error: "Project di luar area kerja akun Anda." };
      }
    }
    const { data, error } = await createAdminClient().rpc("close_sales_expense_period", {
      p_project_id: input.projectId,
      p_period_month: input.periodMonth,
      p_actor_user_id: actor.userId,
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("belum Paid") || message.includes("belum memiliki voucher")) {
        return { ok: false, error: "Closing ditolak: masih ada voucher Outstanding atau belum memiliki voucher." };
      }
      if (message.includes("sudah pernah")) return { ok: false, error: "Periode Project ini sudah pernah di-closing." };
      return { ok: false, error: "Closing gagal. Periksa status seluruh voucher biaya penjualan." };
    }
    revalidatePath("/dashboard/laporan-biaya-penjualan");
    revalidatePath("/dashboard/pengeluaran");
    return { ok: true, id: data as string };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Akses closing ditolak." };
  }
}
