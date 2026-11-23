import {requireAnyRole} from "@/lib/auth/authorization";
import {createAdminClient} from "@/lib/supabase/admin";
import UomManager,{type Uom} from "./manager";
const ROLES=["Procurement","Warehouse","Finance","Management"] as const;
export default async function UomPage(){await requireAnyRole(ROLES);const{data,error}=await createAdminClient().from("units_of_measure").select("id,code,name,symbol,description,is_active").order("name").limit(500);if(error)throw new Error("Data UOM gagal dimuat.");return <UomManager initialItems={(data??[]) as Uom[]}/>;}
