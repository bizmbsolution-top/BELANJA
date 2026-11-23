"use server";

import { requireOwner } from "@/lib/auth/authorization";
import { APPROVED_OPERATIONAL_ROLES } from "@/lib/auth/access-policy";
import { createAdminClient } from "@/lib/supabase/admin";

type ScopeSetting = "none" | "all";
type PermissionSetting = "unset" | "allow" | "deny";
type ScopeSettings = { project: ScopeSetting; department: ScopeSetting; warehouse: ScopeSetting };
type PermissionSettings = {
  "transaction.post_recognition": PermissionSetting;
  "fund_utilization.post_recognition": PermissionSetting;
  "payment.post": PermissionSetting;
  "payment.allocate": PermissionSetting;
};

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
  scopes: ScopeSettings;
  permissions: PermissionSettings;
};

const DEFAULT_SCOPES: ScopeSettings = { project: "none", department: "none", warehouse: "none" };
const DEFAULT_PERMISSIONS: PermissionSettings = {
  "transaction.post_recognition": "unset",
  "fund_utilization.post_recognition": "unset",
  "payment.post": "unset",
  "payment.allocate": "unset",
};

/**
 * Roles are validated against the shared policy module, which is the single
 * place that defines the approved operational role list. Superadmin is never
 * assignable here.
 */
const allowedRoles: readonly string[] = APPROVED_OPERATIONAL_ROLES;

