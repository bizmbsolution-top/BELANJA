import { guardPage, requirePlatformOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTenant, createTenantSuperadmin, updateTenantSuperadminEmail, setTenantSuperadminActive, resetTenantSuperadminPassword } from "./actions";
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
  searchParams: Promise<{ created?: string; error?: string; adminCreated?: string; adminError?: string; auditWarning?: string; accountReused?: string; adminUpdated?: string; adminStatusUpdated?: string; passwordReset?: string }>;
}) {
  const owner = await guardPage(requirePlatformOwner);
  const params = await searchParams;
  const admin = createAdminClient();

  const [{ data: tenants, error: tenantError }, { data: memberships, error: membershipError }, { data: healthRows, error: healthError }, { data: superadminRows, error: superadminError }, { data: superadminProfiles, error: superadminProfileError }] = await Promise.all([
    admin.from("tenants").select("id,name,slug,status,created_at").order("created_at", { ascending: true }),
    admin.from("tenant_memberships").select("tenant_id,user_id").eq("is_active", true),
    admin.from("tenant_health_snapshots").select("tenant_id,health_status,response_time_ms,checked_at").order("checked_at", { ascending: false }).limit(300),
    admin.from("tenant_memberships").select("tenant_id,user_id,is_active").eq("tenant_role", "superadmin").order("is_active", { ascending: false }),
    admin.from("tenant_user_access_profiles").select("tenant_id,user_id,is_active"),
  ]);

  if (tenantError || membershipError || healthError || superadminError || superadminProfileError) {
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

  const profileStatus = new Map((superadminProfiles ?? []).map((row) => [`${row.tenant_id}:${row.user_id}`, row.is_active === true]));
  const superadmins = new Map<string, { userId: string; email: string; active: boolean }>();
  for (const row of superadminRows ?? []) {
    if (superadmins.has(row.tenant_id)) continue;
    const { data } = await admin.auth.admin.getUserById(row.user_id);
    superadmins.set(row.tenant_id, {
      userId: row.user_id,
      email: data.user?.email ?? "Email tidak tersedia",
      active: row.is_active === true && profileStatus.get(`${row.tenant_id}:${row.user_id}`) === true,
    });
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
      {params.adminCreated === "1" && <p className={styles.success}>{params.accountReused === "1" ? "Akun yang sudah terdaftar berhasil dihubungkan ke tenant ini. Password lama tetap digunakan." : "Akun Superadmin tenant berhasil dibuat dan terhubung ke perusahaan."}</p> }
      {params.auditWarning === "1" && <p className={styles.error}>Perubahan berhasil, tetapi catatan audit gagal disimpan. Mohon periksa log administrasi.</p>}
      {params.adminError === "exists" && <p className={styles.error}>Tenant ini sudah memiliki Superadmin aktif.</p>}
      {params.adminError === "lookup" && <p className={styles.error}>Pemeriksaan akun email gagal. Silakan coba kembali.</p>}
      {params.adminError === "password" && <p className={styles.error}>Password awal minimal 8 karakter untuk email yang belum terdaftar.</p>}
      {params.adminError === "audit" && <p className={styles.error}>Pencatatan audit gagal. Keanggotaan tenant dibatalkan.</p>}
      {params.adminUpdated === "1" && <p className={styles.success}>Email Superadmin berhasil diperbarui. Email login ini berlaku untuk seluruh tenant yang memakai akun tersebut.</p>}
      {params.adminStatusUpdated === "1" && <p className={styles.success}>Status akses Superadmin berhasil diperbarui.</p>}
      {params.passwordReset === "1" && <p className={styles.success}>Password Superadmin berhasil direset. Sampaikan password baru kepada pemilik akun melalui saluran yang aman.</p>}
      {params.adminError === "passwordReset" && <p className={styles.error}>Reset password gagal. Pastikan akun Superadmin masih terhubung ke tenant ini.</p>}
      {params.adminError === "passwordInvalid" && <p className={styles.error}>Password baru minimal 10 karakter.</p>}
      {params.adminError === "emailExists" && <p className={styles.error}>Email tersebut sudah digunakan akun lain.</p>}
      {params.adminError === "emailUpdate" && <p className={styles.error}>Email Superadmin gagal diperbarui.</p>}
      {params.adminError === "status" && <p className={styles.error}>Status Superadmin gagal diperbarui.</p>}
      {params.adminError === "superadmin" && <p className={styles.error}>Data Superadmin tenant tidak ditemukan.</p>}
      {params.adminError === "duplicate" && <p className={styles.error}>Email tersebut sudah terdaftar.</p>}
      {params.adminError && !["exists","duplicate","lookup","password","audit","emailExists","emailUpdate","status","superadmin"].includes(params.adminError) && <p className={styles.error}>Operasi Superadmin gagal. Periksa data dan coba kembali.</p>}

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><h2>Daftar Tenant</h2><p>{tenantList.length} perusahaan terdaftar. Buka detail hanya pada tenant yang ingin diperiksa atau dikelola.</p></div>
        </div>
        {tenantList.length === 0 ? <p className={styles.empty}>Belum ada tenant terdaftar.</p> : (
          <div className={styles.tenantList}>
            {tenantList.map((tenant) => {
              const health = latestHealth.get(tenant.id);
              const superadmin = superadmins.get(tenant.id);
              return (
                <article className={styles.tenantItem} key={tenant.id}>
                  <div className={styles.tenantSummary}>
                    <div className={styles.tenantIdentity}>
                      <strong>{tenant.name}</strong>
                      <span>{tenant.slug} · {userCounts.get(tenant.id)?.size ?? 0} pengguna</span>
                    </div>
                    <div className={styles.tenantStatus}>
                      <span className={tenant.status === "active" ? styles.active : styles.inactive}>{tenant.status === "active" ? "Aktif" : "Nonaktif"}</span>
                      <span className={health?.health_status === "healthy" ? styles.active : health?.health_status === "down" ? styles.inactive : styles.pending}>{!health ? "Belum diperiksa" : health.health_status === "healthy" ? "Normal" : health.health_status === "down" ? "Gangguan" : "Perlu perhatian"}</span>
                    </div>
                    <details className={styles.tenantDetails}>
                      <summary>Lihat / Kelola</summary>
                      <div className={styles.tenantDetailPanel}>
                        <div className={styles.detailGrid}>
                          <div><span>Nama perusahaan</span><strong>{tenant.name}</strong></div>
                          <div><span>Kode tenant</span><strong>{tenant.slug}</strong></div>
                          <div><span>Terdaftar</span><strong>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(tenant.created_at))}</strong></div>
                          <div><span>Pengguna aktif</span><strong>{userCounts.get(tenant.id)?.size ?? 0}</strong></div>
                          <div><span>Status tenant</span><strong>{tenant.status === "active" ? "Aktif" : "Nonaktif"}</strong></div>
                          <div><span>Pemeriksaan aplikasi</span><strong>{health ? (health.health_status === "healthy" ? "Normal" : health.health_status === "down" ? "Gangguan" : "Perlu perhatian") : "Belum ada data"}</strong></div>
                          <div><span>Pemeriksaan terakhir</span><strong>{health ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(health.checked_at)) : "—"}</strong></div>
                        </div>
                        <div className={styles.superadminManagement}>
                          <h3>Superadmin Tenant</h3>
                          {!superadmin ? <span className={styles.muted}>Belum ditetapkan</span> : (
                            <>
                              <div className={styles.adminIdentity}><strong>{superadmin.email}</strong><span className={superadmin.active ? styles.active : styles.inactive}>{superadmin.active ? "Aktif" : "Nonaktif"}</span></div>
                              <form action={updateTenantSuperadminEmail} className={styles.managementForm}>
                                <input type="hidden" name="tenantId" value={tenant.id} />
                                <input type="hidden" name="userId" value={superadmin.userId} />
                                <label>Email Superadmin<input type="email" name="email" defaultValue={superadmin.email} required aria-label="Email Superadmin baru" /></label>
                                <button type="submit">Simpan Email</button>
                              </form>
                              <form action={resetTenantSuperadminPassword} className={styles.managementForm}>
                                <input type="hidden" name="tenantId" value={tenant.id} />
                                <input type="hidden" name="userId" value={superadmin.userId} />
                                <label>Password baru<input type="password" name="password" placeholder="Minimal 10 karakter" minLength={10} required aria-label="Password baru Superadmin" /></label>
                                <button type="submit">Reset Password</button>
                              </form>
                              <form action={setTenantSuperadminActive} className={styles.statusForm}>
                                <input type="hidden" name="tenantId" value={tenant.id} />
                                <input type="hidden" name="userId" value={superadmin.userId} />
                                <input type="hidden" name="active" value={String(!superadmin.active)} />
                                <button type="submit" className={superadmin.active ? styles.deactivateButton : styles.activateButton}>{superadmin.active ? "Nonaktifkan Superadmin" : "Aktifkan Superadmin"}</button>
                              </form>
                            </>
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })}
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
          <div><h2>Buat Superadmin Tenant</h2><p>Platform Owner membuat Superadmin tenant. Email yang sudah terdaftar dapat digunakan kembali untuk tenant lain; password lama tetap berlaku.</p></div>
        </div>
        <form action={createTenantSuperadmin} className={styles.form}>
          <label>Perusahaan
            <select name="tenantId" required>
              <option value="">Pilih tenant</option>
              {tenantList.filter((tenant) => tenant.status === "active").map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
          <label>Email Superadmin<input name="email" type="email" placeholder="admin@perusahaan.com" required maxLength={254} /></label>
          <label>Password awal <span>(wajib hanya untuk email baru)</span><input name="password" type="password" placeholder="Kosongkan jika email sudah terdaftar" minLength={8} /></label>
          <button type="submit">Buat Akun Superadmin</button>
        </form>
      </section>
      <footer className={styles.footer}>Perubahan email mengubah alamat login akun yang sama di seluruh tenant yang terhubung. Menonaktifkan Superadmin hanya memutus aksesnya ke tenant ini, bukan menghapus akun atau data.</footer>
    </main>
  );
}
