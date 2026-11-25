"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseRequest, recordPurchaseReceipt, uploadPurchasePaymentEvidence, payPurchasePayment } from "./actions";
import { createSupplier } from "../supplier/actions";
import styles from "./purchase.module.css";

type Lookup = { id: string; code: string; name: string };
type RequestRow = { id: string; code: string; request_date: string; project_id: string; supplier_id: string; warehouse_id: string; category_id: string; estimated_weight_kg: number; estimated_value: number | null; price_per_kg: number; notes: string | null; status: string; created_at: string };
type ReceiptRow = { id: string; code: string; purchase_request_id: string; receipt_date: string; value: number; value_unit: string; weight: number; weight_unit: string; notes: string | null; status: string; decision_reason: string | null; completed_at: string | null };
type PaymentRow = { id: string; code: string; receipt_id: string; amount: number; status: string; requested_at: string; paid_at: string | null; payment_method: string | null };
type DocRow = { id: string; receipt_id?: string; payment_request_id?: string; evidence_type?: string; file_name: string; signed_url: string | null };
export type PurchasePageData = { actorRoles: string[]; projects: Lookup[]; suppliers: Lookup[]; categories: Lookup[]; warehouses: Lookup[]; requests: RequestRow[]; receipts: ReceiptRow[]; payments: PaymentRow[]; receiptDocs: DocRow[]; paymentDocs: DocRow[]; warehouseProjects: { warehouse_id: string; project_id: string }[] };

const rupiah = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string) => new Date(value + (value.length === 10 ? "T00:00:00" : "")).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const formatRupiahInput = (value: string) => { const digits = value.replace(/\D/g, ""); return digits ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(digits)) : ""; };

