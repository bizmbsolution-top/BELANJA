import { guardPage, requireOwner } from "@/lib/auth/authorization";
import { getManagedUsers } from "./actions";
import UserAccess from "./user-access";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsersPage() {
  await guardPage(requireOwner);

  const users = await getManagedUsers();
  const { data: projects, error } = await createAdminClient()
    .from("projects").select("id, code, name").eq("is_active", true).order("name", { ascending: true });
  if (error) throw new Error("Daftar Project aktif gagal dimuat.");

  return <UserAccess initialUsers={users} initialProjects={projects ?? []} />;
}