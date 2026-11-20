import { redirect } from "next/navigation";
import { getManagedUsers } from "./actions";
import UserAccess from "./user-access";

export default async function UsersPage() {
  let users;

  try {
    users = await getManagedUsers();
  } catch {
    redirect("/dashboard?error=users");
  }

  return <UserAccess initialUsers={users} />;
}
