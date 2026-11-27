"use server";

import { requireOwner } from "@/lib/auth/authorization";
import { APPROVED_OPERATIONAL_ROLES } from "@/lib/auth/access-policy";
import { createAdminClient } from "@/lib/supabase/admin";

type ScopeSetting = "none" | "all" | "selected";
type PermissionSetting = "unset" | "allow" | "deny";
type ScopeSettings = { project: ScopeSetting; department: ScopeSetting; warehouse: ScopeSetting };
type PermissionSettings = {
  "transaction.post_recognition": PermissionSetting;
  "fund_utilization.post_recognition": PermissionSetting;
  "payment.post": PermissionSetting;
  "payment.allocate": PermissionSetting;
  "ap.create_edit": PermissionSetting;
  "ap.submit": PermissionSetting;
};

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
  scopes: ScopeSettings;
  permissions: PermissionSettings;
  projectIds: string[];
  warehouseIds: string[];
};

const DEFAULT_SCOPES: ScopeSettings = { project: "none", department: "none", warehouse: "none" };
const DEFAULT_PERMISSIONS: PermissionSettings = {
  "transaction.post_recognition": "unset",
  "fund_utilization.post_recognition": "unset",
  "payment.post": "unset",
  "payment.allocate": "unset",
  "ap.create_edit": "unset",
  "ap.submit": "unset",
};

/**
 * Roles are validated against the shared policy module, which is the single
 * place that defines the approved operational role list. Superadmin is never
 * assignable here.
 */
const allowedRoles: readonly string[] = APPROVED_OPERATIONAL_ROLES;

type AuditAction =
  | "user.created"
  | "user.access_updated"
  | "user.email_update_requested"
  | "user.email_updated"
  | "user.email_update_failed"
  | "user.password_reset_requested"
  | "user.password_reset"
  | "user.password_reset_failed";

async function writeAuditEvent(
  admin: ReturnType<typeof createAdminClient>,
  actorUserId: string,
  targetUserId: string,
  tenantId: string,
  action: AuditAction,
  entityType: "user_access" | "auth_user",
  beforeData?: Record<string, unknown>,
  afterData?: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    target_user_id: targetUserId,
    action,
    entity_type: entityType,
    entity_id: targetUserId,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
  });
  return !error;
}

function displayName(email: string) {
  return email.split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  const owner = await requireOwner();
  if (!owner.tenantId) throw new Error("Tenant Superadmin tidak ditemukan.");
  const admin = createAdminClient();
  const { data: memberships, error: membershipError } = await admin.from("tenant_memberships")
    .select("user_id,tenant_role").eq("tenant_id", owner.tenantId).eq("is_active", true);
  if (membershipError) throw new Error("Daftar keanggotaan tenant gagal dimuat.");
  const membershipById = new Map((memberships ?? []).map((m) => [m.user_id, m.tenant_role]));
  const users: ManagedUser[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Daftar pengguna gagal dimuat.");

    const tenantUsers = data.users.filter((user) => membershipById.has(user.id));
    const ids = tenantUsers.map((user) => user.id);
    const [profileResult, scopeResult, permissionResult] = ids.length
      ? await Promise.all([
          admin.from("tenant_user_access_profiles").select("user_id, roles, is_active").eq("tenant_id", owner.tenantId).in("user_id", ids),
          admin.from("tenant_user_work_scopes").select("user_id, dimension, scope_mode, resource_ids").eq("tenant_id", owner.tenantId).in("user_id", ids),
          admin.from("tenant_user_permission_overrides").select("user_id, permission_key, effect").eq("tenant_id", owner.tenantId).in("user_id", ids),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];
    if (profileResult.error) throw new Error("Pengaturan Role pengguna gagal dimuat.");
    if (scopeResult.error) throw new Error("Pengaturan Area Kerja pengguna gagal dimuat.");
    if (permissionResult.error) throw new Error("Permission pengguna gagal dimuat.");

    const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.user_id, profile]));
    const scopesById = new Map<string, ScopeSettings>();
    const projectIdsById = new Map<string, string[]>();
    const warehouseIdsById = new Map<string, string[]>();
    for (const row of scopeResult.data ?? []) {
      if (!["project", "department", "warehouse"].includes(row.dimension)) continue;
      const current = scopesById.get(row.user_id) ?? { ...DEFAULT_SCOPES };
      current[row.dimension as keyof ScopeSettings] =
        row.scope_mode === "all" ? "all" : row.scope_mode === "selected" ? "selected" : "none";
      scopesById.set(row.user_id, current);
      if (row.dimension === "project" && row.scope_mode === "selected") {
        projectIdsById.set(row.user_id, (row.resource_ids ?? []).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)));
      }
      if (row.dimension === "warehouse" && row.scope_mode === "selected") {
        warehouseIdsById.set(row.user_id, (row.resource_ids ?? []).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)));
      }
    }
    const permissionsById = new Map<string, PermissionSettings>();
    for (const row of permissionResult.data ?? []) {
      if (!(row.permission_key in DEFAULT_PERMISSIONS)) continue;
      const current = permissionsById.get(row.user_id) ?? { ...DEFAULT_PERMISSIONS };
      current[row.permission_key as keyof PermissionSettings] =
        row.effect === "allow" || row.effect === "deny" ? row.effect : "unset";
      permissionsById.set(row.user_id, current);
    }

    for (const user of tenantUsers) {
      const profile = profileById.get(user.id);
      users.push({
        id: user.id,
        name: displayName(user.email ?? "Pengguna"),
        email: user.email ?? "",
        roles: membershipById.get(user.id) === "superadmin" ? ["Superadmin"] : (profile?.roles ?? []),
        status: profile?.is_active === true ? "Aktif" : "Nonaktif",
        scopes: scopesById.get(user.id) ?? { ...DEFAULT_SCOPES },
        projectIds: projectIdsById.get(user.id) ?? [],
        warehouseIds: warehouseIdsById.get(user.id) ?? [],
        permissions: permissionsById.get(user.id) ?? { ...DEFAULT_PERMISSIONS },
      });
    }

    if (data.users.length < 1000) break;
    page += 1;
  }

  return users;
}

