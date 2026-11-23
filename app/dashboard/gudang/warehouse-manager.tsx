"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createWarehouse, updateWarehouse, setWarehouseProjects } from "./actions";
import styles from "./warehouse.module.css";

export type Warehouse = {
  id: string; code: string; name: string; location: string | null;
  description: string | null; is_active: boolean; projectIds: string[];
};
type FormState = { name: string; location: string; description: string; isActive: boolean };
const EMPTY: FormState = { name: "", location: "", description: "", isActive: true };
const toForm = (item: Warehouse): FormState => ({
  name: item.name, location: item.location ?? "", description: item.description ?? "", isActive: item.is_active,
});

export default function WarehouseManager({ initialWarehouses, initialProjects, canManageAssignments }: { initialWarehouses: Warehouse[]; initialProjects: { id: string; code: string; name: string }[]; canManageAssignments: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? initialWarehouses.filter(x => [x.code, x.name, x.location, x.description].some(v => v?.toLowerCase().includes(term))) : initialWarehouses;
  }, [initialWarehouses, query]);
  const activeCount = initialWarehouses.filter(x => x.is_active).length;
  function startNew() { setEditingId(null); setForm(EMPTY); setSelectedProjectIds([]); setErrorMessage(""); setMessage(""); setFormOpen(true); }
  function startEdit(item: Warehouse) { setEditingId(item.id); setForm(toForm(item)); setSelectedProjectIds(item.projectIds); setErrorMessage(""); setMessage(""); setFormOpen(true); }
  function closeForm() { if (saving) return; setFormOpen(false); setEditingId(null); setForm(EMPTY); setSelectedProjectIds([]); setErrorMessage(""); }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setErrorMessage(""); setMessage("");
    const result = editingId ? await updateWarehouse(editingId, form) : await createWarehouse(form);
    setSaving(false);
    if (!result.ok) { setErrorMessage(result.error); setSaving(false); return; }
    if (editingId && canManageAssignments) {
      const assignment = await setWarehouseProjects({ warehouseId: editingId, projectIds: selectedProjectIds });
      if (!assignment.ok) { setErrorMessage(assignment.error); setSaving(false); return; }
    }
    setMessage(editingId ? "Perubahan gudang dan hubungan Project berhasil disimpan." : "Gudang baru berhasil ditambahkan. Atur Project melalui tombol Ubah.");
    setFormOpen(false); setEditingId(null); setForm(EMPTY); router.refresh();
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}><div><p className={styles.eyebrow}>DATA MASTER</p><h1>Gudang / Warehouse</h1><p>Kelola lokasi tujuan penerimaan barang dari transaksi pembelian.</p></div><button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Gudang</button></header>
      <section className={styles.summary}><div><strong>{initialWarehouses.length}</strong><span>Total gudang</span></div><div><strong>{activeCount}</strong><span>Gudang aktif</span></div><div><strong>{initialWarehouses.length-activeCount}</strong><span>Nonaktif</span></div></section>
      {message && <p className={styles.success} role="status">{message}</p>}
      {formOpen && <section className={styles.formCard}>
        <div className={styles.formHeading}><div><h2>{editingId ? "Ubah Gudang" : "Tambah Gudang"}</h2><p>Kode gudang dibuat otomatis saat data disimpan.</p></div><button className={styles.closeButton} type="button" onClick={closeForm} aria-label="Tutup form">×</button></div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.fieldWide}><span>Nama Gudang <b>*</b></span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} maxLength={160} required placeholder="Contoh: Gudang Utama"/></label>
          <label className={styles.fieldWide}><span>Lokasi</span><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})} maxLength={200} placeholder="Contoh: Gantung, Belitung"/></label>
          {editingId && canManageAssignments && <fieldset className={styles.fieldWide} style={{border:"1px solid #d8dee8",borderRadius:12,padding:12}}><legend>Project yang menggunakan gudang</legend><p style={{fontSize:13,color:"#64748b"}}>Pilih satu atau beberapa Project. Gudang yang sama dapat digunakan oleh beberapa Project.</p>{initialProjects.map(project => <label key={project.id} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 0"}}><input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={e=>setSelectedProjectIds(current=>e.target.checked?[...current,project.id]:current.filter(id=>id!==project.id))}/><span>{project.code} · {project.name}</span></label>)}</fieldset>}
          <label className={styles.fieldWide}><span>Keterangan</span><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} maxLength={500} rows={3} placeholder="Keterangan tambahan (opsional)"/></label>
          {editingId && <label className={styles.activeToggle}><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Gudang aktif dan dapat dipilih pada pembelian baru</label>}
          {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
          <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={closeForm} disabled={saving}>Batal</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving?"Menyimpan...":editingId?"Simpan Perubahan":"Simpan Gudang"}</button></div>
        </form>
      </section>}
      <section className={styles.listCard}><div className={styles.listHeading}><div><h2>Daftar Gudang</h2><p>{filtered.length} data ditampilkan</p></div><input className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari kode, nama, lokasi..." aria-label="Cari gudang"/></div>
        {filtered.length===0 ? <div className={styles.empty}><h3>{initialWarehouses.length===0?"Belum ada gudang":"Gudang tidak ditemukan"}</h3><p>{initialWarehouses.length===0?"Tambahkan gudang untuk menentukan tujuan penerimaan pembelian.":"Coba kata kunci pencarian yang lain."}</p>{initialWarehouses.length===0&&<button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Gudang</button>}</div> :
        <div className={styles.itemList}>{filtered.map(item=><article className={styles.item} key={item.id}><div className={styles.main}><div className={styles.itemTitle}><span className={styles.code}>{item.code}</span><span className={item.is_active?styles.active:styles.inactive}>{item.is_active?"Aktif":"Nonaktif"}</span></div><h3>{item.name}</h3><p>{item.location||"Lokasi belum diisi"}</p>{item.description&&<small>{item.description}</small>}<small>Project: {item.projectIds.length ? initialProjects.filter(p=>item.projectIds.includes(p.id)).map(p=>p.code).join(", ") : "Belum diatur"}</small><small>Project: {item.projectIds.length ? initialProjects.filter(p=>item.projectIds.includes(p.id)).map(p=>p.code).join(", ") : "Belum diatur"}</small></div><button className={styles.editButton} type="button" onClick={()=>startEdit(item)}>Ubah</button></article>)}</div>}
      </section>
      <p className={styles.footnote}>Gudang dikelola bersama untuk organisasi. Gudang yang sudah pernah digunakan tidak dihapus permanen; nonaktifkan agar tidak dipilih pada transaksi pembelian baru.</p>
    </main>
  );
}
