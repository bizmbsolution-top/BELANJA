"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
};

const allowedRoles = ["Cashier", "Finance", "Warehouse", "Management"];

async function requireOwner() {
  const ownerEmail = process.env.BELANJA_OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("BELANJA_OWNER_EMAIL belum dikonfigurasi.");

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || user.email?.toLowerCase() !== ownerEmail) {
    throw new Error("Akses hanya untuk Owner.");
  }

  return user;
}

function displayName(email: string) {
  return email.split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  await requireOwner();
  const admin = createAdminClient();
  const users: ManagedUser[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Daftar pengguna gagal dimuat.");

    const ids = data.users.map((user) => user.id);
    const { data: profiles, error: profileError } = ids.length
      ? await admin.from("user_access_profiles").select("user_id, roles, is_active").in("user_id", ids)
      : { data: [], error: null };
    if (profileError) throw new Error("Pengaturan akses pengguna gagal dimuat.");

    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

    for (const user of data.users) {
      const profile = profileById.get(user.id);
      users.push({
        id: user.id,
        name: displayName(user.email ?? "Pengguna"),
        email: user.email ?? "",
        roles: profile?.roles ?? [],
        status: profile?.is_active === true ? "Aktif" : "Nonaktif",
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const owner = await requireOwner();
    const userId = typeof input?.userId === "string" ? input.userId.trim() : "";
    const roles = Array.isArray(input?.roles) ? input.roles : [];
    const status = input?.status;

    if (!userId) return { ok: false, error: "Pengguna tidak valid." };
    if (userId === owner.id) return { ok: false, error: "Akun Owner utama tidak dapat diubah dari daftar ini." };
    if (!roles.every((role) => typeof role === "string" && allowedRoles.includes(role))) {
      return { ok: false, error: "Role yang dipilih tidak valid." };
    }
    if (status !== "Aktif" && status !== "Nonaktif") {
      return { ok: false, error: "Status akun tidak valid." };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("user_access_profiles").upsert({
      user_id: userId,
      roles: [...new Set(roles)],
      is_active: status === "Aktif",
      updated_at: new Date().toISOString(),
      updated_by: owner.id,
    }, { onConflict: "user_id" });

    if (error) return { ok: false, error: "Pengaturan Role dan status gagal disimpan." };
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
      created_by: owner.id,
      updated_by: owner.id,
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
    if (userId === owner.id) return { ok: false, error: "Email akun Owner utama tidak dapat diubah dari halaman ini." };
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