export async function saveUserAccessProfile(input: {
  userId: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
  scopes: ScopeSettings;
  permissions: PermissionSettings;
  projectIds: string[];
  warehouseIds: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();
    const userId = typeof input?.userId === "string" ? input.userId.trim() : "";
    const roles = Array.isArray(input?.roles) ? input.roles : [];
    const status = input?.status;
    const scopes = input?.scopes;
    const permissions = input?.permissions;
    const projectIds = Array.isArray(input?.projectIds) ? [...new Set(input.projectIds)] : [];
    const warehouseIds = Array.isArray(input?.warehouseIds) ? [...new Set(input.warehouseIds)] : [];
    const permissionKeys = [
      "transaction.post_recognition",
      "fund_utilization.post_recognition",
      "payment.post",
      "payment.allocate",
      "ap.create_edit",
      "ap.submit",
    ] as const;

    if (!userId) return { ok: false, error: "Pengguna tidak valid." };
    if (userId === owner.userId) return { ok: false, error: "Akun Owner utama tidak dapat diubah dari daftar ini." };
    if (!roles.every((role) => typeof role === "string" && allowedRoles.includes(role))) {
      return { ok: false, error: "Role yang dipilih tidak valid." };
    }
    if (status !== "Aktif" && status !== "Nonaktif") {
      return { ok: false, error: "Status akun tidak valid." };
    }
    if (!scopes || !["none", "all", "selected"].includes(scopes.project) || !["none", "all"].includes(scopes.department) || !["none", "all", "selected"].includes(scopes.warehouse)) {
      return { ok: false, error: "Pengaturan Area Kerja tidak valid." };
    }
    if (scopes.project === "selected" && projectIds.length === 0) return { ok: false, error: "Pilih minimal satu Project untuk Area Kerja Selected." };
    if (scopes.project !== "selected" && projectIds.length > 0) return { ok: false, error: "Daftar Project Selected tidak sesuai dengan mode Area Kerja." };
    if (scopes.warehouse === "selected" && warehouseIds.length === 0) return { ok: false, error: "Pilih minimal satu Warehouse." };
    if (scopes.warehouse !== "selected" && warehouseIds.length > 0) return { ok: false, error: "Daftar Warehouse Selected tidak sesuai dengan mode Area Kerja." };
    if (!permissions || permissionKeys.some((key) =>
      permissions[key] !== "unset" && permissions[key] !== "allow" && permissions[key] !== "deny"
    )) {
      return { ok: false, error: "Pengaturan Permission tidak valid." };
    }

    const admin = createAdminClient();
    const { data: targetMembership, error: membershipError } = await admin.from("tenant_memberships")
      .select("id").eq("tenant_id", owner.tenantId).eq("user_id", userId).maybeSingle();
    if (membershipError || !targetMembership) return { ok: false, error: "Pengguna tidak terdaftar pada perusahaan ini." };
    const { error } = await admin.rpc("save_tenant_user_access_profile_with_audit", {
      p_actor_user_id: owner.userId,
      p_tenant_id: owner.tenantId,
      p_target_user_id: userId,
      p_roles: [...new Set(roles)],
      p_is_active: status === "Aktif",
      p_scopes: scopes,
      p_permissions: permissions,
      p_project_ids: projectIds,
      p_warehouse_ids: warehouseIds,
    });

    if (error) {
      return { ok: false, error: "Pengaturan akses dan Audit Log gagal disimpan. Tidak ada perubahan yang diterapkan." };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Simpan akses pengguna gagal." };
  }
}

export async function resetUserPassword(input: {
  userId: string;
  password: string;
}): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();

    if (!input || typeof input.userId !== "string" || !input.userId.trim()) {
      return { ok: false, error: "Pengguna tidak valid." };
    }
    if (typeof input.password !== "string" || input.password.length < 8) {
      return { ok: false, error: "Password baru minimal 8 karakter." };
    }

    const admin = createAdminClient();
    const targetUserId = input.userId.trim();
    const { data: targetMembership } = await admin.from("tenant_memberships")
      .select("id").eq("tenant_id", owner.tenantId).eq("user_id", targetUserId).maybeSingle();
    if (!targetMembership) return { ok: false, error: "Pengguna tidak terdaftar pada perusahaan ini." };
    const requestLogged = await writeAuditEvent(
      admin, owner.userId, targetUserId, owner.tenantId!, "user.password_reset_requested", "auth_user",
    );
    if (!requestLogged) {
      return { ok: false, error: "Permintaan reset tidak dijalankan karena Audit Log gagal disimpan." };
    }

    const { error } = await admin.auth.admin.updateUserById(targetUserId, {
      password: input.password,
    });

    if (error) {
      await writeAuditEvent(
        admin, owner.userId, targetUserId, owner.tenantId!, "user.password_reset_failed", "auth_user",
      );
      return { ok: false, error: "Password gagal diperbarui. Periksa akun pengguna dan coba lagi." };
    }

    const resultLogged = await writeAuditEvent(
      admin, owner.userId, targetUserId, owner.tenantId!, "user.password_reset", "auth_user",
    );
    return resultLogged
      ? { ok: true }
      : { ok: true, warning: "Password berhasil diperbarui, tetapi catatan hasil Audit Log gagal disimpan." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Reset password gagal.",
    };
  }
}

