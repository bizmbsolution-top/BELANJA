"use client";

import { useMemo, useState } from "react";
import ApRecipientField, { type ApSupplierOption } from "./recipient-field";
import { createApDraft, updateApDraft } from "./actions";
import styles from "./form.module.css";
import type { ApDocument, ApLine } from "./manager";

type Option = { id: string; name: string };
type ApReference = {
  id: string;
  code: string;
  ba_number: string | null;
  project_id: string;
  ba_date: string | null;
  final_amount: number | null;
  customer_name: string;
};
type DraftLine = { expense_category_id: string; description: string; amount: string };

function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}
const money = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);

export default function ApForm({
  suppliers, projects, categories, references, document, lines, onClose, onSaved,
}: {
  suppliers: ApSupplierOption[];
  projects: Option[];
  categories: Option[];
  references: ApReference[];
  document?: ApDocument | null;
  lines?: ApLine[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(document?.expense_date ?? localDate());
  const [supplierId, setSupplierId] = useState(document?.recipient_supplier_id ?? "");
  const [projectId, setProjectId] = useState(document?.project_id ?? "");
  const [salesOrderId, setSalesOrderId] = useState(document?.sales_order_id ?? "");
  const [summary, setSummary] = useState(document?.description ?? "");
  const [items, setItems] = useState<DraftLine[]>(() => lines?.length
    ? lines.map((line) => ({ expense_category_id: line.expense_category_id, description: line.description, amount: String(line.amount) }))
    : [{ expense_category_id: "", description: "", amount: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const availableReferences = useMemo(
    () => references.filter((item) => item.project_id === projectId),
    [references, projectId],
  );
  const total = items.reduce((sum, item) => {
    const amount = Number(item.amount);
    return sum + (Number.isSafeInteger(amount) && amount > 0 ? amount : 0);
  }, 0);

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setItems((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    if (items.length < 1 || items.length > 50) {
      setSaving(false);
      setError("AP harus memiliki 1 sampai 50 rincian biaya.");
      return;
    }
    const payload = {
      expense_date: date,
      recipient_supplier_id: supplierId,
      project_id: projectId,
      sales_order_id: salesOrderId || null,
      summary,
      lines: items.map((item) => ({
        expense_category_id: item.expense_category_id,
        description: item.description.trim(),
        amount: Number(item.amount),
      })),
    };
    const result = document
      ? await updateApDraft(document.id, payload)
      : await createApDraft(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ap-form-title">
        <header className={styles.heading}>
          <div><p className={styles.eyebrow}>KEWAJIBAN PEMBAYARAN</p><h2 id="ap-form-title">{document ? "Ubah Draft AP" : "Buat AP Baru"}</h2></div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Tutup">×</button>
        </header>
        <form onSubmit={save} className={styles.form}>
          <div className={styles.grid}>
            <label>Tanggal AP *<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label>Project *<select required value={projectId} onChange={(event) => { setProjectId(event.target.value); setSalesOrderId(""); }}>
              <option value="">Pilih Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>
          <ApRecipientField initialSuppliers={suppliers} value={supplierId} onChange={setSupplierId} />
          <label>Referensi BA / Invoice (opsional)
            <select value={salesOrderId} onChange={(event) => setSalesOrderId(event.target.value)} disabled={!projectId}>
              <option value="">Tidak menggunakan referensi</option>
              {availableReferences.map((item) => <option key={item.id} value={item.id}>{item.ba_number || item.code} · {item.customer_name}</option>)}
            </select>
          </label>
          {salesOrderId && (() => {
            const ref = availableReferences.find((item) => item.id === salesOrderId);
            return ref ? <div className={styles.reference}>Referensi: <strong>{ref.ba_number || ref.code}</strong> · {ref.customer_name} · Nilai BA {money(Number(ref.final_amount ?? 0))}. Nilai ini hanya informasi, bukan nominal AP.</div> : null;
          })()}
          <label>Keterangan AP (opsional)<input maxLength={1000} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ringkasan kewajiban pembayaran" /></label>
          <div className={styles.linesHeader}><div><h3>Rincian Biaya</h3><p>Isi kategori, keterangan, dan nominal setiap biaya.</p></div>
            <button type="button" className={styles.addLine} disabled={items.length >= 50} onClick={() => setItems((current) => [...current, { expense_category_id: "", description: "", amount: "" }])}>+ Tambah Baris</button>
          </div>
          <div className={styles.lines}>
            {items.map((item, index) => <div className={styles.line} key={index}>
              <div className={styles.lineTitle}><strong>Rincian {index + 1}</strong>
                <button type="button" className={styles.removeLine} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>Hapus</button>
              </div>
              <label>Kategori Biaya *<select required value={item.expense_category_id} onChange={(event) => updateLine(index, { expense_category_id: event.target.value })}>
                <option value="">Pilih Kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select></label>
              <div className={styles.lineFields}>
                <label>Keterangan *<input required maxLength={500} value={item.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
                <label>Nominal (Rp) *<input required inputMode="numeric" type="number" min="1" step="1" value={item.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} /></label>
              </div>
            </div>)}
          </div>
          <div className={styles.total}><span>Total AP</span><strong>{money(total)}</strong></div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <footer className={styles.actions}>
            <button type="button" className={styles.cancel} disabled={saving} onClick={onClose}>Batal</button>
            <button type="submit" className={styles.save} disabled={saving || !projects.length || !categories.length}>{saving ? "Menyimpan..." : "Simpan Draft AP"}</button>
          </footer>
        </div>
      </section>
    </form>
  );
}
