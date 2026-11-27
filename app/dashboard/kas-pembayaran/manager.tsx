"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postApCashierPayment } from "./actions";
import styles from "./payments.module.css";

export type CashierAp = {
  id: string; code: string; expense_date: string; recipient_name: string;
  project_id: string; project_name: string; amount: number; status: string;
};
export type CashierPayment = {
  id: string; expense_id: string; payment_date: string; amount: number;
  payment_reference: string | null; notes: string | null; created_at: string;
};

const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);
const date = (value: string) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeZone: "Asia/Jakarta",
}).format(new Date(value.length === 10 ? value + "T00:00:00" : value));

export default function CashierPaymentManager({
  documents, payments, balances, canPost, today,
}: {
  documents: CashierAp[];
  payments: CashierPayment[];
  balances: Record<string, number>;
  canPost: boolean;
  today: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Belum Lunas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const paymentTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const payment of payments) totals[payment.expense_id] = (totals[payment.expense_id] ?? 0) + Number(payment.amount);
    return totals;
  }, [payments]);
  const visible = useMemo(() => documents.filter((doc) => {
    const q = query.trim().toLowerCase();
    const matches = !q || [doc.code, doc.recipient_name, doc.project_name].some((value) => value.toLowerCase().includes(q));
    const remaining = Number(doc.amount) - (paymentTotals[doc.id] ?? 0);
    return matches && (filter === "Semua" || (filter === "Belum Lunas" && remaining > 0) || (filter === "Lunas" && remaining <= 0));
  }), [documents, filter, paymentTotals, query]);
  const selected = documents.find((doc) => doc.id === selectedId) ?? null;
  const selectedPaid = selected ? paymentTotals[selected.id] ?? 0 : 0;
  const selectedOutstanding = selected ? Math.max(0, Number(selected.amount) - selectedPaid) : 0;
  const selectedPayments = selected ? payments.filter((payment) => payment.expense_id === selected.id).sort((a,b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at)) : [];

  function openPayment(doc: CashierAp) {
    setSelectedId(doc.id);
    setAmount(String(Math.max(0, Number(doc.amount) - (paymentTotals[doc.id] ?? 0))));
    setPaymentDate(today);
    setReference("");
    setNotes("");
    setError("");
    setSuccess("");
  }
  function closePayment() {
    setSelectedId(null);
    setError("");
    setSuccess("");
  }
  async function submitPayment() {
    if (!selected) return;
    const numericAmount = Number(amount.replace(/\D/g, ""));
    setSaving(true); setError(""); setSuccess("");
    const result = await postApCashierPayment({
      expenseId: selected.id, paymentDate, amount: numericAmount,
      reference: reference.trim(), notes: notes.trim(),
    });
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    setSuccess("Pembayaran berhasil dicatat dan saldo Kasir diperbarui.");
    setAmount(""); setReference(""); setNotes("");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>KEUANGAN · KASIR</p><h1>Kas & Pembayaran</h1>
          <p>Catat pembayaran tunai untuk kewajiban Pengeluaran (AP) dan pantau riwayatnya.</p>
        </div>
      </header>

      <section className={styles.notice}>
        <strong>Pembayaran tunai melalui Kasir</strong>
        <p>Setiap pembayaran mengurangi saldo Kasir Project satu kali. Pembayaran bertahap diperbolehkan selama tidak melebihi sisa kewajiban. Transfer langsung dari Bank akan diaktifkan pada tahap rekening Bank.</p>
      </section>

      <section className={styles.summary}>
        <article><span>AP Menunggu Pembayaran</span><strong>{documents.length}</strong></article>
        <article><span>Total Sisa Kewajiban</span><strong>{money(documents.reduce((sum, doc) => sum + Math.max(0, Number(doc.amount) - (paymentTotals[doc.id] ?? 0)), 0))}</strong></article>
        <article><span>Saldo Kasir Project</span><strong>{money(Object.values(balances).reduce((sum, value) => sum + value, 0))}</strong></article>
      </section>

      {!canPost && <p className={styles.warning}>Akun ini hanya dapat melihat data. Untuk mencatat pembayaran, gunakan Role Cashier dengan izin <strong>payment.post</strong> yang aktif.</p>}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><h2>Daftar AP Menunggu Pembayaran</h2><p>{visible.length} dokumen ditampilkan</p></div>
          <div className={styles.filters}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari kode, penerima, Project..." aria-label="Cari AP" />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter pembayaran">
              <option>Belum Lunas</option><option>Lunas</option><option>Semua</option>
            </select>
          </div>
        </div>
        {!visible.length ? <div className={styles.empty}><h3>Tidak ada AP yang sesuai</h3><p>AP yang sudah disubmit dan belum lunas akan muncul di sini.</p></div> :
          <div className={styles.cards}>
            {visible.map((doc) => {
              const paid = paymentTotals[doc.id] ?? 0;
              const outstanding = Math.max(0, Number(doc.amount) - paid);
              return <article className={styles.apCard} key={doc.id}>
                <div className={styles.cardTop}>
                  <div><strong>{doc.code}</strong><span>{date(doc.expense_date)} · {doc.project_name}</span></div>
                  <span className={outstanding > 0 ? styles.pending : styles.paid}>{outstanding > 0 ? (paid > 0 ? "Partial" : "Menunggu") : "Dibayar"}</span>
                </div>
                <p className={styles.recipient}>{doc.recipient_name}</p>
                <div className={styles.amountGrid}>
                  <div><small>Total AP</small><strong>{money(Number(doc.amount))}</strong></div>
                  <div><small>Sudah Dibayar</small><strong>{money(paid)}</strong></div>
                  <div><small>Sisa Kewajiban</small><strong>{money(outstanding)}</strong></div>
                </div>
                <div className={styles.cardActions}>
                  <button type="button" className={styles.secondary} onClick={() => openPayment(doc)}>Lihat Riwayat</button>
                  {canPost && outstanding > 0 && <button type="button" className={styles.primary} onClick={() => openPayment(doc)}>Catat Pembayaran</button>}
                </div>
              </article>;
            })}
          </div>
        }
      </section>

      {selected && <div className={styles.modalBackdrop} role="presentation" onClick={closePayment}>
        <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHead}><div><p className={styles.eyebrow}>RIWAYAT PEMBAYARAN</p><h2 id="payment-title">{selected.code}</h2><p>{selected.recipient_name} · {selected.project_name}</p></div><button type="button" className={styles.close} onClick={closePayment}>×</button></div>
          <div className={styles.amountGrid}>
            <div><small>Total AP</small><strong>{money(Number(selected.amount))}</strong></div>
            <div><small>Sudah Dibayar</small><strong>{money(selectedPaid)}</strong></div>
            <div><small>Sisa</small><strong>{money(selectedOutstanding)}</strong></div>
          </div>
          <div className={styles.history}>
            <h3>Riwayat Pembayaran</h3>
            {!selectedPayments.length ? <p className={styles.muted}>Belum ada pembayaran.</p> : selectedPayments.map((payment) => <article key={payment.id}>
              <div><strong>{money(Number(payment.amount))}</strong><span>{date(payment.payment_date)}</span></div>
              <small>Kasir · Tunai{payment.payment_reference ? ` · Ref: ${payment.payment_reference}` : ""}</small>
              {payment.notes && <p>{payment.notes}</p>}
            </article>)}
          </div>
          {canPost && selectedOutstanding > 0 && <div className={styles.paymentForm}>
            <h3>Catat Pembayaran Tunai</h3>
            <label>Tanggal Pembayaran<input type="date" value={paymentDate} max={today} onChange={(e) => setPaymentDate(e.target.value)} /></label>
            <label>Nominal Pembayaran (Rp)<input inputMode="numeric" value={amount ? new Intl.NumberFormat("id-ID").format(Number(amount.replace(/\D/g,""))) : ""} onChange={(e) => setAmount(e.target.value.replace(/\D/g,""))} placeholder="Masukkan nominal" /></label>
            <p className={styles.helper}>Maksimal pembayaran saat ini: <strong>{money(selectedOutstanding)}</strong></p>
            <label>Referensi / No. Bukti (opsional)<input maxLength={160} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Nomor kuitansi atau referensi kas" /></label>
            <label>Catatan (opsional)<textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan pembayaran" /></label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {success && <p className={styles.success} role="status">{success}</p>}
            <div className={styles.formActions}><button type="button" className={styles.secondary} onClick={closePayment}>Tutup</button><button type="button" className={styles.primary} disabled={saving || !amount || Number(amount.replace(/\D/g,"")) <= 0} onClick={submitPayment}>{saving ? "Menyimpan..." : "Simpan Pembayaran"}</button></div>
          </div>}
          {(!canPost || selectedOutstanding <= 0) && <div className={styles.formActions}><button type="button" className={styles.secondary} onClick={closePayment}>Tutup</button></div>}
        </section>
      </div>}
    </main>
  );
}
