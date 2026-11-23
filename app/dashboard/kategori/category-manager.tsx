"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseCategory, updatePurchaseCategory } from "./actions";
import styles from "./category.module.css";

export type PurchaseCategory = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type FormState = { name: string; description: string; isActive: boolean };
const EMPTY_FORM: FormState = { name: "", description: "", isActive: true };

function toForm(category: PurchaseCategory): FormState {
  return { name: category.name, description: category.description ?? "", isActive: category.is_active };
}

export default function CategoryManager({ initialCategories }: { initialCategories: PurchaseCategory[] }) {
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
    if (!term) return initialCategories;
    return initialCategories.filter((category) =>
      [category.code, category.name, category.description].some((value) => value?.toLowerCase().includes(term))
    );
  }, [initialCategories, query]);

  const activeCount = initialCategories.filter((category) => category.is_active).length;

  function startNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrorMessage("");
    setMessage("");
    setFormOpen(true);
  }

  function startEdit(category: PurchaseCategory) {
    setEditingId(category.id);
    setForm(toForm(category));
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
      ? await updatePurchaseCategory(editingId, form)
      : await createPurchaseCategory(form);
    setSaving(false);

    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    setMessage(editingId ? "Perubahan kategori berhasil disimpan." : "Kategori baru berhasil ditambahkan.");
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DATA MASTER</p>
          <h1>Kategori Pembelian</h1>
          <p>Kelola kategori untuk mengelompokkan kebutuhan dan transaksi pembelian.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Kategori</button>
      </header>

      <section className={styles.summary}>
        <div><strong>{initialCategories.length}</strong><span>Total kategori</span></div>
        <div><strong>{activeCount}</strong><span>Kategori aktif</span></div>
        <div><strong>{initialCategories.length - activeCount}</strong><span>Nonaktif</span></div>
      </section>

      {message && <p className={styles.success} role="status">{message}</p>}

      {formOpen && (
        <section className={styles.formCard}>
          <div className={styles.formHeading}>
            <div>
              <h2>{editingId ? "Ubah Kategori" : "Tambah Kategori"}</h2>
              <p>{editingId ? "Perbarui nama atau keterangan kategori." : "Kode kategori dibuat otomatis saat data disimpan."}</p>
            </div>
            <button className={styles.closeButton} type="button" onClick={closeForm} aria-label="Tutup form">×</button>
          </div>
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.fieldWide}>
              <span>Nama Kategori <b>*</b></span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={120} required placeholder="Contoh: Bahan Bakar" />
            </label>
            <label className={styles.fieldWide}>
              <span>Keterangan</span>
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} rows={3} placeholder="Penjelasan singkat kategori (opsional)" />
            </label>
            {editingId && (
              <label className={styles.activeToggle}>
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Kategori aktif dan dapat dipilih pada transaksi pembelian baru
              </label>
            )}
            {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} type="button" onClick={closeForm} disabled={saving}>Batal</button>
              <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Kategori"}</button>
            </div>
          </form>
        </section>
      )}

      <section className={styles.listCard}>
        <div className={styles.listHeading}>
          <div><h2>Daftar Kategori</h2><p>{filtered.length} data ditampilkan</p></div>
          <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode, nama, keterangan..." aria-label="Cari kategori" />
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <h3>{initialCategories.length === 0 ? "Belum ada kategori pembelian" : "Kategori tidak ditemukan"}</h3>
            <p>{initialCategories.length === 0 ? "Tambahkan kategori untuk mulai menyiapkan data pembelian." : "Coba kata kunci pencarian yang lain."}</p>
            {initialCategories.length === 0 && <button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Kategori</button>}
          </div>
        ) : (
          <div className={styles.categoryList}>
            {filtered.map((category) => (
              <article className={styles.categoryItem} key={category.id}>
                <div className={styles.categoryMain}>
                  <div className={styles.categoryTitle}>
                    <span className={styles.code}>{category.code}</span>
                    <span className={category.is_active ? styles.active : styles.inactive}>{category.is_active ? "Aktif" : "Nonaktif"}</span>
                  </div>
                  <h3>{category.name}</h3>
                  <p>{category.description || "Tidak ada keterangan"}</p>
                </div>
                <button className={styles.editButton} type="button" onClick={() => startEdit(category)}>Ubah</button>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className={styles.footnote}>Kategori dikelola bersama untuk organisasi. Kategori yang sudah pernah digunakan tidak dihapus permanen; nonaktifkan agar tidak dipilih pada transaksi baru.</p>
    </main>
  );
}
