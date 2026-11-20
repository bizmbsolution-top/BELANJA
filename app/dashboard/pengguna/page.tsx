import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import UserAccess from "./user-access";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) redirect("/login");

  return <UserAccess />;
}