export default function PurchaseManager({ data }: { data: PurchasePageData }) {
  const router = useRouter();
  const isProcurement = data.actorRoles.includes("Procurement") || data.actorRoles.includes("Superadmin");
  const isCashier = data.actorRoles.includes("Cashier") && !data.actorRoles.includes("Procurement") && !data.actorRoles.includes("Superadmin");
  const [showRequest, setShowRequest] = useState(false);
  const [activeBucket, setActiveBucket] = useState<"receipt" | "payment" | "paid" | "draft" | null>(null);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<RequestRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [paymentBusy, setPaymentBusy] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierFieldRef = useRef<HTMLDivElement>(null);
  const [pricePerKgText, setPricePerKgText] = useState("");
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierFormError, setSupplierFormError] = useState("");
  const [pendingSupplierName, setPendingSupplierName] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "" });

  const filteredSuppliers = useMemo(() => {
    const term = supplierSearch.trim().toLowerCase();
    return data.suppliers.filter(s => !term || [s.code, s.name].some(v => v.toLowerCase().includes(term)));
  }, [data.suppliers, supplierSearch]);

  useEffect(() => {
    if (!supplierDropdownOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (supplierFieldRef.current && !supplierFieldRef.current.contains(event.target as Node)) setSupplierDropdownOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [supplierDropdownOpen]);

  useEffect(() => {
    if (!pendingSupplierName) return;
    const created = data.suppliers.find(s => s.name.trim().toLowerCase() === pendingSupplierName.trim().toLowerCase());
    if (created) {
      setSupplierId(created.id);
      setSupplierSearch(`${created.code} · ${created.name}`);
      setPendingSupplierName("");
    }
  }, [data.suppliers, pendingSupplierName]);

  const warehousesForProject = useMemo(() => data.warehouses.filter(w => data.warehouseProjects.some(m => m.warehouse_id === w.id && m.project_id === selectedProject)), [data.warehouses, data.warehouseProjects, selectedProject]);
  const pendingPayments = data.payments.filter(p => p.status === "Menunggu Pembayaran").length;
  const paidPayments = data.payments.filter(p => p.status === "Lunas").length;
  const matchesRequest = (request: RequestRow | null) => {
    if (!request) return false;
    const supplier = lookup(data.suppliers, request.supplier_id);
    const warehouse = lookup(data.warehouses, request.warehouse_id);
    const term = filterSearch.trim().toLowerCase();
    const haystack = [request.code, supplier?.name, supplier?.code].filter(Boolean).join(" ").toLowerCase();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const withinDefaultHistory = activeBucket !== "paid" || filterFrom || filterTo || new Date(request.request_date + "T00:00:00") >= cutoff;
    return withinDefaultHistory && (!term || haystack.includes(term)) &&
      (!filterSupplier || request.supplier_id === filterSupplier) &&
      (!filterWarehouse || request.warehouse_id === filterWarehouse) &&
      (!filterFrom || request.request_date >= filterFrom) &&
      (!filterTo || request.request_date <= filterTo);
  };
  const visibleRequests = data.requests.filter(request => {
    if (activeBucket === "receipt" && request.status !== "Menunggu Barang") return false;
    return matchesRequest(request);
  });
  const visiblePayments = data.payments.filter(payment => {
    if (activeBucket === "payment" && payment.status !== "Menunggu Pembayaran") return false;
    if (activeBucket === "paid" && payment.status !== "Lunas") return false;
    if (activeBucket !== "payment" && activeBucket !== "paid") return false;
    const receipt = data.receipts.find(row => row.id === payment.receipt_id);
    const request = receipt ? data.requests.find(row => row.id === receipt.purchase_request_id) ?? null : null;
    return matchesRequest(request);
  });

  async function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await createPurchaseRequest({
      requestDate: String(form.get("requestDate") ?? ""), projectId: String(form.get("projectId") ?? ""),
      supplierId: String(form.get("supplierId") ?? ""), warehouseId: String(form.get("warehouseId") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""), estimatedWeightKg: String(form.get("estimatedWeightKg") ?? ""),
      estimatedValue: String(form.get("estimatedValue") ?? ""), pricePerKg: String(form.get("pricePerKg") ?? "").replace(/\./g, ""), notes: String(form.get("notes") ?? ""),
    });
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage("Permintaan pembelian berhasil dibuat."); setShowRequest(false); setSelectedProject(""); setPricePerKgText(""); router.refresh();
  }

  async function handleSupplierSubmit() {
    setSupplierSaving(true); setSupplierFormError("");
    const result = await createSupplier(supplierForm);
    setSupplierSaving(false);
    if (!result.ok) { setSupplierFormError(result.error); return; }
    setPendingSupplierName(supplierForm.name.trim());
    setSupplierSearch(supplierForm.name.trim());
    setSupplierId(""); setSupplierFormOpen(false); setSupplierDropdownOpen(false);
    setSupplierForm({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "" });
    router.refresh();
  }

  async function handleReceiptSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!receiptFor) return;
    setSaving(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget); form.set("requestId", receiptFor.id);
    const result = await recordPurchaseReceipt(form);
    setSaving(false);
    if (!result.ok) { setError(result.error); return; }
    setMessage("Penerimaan berhasil disimpan. Jika diterima, pengajuan pembayaran dibuat otomatis.");
    setReceiptFor(null); router.refresh();
  }

  async function handlePaymentUpload(paymentId: string, form: HTMLFormElement) {
    setPaymentBusy(paymentId); setError(""); setMessage("");
    const result = await uploadPurchasePaymentEvidence(paymentId, new FormData(form));
    setPaymentBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setMessage("Bukti Transfer berhasil diunggah."); router.refresh();
  }

  async function handlePay(paymentId: string) {
    setPaymentBusy(paymentId); setError(""); setMessage("");
    const result = await payPurchasePayment(paymentId);
    setPaymentBusy(null);
    if (!result.ok) { setError(result.error); return; }
    setMessage("Pembayaran berhasil dicatat dan saldo Project diperbarui."); router.refresh();
  }

  function lookup(list: Lookup[], id: string) { return list.find(item => item.id === id); }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>OPERASIONAL</p><h1>Pembelian</h1><p>Permintaan pembelian, pemeriksaan penerimaan, dan pembayaran berdasarkan barang yang diterima.</p></div>
        {isProcurement && <button className={styles.primary} type="button" onClick={() => { setError(""); setSupplierId(""); setSupplierSearch(""); setSupplierFormOpen(false); setPricePerKgText(""); setShowRequest(true); }}>+ Buat Permintaan</button>}
      </header>
      {!activeBucket && <section className={styles.metrics}>
        <button type="button" className={styles.statusTile} onClick={() => setActiveBucket("draft")}><strong>0</strong><span>Draft Pembelian</span><small>Belum disubmit</small></button>
        <button type="button" className={styles.statusTile} onClick={() => setActiveBucket("receipt")}><strong>{data.requests.filter(r => r.status === "Menunggu Barang").length}</strong><span>Tunggu Penerimaan</span><small>Menunggu pemeriksaan barang</small></button>
        <button type="button" className={styles.statusTile} onClick={() => setActiveBucket("payment")}><strong>{pendingPayments}</strong><span>Tunggu Pelunasan</span><small>Antrean pembayaran</small></button>
        <button type="button" className={styles.statusTile} onClick={() => setActiveBucket("paid")}><strong>{paidPayments}</strong><span>Pembelian Lunas</span><small>Riwayat pembayaran</small></button>
      </section>}
      {activeBucket && <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><h2>{activeBucket === "draft" ? "Draft Pembelian" : activeBucket === "receipt" ? "Tunggu Penerimaan" : activeBucket === "payment" ? "Tunggu Pelunasan" : "Pembelian Lunas"}</h2>
          <p>{activeBucket === "draft" ? "Draft belum didukung pada alur penyimpanan saat ini." : activeBucket === "receipt" ? visibleRequests.length + " permintaan" : visiblePayments.length + " pengajuan pembayaran"}</p></div>
          <button type="button" className={styles.secondary} onClick={() => { setActiveBucket(null); setFilterSupplier(""); setFilterWarehouse(""); setFilterFrom(""); setFilterTo(""); setFilterSearch(""); setExpandedRequestId(null); setExpandedPaymentId(null); }}>Kembali</button>
        </div>
        {activeBucket !== "draft" && <div className={styles.filterPanel}>
          <input aria-label="Cari nomor order atau supplier" placeholder="Cari nomor order / supplier..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          <select aria-label="Filter supplier" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}><option value="">Semua Supplier</option>{data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select aria-label="Filter gudang" value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}><option value="">Semua Gudang</option>{data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <label>Dari tanggal<input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} /></label>
          <label>Sampai tanggal<input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} /></label>
          <button type="button" className={styles.secondary} onClick={() => { setFilterSupplier(""); setFilterWarehouse(""); setFilterFrom(""); setFilterTo(""); setFilterSearch(""); }}>Reset Filter</button>
        </div>}
        {activeBucket === "draft" && <div className={styles.empty}><h3>Belum ada draft pembelian</h3><p>Alur saat ini langsung menyimpan permintaan sebagai pengajuan. Fitur simpan draft memerlukan dukungan proses penyimpanan tersendiri.</p></div>}
        {activeBucket === "receipt" && visibleRequests.length === 0 && <div className={styles.empty}><h3>Tidak ada permintaan menunggu penerimaan</h3><p>Coba ubah filter pencarian atau periode.</p></div>}
        {(activeBucket === "payment" || activeBucket === "paid") && visiblePayments.length === 0 && <div className={styles.empty}><h3>Tidak ada data pembayaran</h3><p>Coba ubah filter supplier, gudang, atau tanggal.</p></div>}
      </section>}
      {(message || error) && <p className={error ? styles.error : styles.success} role={error ? "alert" : "status"}>{error || message}</p>}

      {showRequest && <section className={styles.formCard}>
        <div className={styles.formTitle}><div><h2>Permintaan Pembelian Baru</h2><p>Pembayaran diajukan setelah barang diterima dan lolos pemeriksaan.</p></div><button type="button" className={styles.close} onClick={() => setShowRequest(false)}>×</button></div>
        <form className={styles.form} onSubmit={handleRequestSubmit}>
          <label>Tanggal Permintaan<input name="requestDate" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
          <label>Project<select name="projectId" value={selectedProject} onChange={e => setSelectedProject(e.target.value)} required><option value="">Pilih Project</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <div className={styles.supplierField} ref={supplierFieldRef}>
            <label htmlFor="purchase-supplier-search">Supplier</label>
            <input type="hidden" name="supplierId" value={supplierId} />
            <input id="purchase-supplier-search" className={styles.supplierSearch} value={supplierSearch} placeholder="Cari nama atau kode supplier..." autoComplete="off" onFocus={e => { setSupplierDropdownOpen(true); e.currentTarget.select(); }} onChange={e => { setSupplierSearch(e.target.value); setSupplierId(""); setSupplierDropdownOpen(true); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (filteredSuppliers.length === 1) { const match = filteredSuppliers[0]; setSupplierId(match.id); setSupplierSearch(match.code + " · " + match.name); setSupplierDropdownOpen(false); } } }} required={!supplierId} aria-expanded={supplierDropdownOpen} aria-controls="purchase-supplier-options" />
            {supplierDropdownOpen && <div className={styles.supplierDropdown} id="purchase-supplier-options">
              {filteredSuppliers.length > 0 ? filteredSuppliers.map(s => <button type="button" className={styles.supplierOption} key={s.id} onClick={() => { setSupplierId(s.id); setSupplierSearch(s.code + " · " + s.name); setSupplierDropdownOpen(false); }}>{s.code} · {s.name}</button>) : <div className={styles.supplierNoResults}><span>Supplier tidak ditemukan.</span><button type="button" className={styles.supplierAdd} onClick={() => { setSupplierFormError(""); setSupplierForm({ ...supplierForm, name: supplierSearch.trim() }); setSupplierFormOpen(true); }}>＋ Add New Supplier</button></div>}
            </div>}
            {supplierFormOpen && <div className={styles.supplierQuickForm} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }}>
              <div className={styles.formTitle}><div><h2>Master Supplier · Tambah Baru</h2><p>Kode supplier dibuat otomatis saat disimpan.</p></div><button type="button" className={styles.close} onClick={() => setSupplierFormOpen(false)}>×</button></div>
              <div className={styles.supplierQuickGrid}>
                <label>Nama Supplier *<input value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} maxLength={160} required /></label>
                <label>Nama Kontak<input value={supplierForm.contactPerson} onChange={e => setSupplierForm({ ...supplierForm, contactPerson: e.target.value })} maxLength={120} /></label>
                <label>Nomor Telepon<input value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} maxLength={40} /></label>
                <label>Email<input type="email" value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} maxLength={254} /></label>
                <label className={styles.supplierQuickWide}>Alamat<textarea rows={2} value={supplierForm.address} onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} maxLength={500} /></label>
                <label className={styles.supplierQuickWide}>Catatan<textarea rows={2} value={supplierForm.notes} onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} maxLength={1000} /></label>
              </div>
              {supplierFormError && <p className={styles.error} role="alert">{supplierFormError}</p>}
              <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setSupplierFormOpen(false)}>Batal</button><button type="button" className={styles.primary} disabled={supplierSaving || !supplierForm.name.trim()} onClick={() => void handleSupplierSubmit()}>{supplierSaving ? "Menyimpan..." : "Simpan Supplier"}</button></div>
            </div>}
          </div>
          <label>Warehouse Tujuan<select name="warehouseId" required defaultValue="" disabled={!selectedProject || warehousesForProject.length===0}><option value="">Pilih Warehouse</option>{warehousesForProject.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>{selectedProject && warehousesForProject.length===0 && <small className={styles.warehouseHint}>Belum ada gudang dari Master Gudang yang dihubungkan ke Project ini. Superadmin perlu mengatur hubungan Project–Gudang di menu Master Gudang.</small>}</label>
          <label>Kategori<select name="categoryId" required defaultValue=""><option value="">Pilih Kategori</option>{data.categories.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
          <label>Estimasi Berat (kg)<input name="estimatedWeightKg" type="number" min="0.001" step="0.001" required placeholder="Contoh: 10000" /></label>
          <label>Estimasi Kadar (%)<input name="estimatedValue" type="number" min="0" max="100" step="0.0001" required placeholder="Contoh: 72.5" /></label>
          <label>Harga Kesepakatan per kg (Rp)<input name="pricePerKg" type="text" inputMode="numeric" value={pricePerKgText} onChange={e => setPricePerKgText(formatRupiahInput(e.target.value))} required placeholder="Contoh: 125.000" autoComplete="off" /></label>
          <label className={styles.wide}>Keterangan<textarea name="notes" rows={3} maxLength={1000} placeholder="Keterangan pembelian (opsional)" /></label>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setShowRequest(false)}>Batal</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Permintaan"}</button></div>
        </form>
      </section>}

      {receiptFor && <section className={styles.formCard}>
        <div className={styles.formTitle}><div><h2>Catat Penerimaan · {receiptFor.code}</h2><p>{lookup(data.categories, receiptFor.category_id)?.name} · {lookup(data.warehouses, receiptFor.warehouse_id)?.name}</p></div><button type="button" className={styles.close} onClick={() => setReceiptFor(null)}>×</button></div>
        <form className={styles.form} onSubmit={handleReceiptSubmit}>
          <label>Tanggal Penerimaan<input name="receiptDate" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
          <label>Value<input name="value" type="number" min="0" step="0.0001" required placeholder="Contoh: 72.5" /></label>
          <label>Satuan Value<input name="valueUnit" defaultValue="%" maxLength={20} required /></label>
          <label>Berat<input name="weight" type="number" min="0.001" step="0.001" required placeholder="Berat aktual" /></label>
          <label>Satuan Berat<select name="weightUnit" defaultValue="kg"><option value="kg">kg</option><option value="ton">ton</option></select></label>
          <label className={styles.wide}>Keterangan<textarea name="notes" rows={2} maxLength={1000} placeholder="Keterangan hasil pemeriksaan" /></label>
          <label className={styles.wide}>Foto Timbangan <small>Wajib · JPG, PNG, WEBP · maksimal 10 MB per foto</small><input name="weightFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
          <label className={styles.wide}>Foto Hasil Pengukuran <small>Wajib · JPG, PNG, WEBP · maksimal 10 MB per foto</small><input name="valueFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
          <label>Keputusan<select name="decision" defaultValue="Diterima"><option value="Diterima">Diterima — memenuhi standar</option><option value="Ditolak">Ditolak — tidak memenuhi standar</option></select></label>
          <label>Alasan Penolakan<textarea name="reason" rows={2} maxLength={1000} placeholder="Wajib jika ditolak" /></label>
          <p className={styles.notice}>Penerimaan yang diselesaikan tidak dapat diedit. Jika diterima, stok bertambah dan pengajuan pembayaran dibuat berdasarkan berat aktual.</p>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setReceiptFor(null)}>Batal</button><button type="submit" className={styles.primary} disabled={saving}>{saving ? "Menyimpan..." : "Selesaikan Penerimaan"}</button></div>
        </form>
      </section>}

      {activeBucket === "receipt" && <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Daftar Order</h2><p>{visibleRequests.length} order ditampilkan</p></div></div>
        {visibleRequests.length === 0 ? <div className={styles.empty}><h3>Belum ada permintaan pembelian</h3><p>Buat permintaan untuk memulai proses pembelian.</p></div> : visibleRequests.map(request => {
          const project = lookup(data.projects, request.project_id), supplier = lookup(data.suppliers, request.supplier_id);
          const warehouse = lookup(data.warehouses, request.warehouse_id), category = lookup(data.categories, request.category_id);
          const receipts = data.receipts.filter(r => r.purchase_request_id === request.id);
          const receivedKg = receipts.filter(r => r.status === "Diterima").reduce((sum,r) => sum + Number(r.weight) * (r.weight_unit === "ton" ? 1000 : 1),0);
          return <article className={styles.requestCard} key={request.id}>
            <div className={styles.cardTop}><div><span className={styles.code}>{request.code}</span><span className={styles.pending}>{request.status}</span><h3>{supplier?.name ?? "Supplier"}</h3><p>{project?.code} · {project?.name} · {warehouse?.name}</p></div>{isProcurement && request.status === "Menunggu Barang" && <button type="button" className={styles.secondary} onClick={() => { setError(""); setReceiptFor(request); }}>+ Catat Penerimaan</button>}</div>
            <div className={styles.cardQuickFacts}><span><small>Estimasi Berat</small><b>{Number(request.estimated_weight_kg).toLocaleString("id-ID")} kg</b></span><span><small>Estimasi Kadar</small><b>{request.estimated_value == null ? "—" : Number(request.estimated_value).toLocaleString("id-ID") + " %"}</b></span><span><small>Tanggal</small><b>{dateLabel(request.request_date)}</b></span></div>
            <button type="button" className={styles.detailToggle} aria-expanded={expandedRequestId === request.id} onClick={() => setExpandedRequestId(expandedRequestId === request.id ? null : request.id)}>{expandedRequestId === request.id ? "Tutup detail" : "Lihat detail order"} <span>{expandedRequestId === request.id ? "−" : "+"}</span></button>
            {expandedRequestId === request.id && <>
            <div className={styles.facts}><span><small>Kategori</small><b>{category?.name ?? "—"}</b></span><span><small>Estimasi Berat</small><b>{Number(request.estimated_weight_kg).toLocaleString("id-ID")} kg</b></span><span><small>Estimasi Kadar</small><b>{request.estimated_value == null ? "—" : Number(request.estimated_value).toLocaleString("id-ID") + " %"}</b></span><span><small>Sudah diterima</small><b>{receivedKg.toLocaleString("id-ID")} kg</b></span><span><small>Harga/kg</small><b>{rupiah(Number(request.price_per_kg))}</b></span></div>
            {request.notes && <p className={styles.note}>{request.notes}</p>}
            {receipts.length > 0 && <div className={styles.receipts}><h4>Riwayat Penerimaan</h4>{receipts.map(receipt => {
              const docs = data.receiptDocs.filter(d => d.receipt_id === receipt.id), payment = data.payments.find(p => p.receipt_id === receipt.id);
              return <div className={styles.receiptRow} key={receipt.id}>
                <div><b>{receipt.code}</b><small>{dateLabel(receipt.receipt_date)} · {Number(receipt.weight).toLocaleString("id-ID")} {receipt.weight_unit} · Value {Number(receipt.value).toLocaleString("id-ID")} {receipt.value_unit}</small><span className={receipt.status === "Diterima" ? styles.good : receipt.status === "Ditolak" ? styles.bad : styles.pending}>{receipt.status}</span></div>
                <div className={styles.docLinks}>{docs.map(doc => doc.signed_url && <a key={doc.id} href={doc.signed_url} target="_blank" rel="noreferrer">{doc.evidence_type === "weight" ? "Foto Timbangan" : "Foto Pengukuran"}: {doc.file_name}</a>)}</div>
                {receipt.decision_reason && <small className={styles.note}>Alasan: {receipt.decision_reason}</small>}
                {payment && <div className={styles.paymentLine}><b>{payment.code} · {rupiah(Number(payment.amount))}</b><span className={payment.status === "Lunas" ? styles.good : styles.pending}>{payment.status}</span></div>}
              </div>;
            })}</div>}
            </>}
          </article>;
        })}
      </section>}

      {(activeBucket === "payment" || activeBucket === "paid") && <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>{activeBucket === "paid" ? "Riwayat Pembelian Lunas" : "Pengajuan Pembayaran"}</h2><p>Pembayaran dibuat otomatis dari penerimaan yang lolos pemeriksaan.</p></div></div>
        {visiblePayments.length === 0 ? <div className={styles.empty}><p>Belum ada pengajuan pembayaran.</p></div> : visiblePayments.map(payment => {
          const receipt = data.receipts.find(r => r.id === payment.receipt_id), request = receipt ? data.requests.find(r => r.id === receipt.purchase_request_id) : null;
          const project = request ? lookup(data.projects, request.project_id) : null;
          const supplier = request ? lookup(data.suppliers, request.supplier_id) : null;
          const warehouse = request ? lookup(data.warehouses, request.warehouse_id) : null;
          const docs = data.paymentDocs.filter(d => d.payment_request_id === payment.id);
          return <article className={styles.paymentCard} key={payment.id}>
            <div className={styles.cardTop}><div><span className={styles.code}>{payment.code}</span><span className={payment.status === "Lunas" ? styles.good : styles.pending}>{payment.status}</span><h3>{request?.code ?? "Permintaan"} · {receipt?.code ?? "Penerimaan"}</h3><p>{supplier?.name ?? "Supplier"} · {warehouse?.name ?? "Gudang"} · {project?.code} {project?.name}</p></div><strong className={styles.amount}>{rupiah(Number(payment.amount))}</strong></div>
            <div className={styles.cardQuickFacts}><span><small>Berat Aktual</small><b>{receipt ? (Number(receipt.weight) * (receipt.weight_unit === "ton" ? 1000 : 1)).toLocaleString("id-ID") + " kg" : "—"}</b></span><span><small>Kadar Aktual</small><b>{receipt ? Number(receipt.value).toLocaleString("id-ID") + " " + receipt.value_unit : "—"}</b></span><span><small>Estimasi Kadar</small><b>{request?.estimated_value == null ? "—" : Number(request.estimated_value).toLocaleString("id-ID") + " %"}</b></span></div>
            <button type="button" className={styles.detailToggle} aria-expanded={expandedPaymentId === payment.id} onClick={() => setExpandedPaymentId(expandedPaymentId === payment.id ? null : payment.id)}>{expandedPaymentId === payment.id ? "Tutup detail" : "Lihat detail pembayaran"} <span>{expandedPaymentId === payment.id ? "−" : "+"}</span></button>
            {expandedPaymentId === payment.id && <>
            <div className={styles.facts}>
              <span><small>Estimasi Kadar</small><b>{request?.estimated_value == null ? "Belum tersedia" : Number(request.estimated_value).toLocaleString("id-ID") + " %"}</b></span>
              <span><small>Kadar Aktual Diterima</small><b>{receipt ? Number(receipt.value).toLocaleString("id-ID") + " " + receipt.value_unit : "Belum tersedia"}</b></span>
              <span><small>Estimasi Berat</small><b>{request ? Number(request.estimated_weight_kg).toLocaleString("id-ID") + " kg" : "—"}</b></span>
              <span><small>Berat Aktual Diterima</small><b>{receipt ? (Number(receipt.weight) * (receipt.weight_unit === "ton" ? 1000 : 1)).toLocaleString("id-ID") + " kg" : "Belum tersedia"}</b></span>
            </div>
            {docs.map(doc => doc.signed_url && <a className={styles.proof} key={doc.id} href={doc.signed_url} target="_blank" rel="noreferrer">Bukti Transfer: {doc.file_name}</a>)}
            {isCashier && payment.status === "Menunggu Pembayaran" && <div className={styles.cashierActions}>
              <form onSubmit={event => { event.preventDefault(); void handlePaymentUpload(payment.id, event.currentTarget); }}>
                <label>Upload Bukti Transfer (TR)<input name="files" type="file" accept="application/pdf,image/jpeg,image/png" multiple required /></label>
                <button className={styles.secondary} type="submit" disabled={paymentBusy === payment.id}>{paymentBusy === payment.id ? "Mengunggah..." : "Upload Bukti"}</button>
              </form>
              <button className={styles.primary} type="button" onClick={() => void handlePay(payment.id)} disabled={paymentBusy === payment.id || docs.length === 0}>{paymentBusy === payment.id ? "Memproses..." : "Bayar Lunas"}</button>
            </div>}
            </>}
          </article>;
        })}
      </section>}
      <p className={styles.footnote}>Stok bertambah hanya setelah penerimaan dinyatakan diterima. Pembayaran wajib lunas 100% dan dilengkapi bukti Transfer.</p>
    </main>
  );
}
