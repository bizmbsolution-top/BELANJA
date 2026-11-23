"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupplier, updateSupplier } from "./actions";
import styles from "./supplier.module.css";

export type Supplier = {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

type FormState = {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  isActive: true,
};

function toForm(supplier: Supplier): FormState {
  return {
    name: supplier.name,
    contactPerson: supplier.contact_person ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
    isActive: supplier.is_active,
  };
}

export default function SupplierManager({ initialSuppliers }: { initialSuppliers: Supplier[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return initialSuppliers;
    return initialSuppliers.filter((supplier) =>
      [supplier.code, supplier.name, supplier.contact_person, supplier.phone, supplier.email]
        .some((value) => value?.toLowerCase().includes(term))
    );
  }, [initialSuppliers, query]);

  function startNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrorMessage("");
    setMessage("");
    setFormOpen(true);
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setForm(toForm(supplier));
    setErrorMessage("");
    setMessage("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrorMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");
    setMessage("");

    const result = editingId
      ? await updateSupplier(editingId, form)
      : await createSupplier(form);

    setSaving(false);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    setMessage(editingId ? "Perubahan supplier berhasil disimpan." : "Supplier baru berhasil ditambahkan.");
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    router.refresh();
  }

  const activeCount = initialSuppliers.filter((supplier) => supplier.is_active).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DATA MASTER</p>
          <h1>Supplier</h1>
          <p>Kelola data pemasok yang digunakan pada transaksi pembelian.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Supplier</button>
      </header>

      <section className={styles.summary}>
        <div><strong>{initialSuppliers.length}</strong><span>Total supplier</span></div>
        <div><strong>{activeCount}</strong><span>Supplier aktif</span></div>
        <div><strong>{initialSuppliers.length - activeCount}</strong><span>Nonaktif</span></div>
      </section>

      {message && <p className={styles.success} role="status">{message}</p>}

      {formOpen && (
        <section className={styles.formCard}>
          <div className={styles.formHeading}>
            <div>
              <h2>{editingId ? "Ubah Supplier" : "Tambah Supplier"}</h2>
              <p>{editingId ? "Perbarui informasi supplier." : "Kode supplier dibuat otomatis saat data disimpan."}</p>
            </div>
            <button className={styles.closeButton} type="button" onClick={closeForm} aria-label="Tutup form">×</button>
          </div>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Nama Supplier <b>*</b></span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={160} required placeholder="Contoh: PT Sumber Makmur" />
            </label>
            <label className={styles.field}>
              <span>Nama Kontak</span>
              <input value={form.contactPerson} onChange={(event) => setForm({ ...form, contactPerson: event.target.value })} maxLength={120} placeholder="Nama PIC supplier" />
            </label>
            <label className={styles.field}>
              <span>Nomor Telepon</span>
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={40} placeholder="Nomor telepon / WhatsApp" />
            </label>
            <label className={styles.field}>
              <span>Email</span>
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={254} placeholder="email@supplier.co.id" />
            </label>
            <label className={styles.fieldWide}>
              <span>Alamat</span>
              <textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={500} rows={2} placeholder="Alamat kantor atau lokasi supplier" />
            </label>
            <label className={styles.fieldWide}>
              <span>Catatan</span>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={1000} rows={2} placeholder="Informasi tambahan (opsional)" />
            </label>
            {editingId && (
              <label className={styles.activeToggle}>
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Supplier aktif dan dapat dipilih pada transaksi baru
              </label>
            )}
            {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} type="button" onClick={closeForm} disabled={saving}>Batal</button>
              <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Supplier"}</button>
            </div>
          </form>
        </section>
      )}

      <section className={styles.listCard}>
        <div className={styles.listHeading}>
          <div><h2>Daftar Supplier</h2><p>{filtered.length} data ditampilkan</p></div>
          <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, kode, kontak..." aria-label="Cari supplier" />
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <h3>{initialSuppliers.length === 0 ? "Belum ada supplier" : "Supplier tidak ditemukan"}</h3>
            <p>{initialSuppliers.length === 0 ? "Tambahkan supplier pertama untuk mulai menggunakan data master ini." : "Coba kata kunci pencarian yang lain."}</p>
            {initialSuppliers.length === 0 && <button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Supplier</button>}
          </div>
        ) : (
          <div className={styles.supplierList}>
            {filtered.map((supplier) => (
              <article className={styles.supplierItem} key={supplier.id}>
                <div className={styles.supplierMain}>
                  <div className={styles.supplierTitle}>
                    <span className={styles.code}>{supplier.code}</span>
                    <span className={supplier.is_active ? styles.active : styles.inactive}>{supplier.is_active ? "Aktif" : "Nonaktif"}</span>
                  </div>
                  <h3>{supplier.name}</h3>
                  <p>{supplier.contact_person || "Kontak belum diisi"}{supplier.phone ? ` · ${supplier.phone}` : ""}</p>
                  {supplier.email && <small>{supplier.email}</small>}
                  {supplier.address && <small>{supplier.address}</small>}
                </div>
                <button className={styles.editButton} type="button" onClick={() => startEdit(supplier)}>Ubah</button>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className={styles.footnote}>Data supplier dikelola bersama untuk organisasi. Supplier tidak dihapus permanen; nonaktifkan jika tidak digunakan lagi.</p>
    </main>
  );
}