export async function createManagedUser(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; user: ManagedUser; warning?: string } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input?.password === "string" ? input.password : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Masukkan alamat email yang valid." };
    }
    if (!owner.tenantId) return { ok: false, error: "Tenant Superadmin tidak ditemukan." };

    const admin = createAdminClient();
    let existingUser: { id: string; email?: string } | null = null;
    let page = 1;
    while (!existingUser) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return { ok: false, error: "Pemeriksaan akun pengguna gagal." };
      existingUser = data.users.find((user) => (user.email ?? "").toLowerCase() === email) ?? null;
      if (existingUser || data.users.length < 1000) break;
      page += 1;
    }

    const { data: existingMembership, error: membershipLookupError } = existingUser
      ? await admin.from("tenant_memberships").select("id,is_active")
          .eq("tenant_id", owner.tenantId).eq("user_id", existingUser.id).maybeSingle()
      : { data: null, error: null };
    if (membershipLookupError) return { ok: false, error: "Status keanggotaan pengguna gagal diperiksa." };
    if (existingMembership) {
      return { ok: false, error: existingMembership.is_active
        ? "Pengguna sudah terdaftar di perusahaan ini."
        : "Pengguna sudah terdaftar tetapi keanggotaannya nonaktif. Aktifkan kembali keanggotaan yang ada." };
    }

    let userId = existingUser?.id ?? "";
    let userEmail = existingUser?.email ?? email;
    let createdNewAuthUser = false;

    if (!existingUser) {
      if (password.length < 8) {
        return { ok: false, error: "Password awal akun baru minimal 8 karakter." };
      }
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        const message = error?.message.toLowerCase() ?? "";
        return {
          ok: false,
          error: message.includes("already") || message.includes("registered")
            ? "Email ini baru saja terdaftar. Muat ulang halaman dan coba lagi."
            : "Akun gagal dibuat. Periksa email dan coba lagi.",
        };
      }
      userId = data.user.id;
      userEmail = data.user.email ?? email;
      createdNewAuthUser = true;
    }

    const { error: membershipError } = await admin.from("tenant_memberships").insert({
      tenant_id: owner.tenantId,
      user_id: userId,
      tenant_role: "member",
      is_active: true,
      created_by: owner.userId,
    });
    if (membershipError) {
      if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
      return { ok: false, error: "Keanggotaan perusahaan gagal dibuat." };
    }

    const { error: profileError } = await admin.from("tenant_user_access_profiles").insert({
      tenant_id: owner.tenantId,
      user_id: userId,
      roles: [],
      is_active: true,
      created_by: owner.userId,
      updated_by: owner.userId,
    });
    if (profileError) {
      await admin.from("tenant_memberships").delete().eq("tenant_id", owner.tenantId).eq("user_id", userId);
      if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
      return { ok: false, error: "Profil akses perusahaan gagal dibuat. Tidak ada akun yang ditambahkan." };
    }

    const auditLogged = await writeAuditEvent(
      admin, owner.userId, userId, owner.tenantId, "user.created", "auth_user",
      undefined, { email: userEmail, membership_added: true, auth_user_created: createdNewAuthUser },
    );
    if (!auditLogged) {
      await admin.from("tenant_memberships").delete().eq("tenant_id", owner.tenantId).eq("user_id", userId);
      await admin.from("tenant_user_access_profiles").delete().eq("tenant_id", owner.tenantId).eq("user_id", userId);
      if (createdNewAuthUser) await admin.auth.admin.deleteUser(userId);
      return { ok: false, error: "Penambahan dibatalkan karena Audit Log gagal disimpan." };
    }

    return {
      ok: true,
      user: {
        id: userId,
        name: displayName(userEmail),
        email: userEmail,
        roles: [],
        status: "Aktif",
        scopes: { ...DEFAULT_SCOPES },
        projectIds: [],
        warehouseIds: [],
        permissions: { ...DEFAULT_PERMISSIONS },
      },
      ...(createdNewAuthUser ? {} : { warning: "Akun yang sudah ada berhasil ditambahkan ke perusahaan ini. Password lama tetap digunakan." }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tambah pengguna gagal.",
    };
  }
}
export async function updateManagedUserEmail(input: {
  userId: string;
  email: string;
}): Promise<{ ok: true; email: string; name: string; warning?: string } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();

    const userId = typeof input?.userId === "string" ? input.userId.trim() : "";
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";

    if (!userId) return { ok: false, error: "Pengguna tidak valid." };
    if (userId === owner.userId) return { ok: false, error: "Email akun Owner utama tidak dapat diubah dari halaman ini." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Masukkan alamat email yang valid." };
    }

    const admin = createAdminClient();
    const { data: targetMembership } = await admin.from("tenant_memberships")
      .select("id").eq("tenant_id", owner.tenantId).eq("user_id", userId).maybeSingle();
    if (!targetMembership) return { ok: false, error: "Pengguna tidak terdaftar pada perusahaan ini." };
    const { data: currentUserData, error: currentUserError } = await admin.auth.admin.getUserById(userId);
    if (currentUserError || !currentUserData.user) {
      return { ok: false, error: "Akun pengguna tidak ditemukan." };
    }
    const oldEmail = currentUserData.user.email ?? "";

    const requestLogged = await writeAuditEvent(
      admin,
      owner.userId,
      userId,
      owner.tenantId!,
      "user.email_update_requested",
      "auth_user",
      { email: oldEmail },
      { email },
    );
    if (!requestLogged) {
      return { ok: false, error: "Perubahan email tidak dijalankan karena Audit Log gagal disimpan." };
    }

    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });

    if (error || !data.user) {
      await writeAuditEvent(
        admin,
        owner.userId,
        userId,
        owner.tenantId!,
        "user.email_update_failed",
        "auth_user",
        { email: oldEmail },
        { requested_email: email },
      );
      const message = error?.message.toLowerCase() ?? "";
      return {
        ok: false,
        error: message.includes("already") || message.includes("registered") || message.includes("exists")
          ? "Email ini sudah digunakan oleh akun lain."
          : "Email gagal diperbarui. Periksa email dan coba lagi.",
      };
    }

    const updatedEmail = data.user.email ?? email;
    const resultLogged = await writeAuditEvent(
      admin,
      owner.userId,
      userId,
      owner.tenantId!,
      "user.email_updated",
      "auth_user",
      { email: oldEmail },
      { email: updatedEmail },
    );
    return {
      ok: true,
      email: updatedEmail,
      name: displayName(updatedEmail),
      ...(resultLogged ? {} : { warning: "Email berhasil diperbarui, tetapi catatan hasil Audit Log gagal disimpan." }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Edit email pengguna gagal.",
    };
  }
}
