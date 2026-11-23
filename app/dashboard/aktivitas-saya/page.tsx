import { requireActiveUser } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "../riwayat-aktivitas/activity.module.css";

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
  "user.email_updated": "Email diperbarui",
  "user.email_update_failed": "Perubahan email gagal",
  "user.password_reset_requested": "Permintaan reset password",
  "user.password_reset": "Password direset",
  "user.password_reset_failed": "Reset password gagal",
  "supplier.created": "Supplier dibuat",
  "supplier.updated": "Supplier diperbarui",
  "purchase_category.created": "Kategori pembelian dibuat",
  "purchase_category.updated": "Kategori pembelian diperbarui",
  "warehouse.created": "Gudang dibuat",
  "warehouse.updated": "Gudang diperbarui",
  "expense_category.created": "Kategori expenses dibuat",
  "expense_category.updated": "Kategori expenses diperbarui",
  "uom.created": "Satuan dibuat",
  "uom.updated": "Satuan diperbarui",
  "expense.created": "Draft voucher Expenses dibuat",
  "expense.updated": "Draft voucher Expenses diperbarui",
  "expense.submitted": "Voucher Expenses dikirim ke Kasir",
  "expense.paid": "Voucher Expenses dibayar oleh Kasir",
  "expense.cancelled": "Pengeluaran dibatalkan",
  "expense_document.uploaded": "Dokumen billing diunggah",
  "expense_document.deleted": "Dokumen billing dihapus",
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
  if (typeof snapshot.code === "string") lines.push(`Kode: ${snapshot.code}`);
  if (typeof snapshot.name === "string") lines.push(`Nama: ${snapshot.name}`);
  if (typeof snapshot.contact_person === "string") lines.push(`Kontak: ${snapshot.contact_person}`);
  if (typeof snapshot.phone === "string") lines.push(`Telepon: ${snapshot.phone}`);
  if (typeof snapshot.email === "string") lines.push(`Email: ${snapshot.email}`);
  if (typeof snapshot.address === "string") lines.push(`Alamat: ${snapshot.address}`);
  if (typeof snapshot.notes === "string") lines.push(`Catatan: ${snapshot.notes}`);
  if (typeof snapshot.description === "string") lines.push(`Keterangan: ${snapshot.description}`);
  if (typeof snapshot.location === "string") lines.push(`Lokasi: ${snapshot.location}`);
  if (typeof snapshot.symbol === "string") lines.push(`Simbol: ${snapshot.symbol}`);
  if (typeof snapshot.requested_email === "string") lines.push(`Email diminta: ${snapshot.requested_email}`);
  if (typeof snapshot.expense_date === "string") lines.push(`Tanggal pengeluaran: ${snapshot.expense_date}`);
  if (typeof snapshot.category === "string") lines.push(`Kategori: ${snapshot.category}`);
  if (typeof snapshot.amount === "number" || typeof snapshot.amount === "string") lines.push(`Nominal: Rp ${Number(snapshot.amount).toLocaleString("id-ID")}`);
  if (typeof snapshot.paid_amount === "number" || typeof snapshot.paid_amount === "string") lines.push(`Nominal dibayar: Rp ${Number(snapshot.paid_amount).toLocaleString("id-ID")}`);
  if (typeof snapshot.project_code === "string") lines.push(`Kode Project: ${snapshot.project_code}`);
  if (typeof snapshot.payment_method === "string") lines.push(`Pembayaran: ${snapshot.payment_method}`);
  if (typeof snapshot.reason === "string") lines.push(`Alasan: ${snapshot.reason}`);
  if (typeof snapshot.expense_code === "string") lines.push(`Transaksi: ${snapshot.expense_code}`);
  if (typeof snapshot.file_name === "string") lines.push(`Dokumen: ${snapshot.file_name}`);
  return lines;
}

function targetLabel(row: AuditRow) {
  if (row.entity_type === "purchase_category") {
    return String(row.after_data?.name ?? row.before_data?.name ?? row.entity_id ?? "Kategori pembelian");
  }
  if (row.entity_type === "expense_category" || row.entity_type === "uom") return String(row.after_data?.name ?? row.before_data?.name ?? row.entity_id ?? "Data master");
  if (row.entity_type === "warehouse") return String(row.after_data?.name ?? row.before_data?.name ?? row.entity_id ?? "Gudang");
  if (row.entity_type === "supplier") {
    return String(row.after_data?.name ?? row.before_data?.name ?? row.entity_id ?? "Supplier");
  }
  if (row.entity_type === "expense") return String(row.after_data?.code ?? row.before_data?.code ?? row.entity_id ?? "Pengeluaran");
  if (row.entity_type === "expense_document") return String(row.before_data?.file_name ?? row.after_data?.file_name ?? row.entity_id ?? "Dokumen billing");
  if (row.entity_type === "user_access") return "Pengaturan akses pengguna";
  if (row.entity_type === "auth_user") return "Akun pengguna";
  return row.entity_id ?? row.entity_type;
}

export default async function MyActivityPage() {
  const actor = await requireActiveUser();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audit_logs")
    .select("id, actor_user_id, target_user_id, action, entity_type, entity_id, before_data, after_data, created_at").eq("tenant_id", actor.tenantId)
    .or(`actor_user_id.eq.${actor.userId},target_user_id.eq.${actor.userId}`)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error("Riwayat aktivitas Anda gagal dimuat.");
  const rows = (data ?? []) as AuditRow[];
  const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((authUsers?.users ?? []).map((user) => [user.id, user.email ?? user.id] as const));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AKTIVITAS AKUN</p>
          <h1>Aktivitas Saya</h1>
          <p>Aktivitas yang dilakukan oleh akun Anda dan perubahan yang berkaitan dengan akun Anda.</p>
        </div>
      </header>
      <section className={styles.summary}>
        <strong>{rows.length}</strong>
        <span>aktivitas terbaru ditampilkan · maksimal 200 catatan</span>
      </section>
      {rows.length === 0 ? (
        <section className={styles.empty}>
          <h2>Belum ada aktivitas tercatat</h2>
          <p>Aktivitas penting yang sudah terhubung ke Audit Log akan muncul di sini.</p>
        </section>
      ) : (
        <section className={styles.list} aria-label="Aktivitas saya">
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
                  <div><small>OBJEK AKTIVITAS</small><strong>{targetLabel(row)}</strong></div>
                  <div><small>DILAKUKAN OLEH</small><strong>{row.actor_user_id === actor.userId ? "Anda" : row.actor_user_id ? emailById.get(row.actor_user_id) ?? row.actor_user_id : "Sistem"}</strong></div>
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
