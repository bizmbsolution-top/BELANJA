import Image from "next/image";
import { guardPage, requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveCompanyProfile } from "./actions";
import styles from "./profile.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const access = await guardPage(requireOwner);
  const params = await searchParams;
  if (!access.tenantId) throw new Error("Tenant tidak ditemukan.");

  const admin = createAdminClient();
  const { data: tenant, error } = await admin
    .from("tenants")
    .select("id,name,slug,logo_url,created_at")
    .eq("id", access.tenantId)
    .maybeSingle();
  if (error || !tenant) throw new Error("Profil perusahaan gagal dimuat.");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PENGATURAN PERUSAHAAN</p>
          <h1>Profil Perusahaan</h1>
          <p>Atur identitas perusahaan yang tampil pada halaman login dan seluruh area aplikasi.</p>
        </div>
        <span className={styles.headerTag}>Tenant aktif</span>
      </header>

      {params.saved === "1" && <p className={styles.success}>Profil perusahaan berhasil diperbarui.</p>}
      {params.error && <p className={styles.error}>
        {params.error === "invalid-name" ? "Nama perusahaan wajib diisi (2–120 karakter)." :
         params.error === "size" ? "Ukuran logo maksimal 2 MB." :
         params.error === "type" ? "Format logo harus PNG, JPG, atau WebP yang valid." :
         params.error === "upload" ? "Logo gagal diunggah. Silakan coba kembali." :
         "Profil perusahaan gagal disimpan. Periksa koneksi dan coba kembali."}
      </p>}

      <section className={styles.card}>
        <div className={styles.cardHeading}>
          <div><h2>Identitas Perusahaan</h2><p>Informasi ini hanya berlaku untuk tenant ini.</p></div>
        </div>
        <div className={styles.preview}>
          <div className={styles.logoFrame}>
            {tenant.logo_url ? <img src={tenant.logo_url} alt={`Logo ${tenant.name}`} /> : <span>{tenant.name.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className={styles.previewText}>
            <strong>{tenant.name}</strong>
            <small>Kode perusahaan · {tenant.slug}</small>
            <span className={styles.powered}><Image src="/logo_belanja.png" alt="" width={18} height={18} /> Powered by BELANJA</span>
          </div>
        </div>

        <form action={saveCompanyProfile} className={styles.form}>
          <label>Nama perusahaan
            <input name="name" type="text" defaultValue={tenant.name} required minLength={2} maxLength={120} />
          </label>
          <label>Logo perusahaan
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
            <small>PNG, JPG, atau WebP · Maksimal 2 MB. Logo akan tampil di sidebar dan halaman dashboard.</small>
          </label>
          <div className={styles.actions}>
            <button type="submit">Simpan Profil Perusahaan</button>
            <a href="/dashboard">Kembali ke Dashboard</a>
          </div>
        </form>
      </section>
      <p className={styles.note}>Logo BELANJA adalah identitas aplikasi dan tidak dapat diganti dari halaman ini. Logo perusahaan digunakan sebagai identitas utama tenant.</p>
    </main>
  );
}
