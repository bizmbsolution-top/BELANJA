import { guardPage, requireOwner } from "@/lib/auth/authorization";
import { getManagedUsers } from "./actions";
import UserAccess from "./user-access";

export default async function UsersPage() {
  await guardPage(requireOwner);

  const users = await getManagedUsers();

  return <UserAccess initialUsers={users} />;
}