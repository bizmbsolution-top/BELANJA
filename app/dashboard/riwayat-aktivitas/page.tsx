import { requireOwner } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./activity.module.css";

type Snapshot = Record<string, unknown> | null;
type AuditRow = {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: Snapshot;
  after_data: Snapshot;
  created_at: string;
};

const actionLabels: Record<string, string> = {
  "user.created": "Pengguna dibuat",
  "user.access_updated": "Akses pengguna diperbarui",
  "user.email_update_requested": "Permintaan perubahan email",
  "user.email_updated": "Email pengguna diperbarui",
  "user.email_update_failed": "Perubahan email gagal",
  "user.password_reset_requested": "Permintaan reset password",
  "user.password_reset": "Password direset",
  "user.password_reset_failed": "Reset password gagal",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function snapshotLines(snapshot: Snapshot): string[] {
  if (!snapshot) return [];
  const lines: string[] = [];

  if (Array.isArray(snapshot.roles)) lines.push(`Role: ${snapshot.roles.join(", ") || "Tidak ada"}`);
  if (typeof snapshot.is_active === "boolean") lines.push(`Status: ${snapshot.is_active ? "Aktif" : "Nonaktif"}`);

  if (snapshot.email && typeof snapshot.email === "string") lines.push(`Email: ${snapshot.email}`);
  if (snapshot.requested_email && typeof snapshot.requested_email === "string") lines.push(`Email diminta: ${snapshot.requested_email}`);

  const scopes = snapshot.scopes;
  if (scopes && typeof scopes === "object" && !Array.isArray(scopes)) {
    const scopeRecord = scopes as Record<string, { scope_mode?: string }>;
    const labels = Object.entries(scopeRecord).map(([key, value]) =>
      `${key}: ${value?.scope_mode === "all" ? "Semua" : value?.scope_mode === "selected" ? "Dipilih" : "Tidak ada"}`
    );
    if (labels.length) lines.push(`Area kerja: ${labels.join(" · ")}`);
  }

  const permissions = snapshot.permissions;
  if (permissions && typeof permissions === "object" && !Array.isArray(permissions)) {
    const permissionRecord = permissions as Record<string, string>;
    const labels = Object.entries(permissionRecord).map(([key, value]) => `${key}: ${value}`);
    if (labels.length) lines.push(`Permission: ${labels.join(" · ")}`);
  }

  return lines;
}

export default async function ActivityHistoryPage() {
  await requireOwner();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("audit_logs")
    .select("id, actor_user_id, target_user_id, action, entity_type, entity_id, before_data, after_data, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error("Riwayat aktivitas gagal dimuat.");
  }

  const rows = (data ?? []) as AuditRow[];
  const { data: userData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((userData?.users ?? []).map((user) => [user.id, user.email ?? user.id] as const));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMINISTRASI OWNER</p>
          <h1>Riwayat Aktivitas</h1>
          <p>Catatan perubahan administrasi pengguna di Belanja.</p>
        </div>
        <a href="/dashboard/pengguna" className={styles.backLink}>Pengaturan Pengguna</a>
      </header>

      <section className={styles.summary}>
        <strong>{rows.length}</strong>
        <span>aktivitas terbaru ditampilkan · maksimal 200 catatan</span>
      </section>

      {rows.length === 0 ? (
        <section className={styles.empty}>
          <h2>Belum ada aktivitas tercatat</h2>
          <p>Perubahan pengguna berikutnya akan muncul di halaman ini.</p>
        </section>
      ) : (
        <section className={styles.list} aria-label="Daftar riwayat aktivitas">
          {rows.map((row) => {
            const beforeLines = snapshotLines(row.before_data);
            const afterLines = snapshotLines(row.after_data);
            return (
              <article className={styles.item} key={row.id}>
                <div className={styles.itemTop}>
                  <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
                  <span className={styles.action}>{actionLabels[row.action] ?? row.action}</span>
                </div>
                <div className={styles.people}>
                  <div><small>DILAKUKAN OLEH</small><strong>{row.actor_user_id ? emailById.get(row.actor_user_id) ?? row.actor_user_id : "Akun dihapus"}</strong></div>
                  <div><small>PENGGUNA TERKAIT</small><strong>{row.target_user_id ? emailById.get(row.target_user_id) ?? row.target_user_id : "Tidak tersedia"}</strong></div>
                </div>
                {(beforeLines.length > 0 || afterLines.length > 0) && (
                  <details className={styles.details}>
                    <summary>Lihat ringkasan perubahan</summary>
                    <div className={styles.changeGrid}>
                      <div><strong>Sebelum</strong>{beforeLines.length ? beforeLines.map((line) => <p key={line}>{line}</p>) : <p>—</p>}</div>
                      <div><strong>Sesudah / diminta</strong>{afterLines.length ? afterLines.map((line) => <p key={line}>{line}</p>) : <p>—</p>}</div>
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
