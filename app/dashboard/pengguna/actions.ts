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

export async function getManagedUsers(): Promise<ManagedUser[]> {
  await requireOwner();
  const admin = createAdminClient();
  const users: ManagedUser[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Daftar pengguna gagal dimuat.");

    for (const user of data.users) {
      const displayName = (user.email ?? "Pengguna").split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

      users.push({
        id: user.id,
        name: displayName,
        email: user.email ?? "",
        roles: [],
        status: user.banned_until && new Date(user.banned_until).getTime() > Date.now()
          ? "Nonaktif"
          : "Aktif",
      });
    }

    if (data.users.length < 1000) break;
    page += 1;
  }

  return users;
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
    await requireOwner();

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

    const displayName = email.split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\\w/g, (letter) => letter.toUpperCase());

    return {
      ok: true,
      user: {
        id: data.user.id,
        name: displayName,
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
