"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

function redirectWith(status: string): never {
  redirect(`/dashboard/profil-perusahaan?${status}`);
}

function detectImage(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function saveCompanyProfile(formData: FormData) {
  const access = await requireOwner();
  if (!access.tenantId) redirect("/akses-ditolak?reason=inactive");

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) redirectWith("error=invalid-name");

  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin
    .from("tenants")
    .select("id,name,logo_url")
    .eq("id", access.tenantId)
    .maybeSingle();
  if (currentError || !current) redirectWith("error=load");

  const candidate = formData.get("logo");
  let logoUrl = current.logo_url as string | null;
  let newObjectPath: string | null = null;

  if (candidate instanceof File && candidate.size > 0) {
    if (candidate.size > 2 * 1024 * 1024) redirectWith("error=size");
    const fileBuffer = await candidate.arrayBuffer();
    const bytes = new Uint8Array(fileBuffer);
    const extension = detectImage(bytes);
    if (!extension) redirectWith("error=type");
    const contentType = extension === "jpg" ? "image/jpeg" : extension === "png" ? "image/png" : "image/webp";
    newObjectPath = `${access.tenantId}/company-logo-${Date.now()}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from("tenant-branding")
      .upload(newObjectPath, fileBuffer, { contentType, upsert: false, cacheControl: "3600" });
    if (uploadError) redirectWith("error=upload");

    const { data: publicData } = admin.storage.from("tenant-branding").getPublicUrl(newObjectPath);
    logoUrl = publicData.publicUrl;
  }

  const { error: updateError } = await admin
    .from("tenants")
    .update({ name, logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq("id", access.tenantId);
  if (updateError) {
    if (newObjectPath) await admin.storage.from("tenant-branding").remove([newObjectPath]);
    redirectWith("error=save");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/profil-perusahaan");
  redirectWith("saved=1");
}
