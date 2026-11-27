"use client";

import { useMemo, useState } from "react";
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
  project_id: string;
  project: string;
  description: string;
  amount: number;
  status: string;
  created_at: string;
  created_by: string | null;
};

const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);
const date = (value: string) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeZone: "Asia/Jakarta",
}).format(new Date(value + (value.length === 10 ? "T00:00:00" : "")));

export default function ApManager({ enabled, documents, lines }: {
  enabled: boolean; documents: ApDocument[]; lines: ApLine[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Semua");
  const [selected, setSelected] = useState("");
  const visible = useMemo(() => documents.filter((item) => {
    const q = query.trim().toLowerCase();
    const matches = !q || [item.code, item.recipient_name, item.project, item.description]
      .some((value) => value?.toLowerCase().includes(q));
    return matches && (status === "Semua" || item.status === status);
  }), [documents, query, status]);
  const selectedDoc = documents.find((item) => item.id === selected);
  const selectedLines = lines.filter((line) => line.expense_id === selected).sort((a, b) => a.line_number - b.line_number);

  if (!enabled) return (
    <main className={styles.page}>
      <header className={styles.header}><div><p className={styles.eyebrow}>KEUANGAN</p><h1>AP / Hutang Supplier</h1><p>Dokumen kewajiban pembayaran kepada Supplier.</p></div></header>
      <section className={styles.notice}>
        <span className={styles.noticeIcon}>i</span>
        <div><h2>Fondasi database AP belum diaktifkan</h2>
          <p>Halaman ini disiapkan terpisah dari Pengeluaran lama. Data AP baru akan ditampilkan setelah migrasi fondasi AP disetujui, diterapkan, dan diverifikasi.</p>
          <small>Belum ada perubahan pada database produksi. Modul Pengeluaran lama tetap berjalan seperti sebelumnya.</small>
        </div>
      </section>
    </main>
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>KEUANGAN</p><h1>AP / Hutang Supplier</h1>
          <p>Daftar kewajiban pembayaran. Penerima dan Project dicatat sebagai informasi terpisah.</p>
        </div>
        <button className={styles.disabledButton} type="button" disabled title="Pembuatan Draft tersedia setelah layanan penyimpanan AP tahap berikutnya siap">+ Buat AP</button>
      </header>
      <section className={styles.summary}>
        <div><strong>{documents.length}</strong><span>Total Dokumen</span></div>
        <div><strong>{documents.filter((item) => item.status === "Menunggu Pembayaran" || item.status === "Partial").length}</strong><span>Belum Lunas</span></div>
        <div><strong>{money(documents.filter((item) => item.status !== "Dibatalkan").reduce((sum, item) => sum + Number(item.amount), 0))}</strong><span>Total AP Aktif</span></div>
      </section>
      <section className={styles.listCard}>
        <div className={styles.listHeading}><div><h2>Daftar AP</h2><p>{visible.length} dari {documents.length} dokumen</p></div>
          <div className={styles.filters}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode, penerima, Project..." aria-label="Cari AP" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter status">
              {["Semua", "Draft", "Menunggu Pembayaran", "Partial", "Dibayar", "Dibatalkan"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>
        {!visible.length ? <div className={styles.empty}><h3>{documents.length ? "AP tidak ditemukan" : "Belum ada dokumen AP"}</h3>
          <p>{documents.length ? "Ubah kata pencarian atau filter status." : "Dokumen AP akan muncul di sini setelah fitur pembuatan Draft diaktifkan."}</p>
        </div> : <div className={styles.tableWrap}><table><thead><tr><th>No. AP</th><th>Tanggal</th><th>Dibayarkan Kepada</th><th>Project</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id} className={selected === item.id ? styles.selected : ""} onClick={() => setSelected(selected === item.id ? "" : item.id)}>
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
      </section>}
      <p className={styles.footnote}>Data yang ditampilkan dibatasi ke Project dalam Area Kerja pengguna. Superadmin dapat melihat seluruh Project pada perusahaan aktif.</p>
    </main>
  );
}
