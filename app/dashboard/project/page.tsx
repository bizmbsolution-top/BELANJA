import { requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import ProjectManager, { type Project } from "./project-manager";
export default async function ProjectPage() {
 await requireOwner();
 const {data,error}=await createAdminClient().from("projects").select("id,code,name,location,description,is_active").order("name",{ascending:true}).limit(500);
 if(error) throw new Error("Data Project gagal dimuat. Silakan muat ulang halaman.");
 return <ProjectManager initialProjects={(data??[]) as Project[]}/>;
}
