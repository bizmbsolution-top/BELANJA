import { guardPage, requirePlatformOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTenant, createTenantSuperadmin } from "./actions";
import { signOut } from "@/app/login/actions";
import styles from "./platform.module.css";

type HealthRow = {
  tenant_id: string;
  health_status: "healthy" | "degraded" | "down" | "unknown";
  response_time_ms: number | null;
  checked_at: string;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string; adminCreated?: string; adminError?: string; auditWarning?: string }>;
}) {
  const owner = await guardPage(requirePlatformOwner);
  const params = await searchParams;
  const admin = createAdminClient();

  const [{ data: tenants, error: tenantError }, { data: memberships, error: membershipError }, { data: healthRows, error: healthError }] = await Promise.all([
    admin.from("tenants").select("id,name,slug,status,created_at").order("created_at", { ascending: true }),
    admin.from("tenant_memberships").select("tenant_id,user_id").eq("is_active", true),
    admin.from("tenant_health_snapshots").select("tenant_id,health_status,response_time_ms,checked_at").order("checked_at", { ascending: false }).limit(300),
  ]);

  if (tenantError || membershipError || healthError) {
    throw new Error("Data monitoring tenant gagal dimuat.");
  }

  const tenantList = tenants ?? [];
  const userCounts = new Map<string, Set<string>>();
  for (const row of memberships ?? []) {
    const set = userCounts.get(row.tenant_id) ?? new Set<string>();
    set.add(row.user_id);
    userCounts.set(row.tenant_id, set);
  }

  const latestHealth = new Map<string, HealthRow>();
  for (const row of (healthRows ?? []) as HealthRow[]) {
    if (!latestHealth.has(row.tenant_id)) latestHealth.set(row.tenant_id, row);
  }

  const activeCount = tenantList.filter((tenant) => tenant.status === "active").length;
  const totalUsers = [...userCounts.values()].reduce((sum, set) => sum + set.size, 0);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BELANJA · PLATFORM CONTROL</p>
          <h1>Platform Owner</h1>
          <p className={styles.subheading}>Kelola tenant dan pantau kesehatan aplikasi. Data transaksi perusahaan tidak ditampilkan di sini.</p>
        </div>
        <div className={styles.account}>
          <span className={styles.avatar}>O</span>
          <span><strong>Platform Owner</strong><small>{owner.email}</small></span>
          <form action={signOut} className={styles.logoutForm}>
            <button type="submit" className={styles.logoutButton}>Keluar</button>
          </form>
        </div>
      </header>

      <section className={styles.metrics}>
        <article><span>Total Tenant</span><strong>{tenantList.length}</strong></article>
        <article><span>Tenant Aktif</span><strong>{activeCount}</strong></article>
        <article><span>Tenant Nonaktif</span><strong>{tenantList.length - activeCount}</strong></article>
        <article><span>Pengguna Tenant</span><strong>{totalUsers}</strong></article>
      </section>

      {params.created === "1" && <p className={styles.success}>Tenant berhasil didaftarkan.</p>}
      {params.error === "duplicate" && <p className={styles.error}>Nama atau kode tenant sudah digunakan.</p>}
      {params.error === "invalid" && <p className={styles.error}>Nama tenant atau kode tenant belum valid.</p>}
      {params.error === "save" && <p className={styles.error}>Tenant gagal disimpan. Silakan coba kembali.</p>}
      {params.adminCreated === "1" && <p className={styles.success}>Akun Superadmin tenant berhasil dibuat dan terhubung ke perusahaan.</p>}
      {params.auditWarning === "1" && <p className={styles.error}>Akun berhasil dibuat, tetapi catatan audit gagal disimpan.</p>}
      {params.adminError === "exists" && <p className={styles.error}>Tenant ini sudah memiliki Superadmin aktif.</p>}
      {params.adminError === "duplicate" && <p className={styles.error}>Email tersebut sudah terdaftar.</p>}
      {params.adminError && !["exists","duplicate"].includes(params.adminError) && <p className={styles.error}>Pembuatan akun Superadmin gagal. Periksa data dan coba kembali.</p>}

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><h2>Daftar Tenant</h2><p>Informasi administrasi dan status aplikasi.</p></div>
        </div>
        {tenantList.length === 0 ? <p className={styles.empty}>Belum ada tenant terdaftar.</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Perusahaan</th><th>Kode</th><th>Pengguna</th><th>Status Tenant</th><th>Application Health</th><th>Pemeriksaan Terakhir</th></tr></thead>
              <tbody>
                {tenantList.map((tenant) => {
                  const health = latestHealth.get(tenant.id);
                  return (
                    <tr key={tenant.id}>
                      <td><strong>{tenant.name}</strong></td>
                      <td>{tenant.slug}</td>
                      <td>{userCounts.get(tenant.id)?.size ?? 0}</td>
                      <td><span className={tenant.status === "active" ? styles.active : styles.inactive}>{tenant.status === "active" ? "Aktif" : "Nonaktif"}</span></td>
                      <td>{health ? <span className={health.health_status === "healthy" ? styles.active : health.health_status === "down" ? styles.inactive : styles.pending}>{health.health_status === "healthy" ? "Normal" : health.health_status === "down" ? "Gangguan" : "Perlu perhatian"}</span> : <span className={styles.muted}>Belum ada data</span>}</td>
                      <td>{health ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(health.checked_at)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><h2>Daftarkan Tenant Baru</h2><p>Tenant baru akan dibuat dengan status aktif. Akun Superadmin dapat dibuat terpisah setelahnya.</p></div>
        </div>
        <form action={createTenant} className={styles.form}>
          <label>Nama perusahaan<input name="name" placeholder="Contoh: PT ABC Indonesia" required minLength={2} maxLength={120} /></label>
          <label>Kode tenant <span>(opsional)</span><input name="slug" placeholder="otomatis dari nama perusahaan" maxLength={80} /></label>
          <button type="submit">Daftarkan Tenant</button>
        </form>
      </section>


      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><h2>Buat Superadmin Tenant</h2><p>Platform Owner membuat akun awal untuk perusahaan. Setelah masuk, Superadmin mengelola seluruh pengguna dan operasional perusahaannya.</p></div>
        </div>
        <form action={createTenantSuperadmin} className={styles.form}>
          <label>Perusahaan
            <select name="tenantId" required>
              <option value="">Pilih tenant</option>
              {tenantList.filter((tenant) => tenant.status === "active").map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
          <label>Email Superadmin<input name="email" type="email" placeholder="admin@perusahaan.com" required maxLength={254} /></label>
          <label>Password awal<input name="password" type="password" placeholder="Minimal 8 karakter" required minLength={8} /></label>
          <button type="submit">Buat Akun Superadmin</button>
        </form>
      </section>
      <footer className={styles.footer}>Monitoring hanya menampilkan metadata aplikasi dan jumlah pengguna, bukan data transaksi internal tenant.</footer>
    </main>
  );
}
