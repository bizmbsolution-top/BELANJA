"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { submitApDocument } from "./actions";
import ApForm from "./form";
import type { ApSupplierOption } from "./recipient-field";
import styles from "./ap.module.css";

export type ApLine = {
  id: string;
  expense_id: string;
  line_number: number;
  expense_category_id: string;
  description: string;
  amount: number;
  category_name: string;
};
export type ApDocument = {
  id: string;
  code: string;
  expense_date: string;
  recipient_name: string;
  recipient_supplier_id: string;
  project_id: string;
  project: string;
  sales_order_id: string | null;
  description: string;
  amount: number;
  status: string;
  created_at: string;
  created_by: string | null;
};
export type ApReference = {
  id: string;
  code: string;
  ba_number: string | null;
  project_id: string;
  ba_date: string | null;
  final_amount: number | null;
  customer_name: string;
};

const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);
const date = (value: string) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeZone: "Asia/Jakarta",
}).format(new Date(value + (value.length === 10 ? "T00:00:00" : "")));

export default function ApManager({
  enabled, documents, lines, suppliers = [], projects = [], categories = [], references = [],
  canCreateEdit = false, canSubmit = false,
}: {
  enabled: boolean;
  documents: ApDocument[];
  lines: ApLine[];
  suppliers?: ApSupplierOption[];
  projects?: { id: string; name: string }[];
  categories?: { id: string; name: string }[];
  references?: ApReference[];
  canCreateEdit?: boolean;
  canSubmit?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Semua");
  const [selected, setSelected] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const visible = useMemo(() => documents.filter((item) => {
    const q = query.trim().toLowerCase();
    const matches = !q || [item.code, item.recipient_name, item.project, item.description]
      .some((value) => value?.toLowerCase().includes(q));
    return matches && (status === "Semua" || item.status === status);
  }), [documents, query, status]);
  const selectedDoc = documents.find((item) => item.id === selected);
  const selectedLines = lines.filter((line) => line.expense_id === selected).sort((a, b) => a.line_number - b.line_number);

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }
  function saved() {
    closeForm();
    router.refresh();
  }
  async function submitSelected() {
    if (!selectedDoc) return;
    setSubmitting(true);
    setActionError("");
    const result = await submitApDocument(selectedDoc.id);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.refresh();
  }

  if (!enabled) return (
    <main className={styles.page}>
      <header className={styles.header}><div><p className={styles.eyebrow}>KEUANGAN</p><h1>Pengeluaran</h1><p>Pencatatan pengeluaran dan kewajiban pembayaran kepada Supplier.</p></div></header>
      <section className={styles.notice}>
        <span className={styles.noticeIcon}>i</span>
        <div><h2>Fitur Pengeluaran belum dapat dimuat</h2>
          <p>Data atau layanan Pengeluaran belum tersedia. Silakan muat ulang halaman atau hubungi Superadmin jika masalah berlanjut.</p>
          <small></small>
        </div>
      </section>
    </main>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>KEUANGAN</p><h1>Pengeluaran</h1>
          <p>Catat pengeluaran dan kewajiban pembayaran. Penerima dan Project dicatat terpisah.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.primaryButton} type="button" disabled={!canCreateEdit || !projects.length}
            title={!canCreateEdit ? "Akses tambah pengeluaran belum diberikan untuk akun ini" : !projects.length ? "Belum ada Project aktif pada Area Kerja" : undefined}
            onClick={() => { setEditing(null); setFormOpen(true); }}>+ Tambah Pengeluaran</button>
          <a href="/dashboard/pengeluaran" className={styles.footnote}>Buka voucher pengeluaran sebelumnya</a>
        </div>
      </header>
      {!canCreateEdit && <p className={styles.permissionNotice}>Akun Finance ini belum memiliki izin <strong>Tambah/Ubah Pengeluaran (ap.create_edit)</strong>. Minta Superadmin mengaktifkan izin tersebut pada Pengguna & Akses. Tombol dinonaktifkan untuk menjaga keamanan transaksi.</p>}
      {!projects.length && <p className={styles.permissionNotice}>Belum ada Project aktif dalam Area Kerja akun ini. Atur Scope Project melalui Pengguna & Akses.</p>}
      <section className={styles.summary}>
        <div><strong>{documents.length}</strong><span>Total Dokumen</span></div>
        <div><strong>{documents.filter((item) => item.status === "Menunggu Pembayaran" || item.status === "Partial").length}</strong><span>Belum Lunas</span></div>
        <div><strong>{money(documents.filter((item) => item.status !== "Dibatalkan").reduce((sum, item) => sum + Number(item.amount), 0))}</strong><span>Total AP Aktif</span></div>
      </section>
      <section className={styles.listCard}>
        <div className={styles.listHeading}><div><h2>Daftar Pengeluaran</h2><p>{visible.length} dari {documents.length} dokumen</p></div>
          <div className={styles.filters}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode, penerima, Project..." aria-label="Cari AP" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter status">
              {["Semua", "Draft", "Menunggu Pembayaran", "Partial", "Dibayar", "Dibatalkan"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>
        {!visible.length ? <div className={styles.empty}><h3>{documents.length ? "AP tidak ditemukan" : "Belum ada dokumen AP"}</h3>
          <p>{documents.length ? "Ubah kata pencarian atau filter status." : "Klik “Tambah Pengeluaran” untuk mulai mencatat kewajiban kepada Supplier."}</p>
        </div> : <div className={styles.tableWrap}><table><thead><tr><th>No. AP</th><th>Tanggal</th><th>Dibayarkan Kepada</th><th>Project</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id} className={selected === item.id ? styles.selected : ""} onClick={() => { setSelected(selected === item.id ? "" : item.id); setActionError(""); }}>
            <td><strong>{item.code}</strong></td><td>{date(item.expense_date)}</td><td>{item.recipient_name}</td><td>{item.project}</td><td className={styles.amount}>{money(Number(item.amount))}</td><td><span className={styles.status}>{item.status}</span></td>
          </tr>)}</tbody></table></div>}
      </section>
      {selectedDoc && <section className={styles.detail}>
        <div className={styles.listHeading}><div><h2>{selectedDoc.code}</h2><p>{selectedDoc.recipient_name} · {selectedDoc.project}</p></div><button type="button" className={styles.closeButton} onClick={() => setSelected("")}>Tutup</button></div>
        {selectedDoc.description && <p className={styles.description}>{selectedDoc.description}</p>}
        <div className={styles.tableWrap}><table><thead><tr><th>No.</th><th>Keterangan</th><th>Kategori</th><th>Nominal</th></tr></thead>
          <tbody>{selectedLines.map((line) => <tr key={line.id}><td>{line.line_number}</td><td>{line.description}</td><td>{line.category_name}</td><td className={styles.amount}>{money(Number(line.amount))}</td></tr>)}</tbody>
        </table></div>
        <strong className={styles.detailTotal}>Total AP: {money(Number(selectedDoc.amount))}</strong>
        {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
        {selectedDoc.status === "Draft" && <div className={styles.detailActions}>
          {canCreateEdit && <button type="button" className={styles.secondaryButton} onClick={() => { setEditing(selectedDoc); setFormOpen(true); }}>Ubah Draft</button>}
          {canSubmit && <button type="button" className={styles.primaryButton} disabled={submitting} onClick={submitSelected}>{submitting ? "Memproses..." : "Submit AP"}</button>}
        </div>}
      </section>}
      <p className={styles.footnote}>Data yang ditampilkan dibatasi ke Project dalam Area Kerja pengguna. Superadmin dapat melihat seluruh Project pada perusahaan aktif.</p>
      {formOpen && <ApForm
        suppliers={suppliers}
        projects={projects}
        categories={categories}
        references={references}
        document={editing}
        lines={editing ? lines.filter((line) => line.expense_id === editing.id) : []}
        onClose={closeForm}
        onSaved={saved}
      />}
    </main>
  );
}
