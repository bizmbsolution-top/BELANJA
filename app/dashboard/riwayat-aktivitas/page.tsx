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
  "supplier.created": "Supplier dibuat",
  "supplier.updated": "Supplier diperbarui",
  "purchase_category.created": "Kategori pembelian dibuat",
  "purchase_category.updated": "Kategori pembelian diperbarui",
  "warehouse.created": "Gudang dibuat",
  "project.created": "Project dibuat",
  "project.updated": "Project diperbarui",
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
  "fund_request.created": "Permintaan dana kasir diajukan",
  "fund_request.executed": "Dana kasir diserahkan oleh Finance",
  "fund_request_document.uploaded": "Bukti penyerahan dana diunggah",
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

  if (snapshot.code && typeof snapshot.code === "string") lines.push(`${snapshot.code.startsWith("KAT-") ? "Kode kategori pembelian" : snapshot.code.startsWith("GDG-") ? "Kode gudang" : snapshot.code.startsWith("EXP-") ? "Kode kategori expenses" : snapshot.code.startsWith("UOM-") ? "Kode UOM" : snapshot.code.startsWith("PRJ-") ? "Kode Project" : "Kode supplier"}: ${snapshot.code}`);
  if (snapshot.name && typeof snapshot.name === "string") lines.push(`${snapshot.code && typeof snapshot.code === "string" && (snapshot.code.startsWith("KAT-") || snapshot.code.startsWith("EXP-")) ? "Nama kategori" : snapshot.code && typeof snapshot.code === "string" && snapshot.code.startsWith("GDG-") ? "Nama gudang" : snapshot.code && typeof snapshot.code === "string" && snapshot.code.startsWith("UOM-") ? "Nama satuan" : snapshot.code && typeof snapshot.code === "string" && snapshot.code.startsWith("PRJ-") ? "Nama Project" : "Nama supplier"}: ${snapshot.name}`);
  if (snapshot.description && typeof snapshot.description === "string") lines.push(`Keterangan: ${snapshot.description}`);
  if (snapshot.location && typeof snapshot.location === "string") lines.push(`Lokasi: ${snapshot.location}`);
  if (snapshot.symbol && typeof snapshot.symbol === "string") lines.push(`Simbol: ${snapshot.symbol}`);
  if (snapshot.contact_person && typeof snapshot.contact_person === "string") lines.push(`Kontak: ${snapshot.contact_person}`);
  if (snapshot.phone && typeof snapshot.phone === "string") lines.push(`Telepon: ${snapshot.phone}`);
  if (snapshot.email && typeof snapshot.email === "string") lines.push(`Email: ${snapshot.email}`);
  if (snapshot.address && typeof snapshot.address === "string") lines.push(`Alamat: ${snapshot.address}`);
  if (snapshot.notes && typeof snapshot.notes === "string") lines.push(`Catatan: ${snapshot.notes}`);
  if (snapshot.requested_email && typeof snapshot.requested_email === "string") lines.push(`Email diminta: ${snapshot.requested_email}`);
  if (snapshot.expense_date && typeof snapshot.expense_date === "string") lines.push(`Tanggal pengeluaran: ${snapshot.expense_date}`);
  if (snapshot.category && typeof snapshot.category === "string") lines.push(`Kategori: ${snapshot.category}`);
  if (snapshot.amount !== undefined) lines.push(`Nominal: Rp ${Number(snapshot.amount).toLocaleString("id-ID")}`);
  if (snapshot.paid_amount !== undefined) lines.push(`Nominal dibayar: Rp ${Number(snapshot.paid_amount).toLocaleString("id-ID")}`);
  if (snapshot.project_code && typeof snapshot.project_code === "string") lines.push(`Kode Project: ${snapshot.project_code}`);
  if (snapshot.payment_method && typeof snapshot.payment_method === "string" && snapshot.paid_amount !== undefined) lines.push(`Metode pembayaran: ${snapshot.payment_method}`);
  if (snapshot.request_amount !== undefined) lines.push(`Nominal diminta: Rp ${Number(snapshot.request_amount).toLocaleString("id-ID")}`);
  if (snapshot.executed_amount !== undefined) lines.push(`Nominal diserahkan: Rp ${Number(snapshot.executed_amount).toLocaleString("id-ID")}`);
  if (snapshot.project_name && typeof snapshot.project_name === "string") lines.push(`Project: ${snapshot.project_name}`);
  if (snapshot.purpose && typeof snapshot.purpose === "string") lines.push(`Tujuan dana: ${snapshot.purpose}`);
  if (snapshot.payment_method && typeof snapshot.payment_method === "string") lines.push(`Pembayaran: ${snapshot.payment_method}`);
  if (snapshot.reason && typeof snapshot.reason === "string") lines.push(`Alasan: ${snapshot.reason}`);
  if (snapshot.expense_code && typeof snapshot.expense_code === "string") lines.push(`Transaksi: ${snapshot.expense_code}`);
  if (snapshot.file_name && typeof snapshot.file_name === "string") lines.push(`Dokumen: ${snapshot.file_name}`);
  if (snapshot.payment_method && typeof snapshot.payment_method === "string") lines.push(`Metode penyerahan: ${snapshot.payment_method}`);

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
          <p>Catatan aktivitas seluruh pengguna dan perubahan data master yang sudah terhubung ke Audit Log.</p>
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
                  <div><small>{row.entity_type === "supplier" ? "DATA SUPPLIER" : row.entity_type === "purchase_category" ? "KATEGORI PEMBELIAN" : row.entity_type === "warehouse" ? "GUDANG" : row.entity_type === "project" ? "PROJECT" : row.entity_type === "expense_category" ? "KATEGORI EXPENSES" : row.entity_type === "uom" ? "UOM / SATUAN" : row.entity_type === "expense" ? "PENGELUARAN" : row.entity_type === "expense_document" ? "DOKUMEN BILLING" : row.entity_type === "fund_request" ? "PERMINTAAN DANA KASIR" : row.entity_type === "fund_request_document" ? "BUKTI PENYERAHAN DANA" : row.entity_type === "user_access" ? "PENGATURAN AKSES" : "PENGGUNA TERKAIT"}</small><strong>{row.entity_type === "supplier" || row.entity_type === "purchase_category" || row.entity_type === "warehouse" || row.entity_type === "project" || row.entity_type === "expense_category" || row.entity_type === "uom" ? String(row.after_data?.name ?? row.before_data?.name ?? row.entity_id ?? "Data master") : row.entity_type === "expense" ? String(row.after_data?.code ?? row.before_data?.code ?? row.entity_id ?? "Pengeluaran") : row.entity_type === "expense_document" || row.entity_type === "fund_request_document" ? String(row.before_data?.file_name ?? row.after_data?.file_name ?? row.entity_id ?? "Dokumen") : row.entity_type === "fund_request" ? String(row.after_data?.code ?? row.entity_id ?? "Permintaan dana") : row.target_user_id ? emailById.get(row.target_user_id) ?? row.target_user_id : "Tidak tersedia"}</strong></div>
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