function displayName(email: string) {
  return email.split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  await requireOwner();
  const admin = createAdminClient();
  const ownerEmail = process.env.BELANJA_OWNER_EMAIL?.trim().toLowerCase();
  const users: ManagedUser[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Daftar pengguna gagal dimuat.");

    const ids = data.users.map((user) => user.id);
    const [profileResult, scopeResult, permissionResult] = ids.length
      ? await Promise.all([
          admin.from("user_access_profiles").select("user_id, roles, is_active").in("user_id", ids),
          admin.from("user_work_scopes").select("user_id, dimension, scope_mode, resource_ids").in("user_id", ids),
          admin.from("user_permission_overrides").select("user_id, permission_key, effect").in("user_id", ids),
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
    for (const row of scopeResult.data ?? []) {
      if (!["project", "department", "warehouse"].includes(row.dimension)) continue;
      const current = scopesById.get(row.user_id) ?? { ...DEFAULT_SCOPES };
      current[row.dimension as keyof ScopeSettings] =
        row.scope_mode === "all" ? "all" : "none";
      scopesById.set(row.user_id, current);
    }
    const permissionsById = new Map<string, PermissionSettings>();
    for (const row of permissionResult.data ?? []) {
      if (!(row.permission_key in DEFAULT_PERMISSIONS)) continue;
      const current = permissionsById.get(row.user_id) ?? { ...DEFAULT_PERMISSIONS };
      current[row.permission_key as keyof PermissionSettings] =
        row.effect === "allow" || row.effect === "deny" ? row.effect : "unset";
      permissionsById.set(row.user_id, current);
    }

    for (const user of data.users) {
      const profile = profileById.get(user.id);
      users.push({
        id: user.id,
        name: displayName(user.email ?? "Pengguna"),
        email: user.email ?? "",
        roles: user.email?.toLowerCase() === ownerEmail ? ["Superadmin"] : (profile?.roles ?? []),
        status: profile?.is_active === true ? "Aktif" : "Nonaktif",
        scopes: scopesById.get(user.id) ?? { ...DEFAULT_SCOPES },
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();
    const userId = typeof input?.userId === "string" ? input.userId.trim() : "";
    const roles = Array.isArray(input?.roles) ? input.roles : [];
    const status = input?.status;
    const scopes = input?.scopes;
    const permissions = input?.permissions;
    const dimensions = ["project", "department", "warehouse"] as const;
    const permissionKeys = [
      "transaction.post_recognition",
      "fund_utilization.post_recognition",
      "payment.post",
      "payment.allocate",
    ] as const;

    if (!userId) return { ok: false, error: "Pengguna tidak valid." };
    if (userId === owner.userId) return { ok: false, error: "Akun Owner utama tidak dapat diubah dari daftar ini." };
    if (!roles.every((role) => typeof role === "string" && allowedRoles.includes(role))) {
      return { ok: false, error: "Role yang dipilih tidak valid." };
    }
    if (status !== "Aktif" && status !== "Nonaktif") {
      return { ok: false, error: "Status akun tidak valid." };
    }
    if (!scopes || dimensions.some((key) => scopes[key] !== "none" && scopes[key] !== "all")) {
      return { ok: false, error: "Pengaturan Area Kerja tidak valid." };
    }
    if (!permissions || permissionKeys.some((key) =>
      permissions[key] !== "unset" && permissions[key] !== "allow" && permissions[key] !== "deny"
    )) {
      return { ok: false, error: "Pengaturan Permission tidak valid." };
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { error: profileError } = await admin.from("user_access_profiles").upsert({
      user_id: userId,
      roles: [...new Set(roles)],
      is_active: status === "Aktif",
      updated_at: now,
      updated_by: owner.userId,
    }, { onConflict: "user_id" });
    if (profileError) return { ok: false, error: "Pengaturan Role dan status gagal disimpan." };

    const { data: existingScopes, error: existingScopesError } = await admin
      .from("user_work_scopes").select("dimension, created_by").eq("user_id", userId);
    if (existingScopesError) return { ok: false, error: "Data Area Kerja sebelumnya gagal dibaca." };
    const scopeByDimension = new Map((existingScopes ?? []).map((row) => [row.dimension, row]));
    const scopeRows = dimensions
      .filter((dimension) => scopes[dimension] === "all")
      .map((dimension) => ({
        user_id: userId,
        dimension,
        scope_mode: "all",
        resource_ids: [],
        created_by: scopeByDimension.get(dimension)?.created_by ?? owner.userId,
        updated_at: now,
        updated_by: owner.userId,
      }));
    if (scopeRows.length) {
      const { error } = await admin.from("user_work_scopes").upsert(scopeRows, { onConflict: "user_id,dimension" });
      if (error) return { ok: false, error: "Area Kerja gagal disimpan." };
    }
    for (const dimension of dimensions.filter((key) => scopes[key] === "none")) {
      const { error } = await admin.from("user_work_scopes").delete().eq("user_id", userId).eq("dimension", dimension);
      if (error) return { ok: false, error: "Area Kerja gagal diperbarui." };
    }

    const { data: existingPermissions, error: existingPermissionsError } = await admin
      .from("user_permission_overrides").select("permission_key, created_by").eq("user_id", userId);
    if (existingPermissionsError) return { ok: false, error: "Data Permission sebelumnya gagal dibaca." };
    const permissionByKey = new Map((existingPermissions ?? []).map((row) => [row.permission_key, row]));
    const permissionRows = permissionKeys
      .filter((key) => permissions[key] !== "unset")
      .map((key) => ({
        user_id: userId,
        permission_key: key,
        effect: permissions[key],
        created_by: permissionByKey.get(key)?.created_by ?? owner.userId,
        updated_at: now,
        updated_by: owner.userId,
      }));
    if (permissionRows.length) {
      const { error } = await admin.from("user_permission_overrides").upsert(permissionRows, { onConflict: "user_id,permission_key" });
      if (error) return { ok: false, error: "Permission khusus gagal disimpan." };
    }
    for (const key of permissionKeys.filter((item) => permissions[item] === "unset")) {
      const { error } = await admin.from("user_permission_overrides").delete().eq("user_id", userId).eq("permission_key", key);
      if (error) return { ok: false, error: "Permission khusus gagal diperbarui." };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Simpan akses pengguna gagal." };
  }
}

export async function resetUserPassword(input: {
  userId: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();

    if (!input || typeof input.userId !== "string" || !input.userId.trim()) {
      return { ok: false, error: "Pengguna tidak valid." };
    }
    if (typeof input.password !== "string" || input.password.length < 8) {
      return { ok: false, error: "Password baru minimal 8 karakter." };
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(input.userId, {
      password: input.password,
    });

    if (error) return { ok: false, error: "Password gagal diperbarui. Periksa akun pengguna dan coba lagi." };
    return { ok: true };
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
}): Promise<{ ok: true; user: ManagedUser } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();

    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input?.password === "string" ? input.password : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Masukkan alamat email yang valid." };
    }
    if (password.length < 8) {
      return { ok: false, error: "Password awal minimal 8 karakter." };
    }

    const admin = createAdminClient();
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
          ? "Email ini sudah terdaftar."
          : "Akun gagal dibuat. Periksa email dan coba lagi.",
      };
    }

    const { error: profileError } = await admin.from("user_access_profiles").insert({
      user_id: data.user.id,
      roles: [],
      is_active: true,
      created_by: owner.userId,
      updated_by: owner.userId,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return { ok: false, error: "Akun gagal disiapkan. Silakan coba lagi." };
    }

    return {
      ok: true,
      user: {
        id: data.user.id,
        name: displayName(email),
        email: data.user.email ?? email,
        roles: [],
        status: "Aktif",
      },
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
}): Promise<{ ok: true; email: string; name: string } | { ok: false; error: string }> {
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
    const { data, error } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });

    if (error || !data.user) {
      const message = error?.message.toLowerCase() ?? "";
      return {
        ok: false,
        error: message.includes("already") || message.includes("registered") || message.includes("exists")
          ? "Email ini sudah digunakan oleh akun lain."
          : "Email gagal diperbarui. Periksa email dan coba lagi.",
      };
    }

    const updatedEmail = data.user.email ?? email;
    return { ok: true, email: updatedEmail, name: displayName(updatedEmail) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Edit email pengguna gagal.",
    };
  }
}
