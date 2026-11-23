"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createFundRequest, executeFundRequest, openFundRequestDocument, uploadFundRequestDocuments } from "./actions";
import styles from "./funds.module.css";

export type ProjectOption = { id: string; code: string; name: string };
type FundDocument = { id: string; file_name: string; mime_type: string; file_size: number; uploaded_at: string };
export type FundRequest = {
  id: string; code: string; project_id: string; request_amount: number; purpose: string; status: "Menunggu Eksekusi" | "Selesai";
  requested_at: string; requested_by: string; executed_amount: number | null; payment_method: string | null;
  execution_note: string | null; executed_at: string | null; executed_by: string | null;
  projects: { name: string; code: string } | null; fund_request_documents: FundDocument[];
};
const money = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);
const amountInput = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dateTime = (v: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(v));
const size = (v: number) => v < 1048576 ? `${Math.max(1, Math.round(v / 1024))} KB` : `${(v / 1048576).toFixed(1)} MB`;

export default function FundRequestManager({ projects, requestProjects, initialRequests, balances, canRequest, canExecute }: {
  projects: ProjectOption[]; requestProjects: ProjectOption[]; initialRequests: FundRequest[]; balances: Record<string, number>;
  canRequest: boolean; canExecute: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [projectId, setProjectId] = useState(requestProjects[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [executeId, setExecuteId] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [method, setMethod] = useState("Transfer");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("Semua");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => initialRequests.filter(r => {
    const q = query.trim().toLowerCase();
    return (filter === "Semua" || r.status === filter) &&
      (!q || [r.code, r.purpose, r.projects?.name].some(v => v?.toLowerCase().includes(q)));
  }), [initialRequests, filter, query]);
  async function submitRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy("new"); setError(""); setMessage("");
    const result = await createFundRequest({ projectId, amount: amount.replace(/\./g, ""), purpose });
    setBusy("");
    if (!result.ok) { setError(result.error); return; }
    setMessage("Permintaan dana berhasil diajukan ke Finance."); setShowForm(false); setAmount(""); setPurpose(""); router.refresh();
  }
  async function openEvidence(id: string) {
    const tab = window.open("about:blank", "_blank"); setBusy(id);
    const result = await openFundRequestDocument(id); setBusy("");
    if (!result.ok || !result.url) { tab?.close(); setError(result.ok ? "Tautan bukti tidak tersedia." : result.error); return; }
    if (tab) tab.location.href = result.url; else window.location.href = result.url;
  }
  async function submitExecution(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(executeId); setError(""); setMessage("");
    const evidence = new FormData(form);
    const selectedFiles = evidence.getAll("files").filter((v): v is File => v instanceof File && v.size > 0);
    if (selectedFiles.length) {
      const upload = await uploadFundRequestDocuments(executeId, evidence);
      if (!upload.ok) { setBusy(""); setError(upload.error); return; }
    }
    const result = await executeFundRequest({ requestId: executeId, amount: actualAmount.replace(/\./g, ""), paymentMethod: method, note });
    setBusy("");
    if (!result.ok) { setError(result.error); router.refresh(); return; }
    setMessage("Dana berhasil dieksekusi. Status berubah menjadi Telah Dieksekusi dan saldo Project bertambah.");
    setExecuteId(""); setActualAmount(""); setNote(""); router.refresh();
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>KAS & OPERASIONAL</p><h1>Permintaan Dana Kasir</h1><p>Kasir mengajukan dana berdasarkan Project. Finance mencatat penyerahan dan menambah saldo Project.</p></div>
      {canRequest && <button className={styles.primary} type="button" onClick={() => setShowForm(v => !v)}>{showForm ? "Tutup Form" : "+ Ajukan Dana"}</button>}
    </header>
    <section className={styles.balances}><div className={styles.balanceTitle}><h2>Saldo Kasir per Project</h2><span>Saldo bertambah setelah Finance mengeksekusi penyerahan dana.</span></div>
      {projects.length ? <div className={styles.balanceGrid}>{projects.map(p => <article key={p.id}><small>{p.code}</small><strong>{money(balances[p.id] ?? 0)}</strong><span>{p.name}</span></article>)}</div> : <p className={styles.empty}>Belum ada Project aktif yang menjadi area kerja akun ini.</p>}
    </section>
    {message && <p className={styles.success} role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    {showForm && <section className={styles.panel}><h2>Ajukan Permintaan Dana</h2><p>Permintaan akan masuk ke antrean Finance. Saldo belum berubah sampai dana benar-benar diserahkan.</p>{!requestProjects.length && <p className={styles.error}>Belum ada Project yang ditetapkan sebagai area kerja Kasir. Hubungi Owner.</p>}
      <form className={styles.form} onSubmit={submitRequest}>
        <label>Project *<select required value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Pilih Project</option>{requestProjects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label>Nominal yang Diminta (Rp) *<input required inputMode="numeric" value={amount} onChange={e => setAmount(amountInput(e.target.value))} placeholder="0" /></label>
        <label className={styles.wide}>Tujuan / Keperluan Dana *<textarea required maxLength={1000} rows={3} value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Jelaskan kebutuhan dana kasir..." /></label>
        <div className={styles.wide}><button className={styles.primary} disabled={busy === "new" || !requestProjects.length}>{busy === "new" ? "Mengirim..." : "Kirim Permintaan ke Finance"}</button></div>
      </form>
    </section>}
    <section className={styles.panel}><div className={styles.listHead}><div><h2>Riwayat Permintaan Dana</h2><p>{filtered.length} permintaan ditampilkan · maksimal 300 terbaru</p></div><div className={styles.filters}><input placeholder="Cari kode, Project, keperluan..." value={query} onChange={e => setQuery(e.target.value)} /><select value={filter} onChange={e => setFilter(e.target.value)}><option value="Semua">Semua</option><option value="Menunggu Eksekusi">Menunggu Eksekusi</option><option value="Selesai">Telah Dieksekusi</option></select></div></div>
      {!filtered.length ? <div className={styles.empty}><h3>Belum ada permintaan dana</h3><p>Permintaan yang diajukan Kasir akan tampil di sini.</p></div> :
      <div className={styles.list}>{filtered.map(r => <article className={styles.item} key={r.id}>
        <div className={styles.itemTop}><div><strong className={styles.code}>{r.code}</strong><span className={r.status === "Selesai" ? styles.done : styles.pending}>{r.status === "Selesai" ? "Telah Dieksekusi" : "Menunggu Eksekusi"}</span></div><time>{dateTime(r.requested_at)}</time></div>
        <div className={styles.details}><div><small>PROJECT</small><strong>{r.projects?.code} · {r.projects?.name}</strong></div><div><small>NOMINAL DIMINTA</small><strong>{money(Number(r.request_amount))}</strong></div></div>
        <p className={styles.purpose}>{r.purpose}</p>
        {r.status === "Selesai" && <div className={styles.executed}><div><small>DANA DISERAHKAN</small><strong>{money(Number(r.executed_amount))}</strong></div><div><small>METODE</small><strong>{r.payment_method}</strong></div><div><small>WAKTU EKSEKUSI</small><strong>{r.executed_at ? dateTime(r.executed_at) : "—"}</strong></div></div>}
        {r.execution_note && <p className={styles.note}>Catatan Finance: {r.execution_note}</p>}
        <div className={styles.evidence}><div className={styles.evidenceHead}><strong>Bukti Transfer / Penyerahan ({r.fund_request_documents?.length ?? 0})</strong></div>
        {!!r.fund_request_documents?.length && <div className={styles.docs}>{r.fund_request_documents.map(d => <div className={styles.doc} key={d.id}><span>{d.mime_type === "application/pdf" ? "PDF" : "IMG"}</span><div><strong>{d.file_name}</strong><small>{size(d.file_size)}</small></div><button type="button" disabled={busy === d.id} onClick={() => openEvidence(d.id)}>Lihat</button></div>)}</div>}
        </div>
        {canExecute && r.status === "Menunggu Eksekusi" && <div className={styles.executeArea}>{executeId === r.id ? <form className={styles.executeForm} onSubmit={submitExecution}>
          <h3>Eksekusi Penyerahan Dana</h3><p>Nominal aktual tidak boleh kurang dari {money(Number(r.request_amount))}. Finance dapat melampirkan bukti transfer atau penyerahan uang pada formulir ini.</p>
          <label>Nominal Aktual Diserahkan (Rp) *<input required inputMode="numeric" value={actualAmount} onChange={e => setActualAmount(amountInput(e.target.value))} placeholder="0" /></label>
          <label>Metode Penyerahan *<select value={method} onChange={e => setMethod(e.target.value)}><option>Transfer</option><option>Tunai</option></select></label>
          <label className={styles.wide}>Bukti Transfer / Penyerahan (PDF, JPG, PNG)<input type="file" name="files" accept="application/pdf,image/jpeg,image/png" multiple /></label>
          <label className={styles.wide}>Catatan (opsional)<textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Referensi transfer atau catatan penyerahan" /></label>
          <div className={styles.actions}><button className={styles.primary} disabled={busy === r.id}>{busy === r.id ? "Memproses..." : "Konfirmasi Dana Diserahkan"}</button><button type="button" className={styles.secondary} onClick={() => setExecuteId("")}>Batal</button></div>
        </form> : <div className={styles.actions}><button className={styles.primary} type="button" onClick={() => {setExecuteId(r.id);setActualAmount(String(r.request_amount));setError("");}}>Eksekusi / Serahkan Dana</button></div>}</div>}
      </article>)}</div>}
    </section>
    <p className={styles.footnote}>Saldo Kasir adalah saldo bersama per Project, bukan saldo pribadi per user. Penambahan saldo dicatat saat Finance mengonfirmasi dana benar-benar diserahkan. Bukti tersimpan secara privat dan hanya dapat dibuka oleh pengguna yang berwenang.</p>
  </main>;
}
