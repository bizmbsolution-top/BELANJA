"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cancelExpense, createExpense, deleteExpenseDocument, openExpenseDocument, uploadExpenseDocuments } from "./actions";
import styles from "./expenses.module.css";

export type ExpenseCategory = { id: string; code: string; name: string };
type Document = { id: string; file_name: string; mime_type: string; file_size: number; uploaded_at: string };
export type Expense = {
  id: string; code: string; expense_date: string; expense_category_id: string; description: string;
  amount: number; payment_method: string; status: "Aktif" | "Dibatalkan"; cancellation_reason: string | null;
  cancelled_at: string | null; created_at: string; expense_categories: { name: string } | null; expense_documents: Document[];
};
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(value + (value.length === 10 ? "T00:00:00" : "")));
const bytes = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
export default function ExpenseManager({ categories, initialItems }: { categories: ExpenseCategory[]; initialItems: Expense[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Semua");
  const [dateValue, setDateValue] = useState(new Date().toLocaleDateString("en-CA"));
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Transfer");
  const [busyId, setBusyId] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [uploadId, setUploadId] = useState("");
  const filtered = useMemo(() => initialItems.filter(item => {
    const q = query.trim().toLowerCase();
    const matches = !q || [item.code, item.description, item.expense_categories?.name, item.payment_method].some(value => value?.toLowerCase().includes(q));
    return matches && (status === "Semua" || item.status === status);
  }), [initialItems, query, status]);
  const active = initialItems.filter(item => item.status === "Aktif");
  const total = active.reduce((sum, item) => sum + Number(item.amount), 0);
  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const result = await createExpense({ expenseDate: dateValue, categoryId, description, amount, paymentMethod });
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage("Pengeluaran berhasil disimpan."); setShowForm(false); setCategoryId(""); setDescription(""); setAmount(""); router.refresh();
  }
  async function submitDocuments(expenseId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusyId(expenseId); setError(""); setMessage("");
    const result = await uploadExpenseDocuments(expenseId, data);
    setBusyId("");
    if (!result.ok) { setError(result.error); return; }
    setMessage("Dokumen billing berhasil ditambahkan."); form.reset(); setUploadId(""); router.refresh();
  }
  async function viewDocument(id: string) {
    const tab = window.open("about:blank", "_blank");
    setBusyId(id); const result = await openExpenseDocument(id); setBusyId("");
    if (!result.ok || !result.url) { tab?.close(); setError(result.error); return; }
    if (tab) tab.location.href = result.url; else window.location.href = result.url;
  }
  async function removeDocument(id: string) {
    if (!window.confirm("Hapus permanen dokumen ini dari transaksi dan penyimpanan?")) return;
    setBusyId(id); setError(""); setMessage("");
    const result = await deleteExpenseDocument(id); setBusyId("");
    if (!result.ok) { setError(result.error); return; }
    setMessage("Dokumen berhasil dihapus permanen."); router.refresh();
  }
  async function submitCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId(cancelId); setError(""); setMessage("");
    const result = await cancelExpense(cancelId, cancelReason); setBusyId("");
    if (!result.ok) { setError(result.error); return; }
    setMessage("Transaksi berhasil dibatalkan. Data tetap tersimpan."); setCancelId(""); setCancelReason(""); router.refresh();
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>OPERASIONAL</p><h1>Pengeluaran / Expenses</h1><p>Catat pengeluaran operasional dan lampirkan billing atau bukti pendukung.</p></div><button className={styles.primary} type="button" onClick={() => { setShowForm(v => !v); setError(""); }}>{showForm ? "Tutup Form" : "+ Tambah Pengeluaran"}</button></header>
    <section className={styles.summary}><div><strong>{initialItems.length}</strong><span>Total transaksi</span></div><div><strong>{active.length}</strong><span>Transaksi aktif</span></div><div><strong>{money(total)}</strong><span>Total pengeluaran aktif</span></div></section>
    {message && <p className={styles.success} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    {showForm && <section className={styles.panel}><h2>Tambah Pengeluaran</h2><p>Gudang tidak diperlukan untuk transaksi expenses.</p><form onSubmit={submitExpense} className={styles.form}>
      <label>Tanggal *<input required type="date" value={dateValue} onChange={e => setDateValue(e.target.value)} /></label>
      <label>Kategori *<select required value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Pilih kategori</option>{categories.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label className={styles.wide}>Keterangan / Keperluan *<textarea required maxLength={1000} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Contoh: Tiket pesawat perjalanan dinas ke Jakarta" /></label>
      <label>Nominal (Rp) *<input required type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" /></label>
      <label>Metode Pembayaran *<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Transfer</option><option>Tunai</option><option>Kartu</option><option>E-Wallet</option><option>Lainnya</option></select></label>
      <div className={styles.wide}><button className={styles.primary} disabled={saving || categories.length === 0}>{saving ? "Menyimpan..." : "Simpan Pengeluaran"}</button></div>
      {categories.length === 0 && <p className={styles.error}>Belum ada kategori expenses aktif. Aktifkan kategori terlebih dahulu.</p>}
    </form></section>}
    <section className={styles.panel}><div className={styles.listHead}><div><h2>Daftar Pengeluaran</h2><p>{filtered.length} transaksi ditampilkan · maksimal 200 terbaru</p></div><div className={styles.filters}><input aria-label="Cari pengeluaran" placeholder="Cari kode, keterangan, kategori..." value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Filter status" value={status} onChange={e => setStatus(e.target.value)}><option>Semua</option><option>Aktif</option><option>Dibatalkan</option></select></div></div>
    {!filtered.length ? <div className={styles.empty}><h3>Belum ada transaksi pengeluaran</h3><p>Tambahkan transaksi pertama untuk mulai mencatat expenses.</p></div> : <div className={styles.list}>{filtered.map(item => <article className={styles.item} key={item.id}>
      <div className={styles.itemTop}><div><span className={styles.code}>{item.code}</span><span className={item.status === "Aktif" ? styles.active : styles.cancelled}>{item.status}</span></div><time>{date(item.expense_date)}</time></div>
      <div className={styles.itemMain}><div><h3>{item.description}</h3><p>{item.expense_categories?.name ?? "Kategori tidak tersedia"} · {item.payment_method}</p></div><strong className={styles.amount}>{money(Number(item.amount))}</strong></div>
      {item.status === "Dibatalkan" && <p className={styles.cancelNote}>Dibatalkan: {item.cancellation_reason}</p>}
      <div className={styles.docs}><div className={styles.docsHead}><strong>Dokumen / Billing ({item.expense_documents?.length ?? 0})</strong>{item.status === "Aktif" && <form onSubmit={e => submitDocuments(item.id, e)}><label className={styles.fileButton}>+ Tambah Dokumen<input name="files" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple onChange={e => { if (e.target.files?.length) setUploadId(item.id); }} /></label>{uploadId === item.id && <button className={styles.smallPrimary} disabled={busyId === item.id}>{busyId === item.id ? "Mengunggah..." : "Unggah File"}</button>}</form>}</div>
      {(item.expense_documents ?? []).length > 0 && <div className={styles.docList}>{item.expense_documents.map(doc => <div className={styles.doc} key={doc.id}><span className={styles.fileIcon}>{doc.mime_type === "application/pdf" ? "PDF" : "IMG"}</span><span className={styles.fileName}><strong>{doc.file_name}</strong><small>{bytes(Number(doc.file_size))}</small></span><button type="button" onClick={() => viewDocument(doc.id)} disabled={busyId === doc.id}>Lihat</button><button type="button" className={styles.delete} onClick={() => removeDocument(doc.id)} disabled={busyId === doc.id}>Hapus</button></div>)}</div>}
      </div>
      {item.status === "Aktif" && <div className={styles.itemActions}>{cancelId === item.id ? <form onSubmit={submitCancel} className={styles.cancelForm}><label>Alasan pembatalan *<textarea required maxLength={500} rows={2} value={cancelReason} onChange={e => setCancelReason(e.target.value)} /></label><button className={styles.danger} disabled={busyId === item.id}>{busyId === item.id ? "Memproses..." : "Konfirmasi Pembatalan"}</button><button type="button" onClick={() => { setCancelId(""); setCancelReason(""); }}>Kembali</button></form> : <button type="button" className={styles.cancelButton} onClick={() => { setCancelId(item.id); setError(""); }}>Batalkan Transaksi</button>}</div>}
    </article>)}</div>}</section>
    <p className={styles.note}>Transaksi Expenses tidak dapat dihapus permanen. Pembatalan menyimpan data dan alasan pembatalan. Dokumen billing dapat dihapus permanen dari penyimpanan.</p>
  </main>;
}
