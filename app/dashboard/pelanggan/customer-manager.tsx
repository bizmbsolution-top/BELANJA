"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveCustomer } from "./actions";
import styles from "./customer.module.css";
export type Customer = { id: string; code: string; name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; is_active: boolean; created_at: string };
const blank = { id: "", name: "", phone: "", email: "", address: "", notes: "", active: true };
export default function CustomerManager({ initialCustomers, canEdit }: { initialCustomers: Customer[]; canEdit: boolean }) {
  const router = useRouter(); const [form, setForm] = useState(blank); const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  function edit(c: Customer) { setForm({ id:c.id,name:c.name,phone:c.phone??"",email:c.email??"",address:c.address??"",notes:c.notes??"",active:c.is_active }); setOpen(true); setError(""); }
  function reset() { setForm(blank); setOpen(false); }
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(""); setMessage("");
    const r=await saveCustomer(form); setBusy(false); if(!r.ok){setError(r.error);return;}
    setMessage("Data pelanggan berhasil disimpan."); reset(); router.refresh();
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>DATA MASTER · PENJUALAN</p><h1>Pelanggan</h1><p>Daftar pembeli dan tujuan transaksi penjualan.</p></div>
      {canEdit&&<button className={styles.primary} onClick={()=>{setForm(blank);setOpen(true);setError("");}}>+ Tambah Pelanggan</button>}</header>
    {message&&<p className={styles.success}>{message}</p>}{error&&<p className={styles.error}>{error}</p>}
    {open&&<section className={styles.formCard}><div className={styles.formTitle}><h2>{form.id?"Edit Pelanggan":"Pelanggan Baru"}</h2><button className={styles.close} type="button" onClick={reset}>×</button></div>
      <form className={styles.form} onSubmit={submit}>
        <label>Nama Pelanggan / Pembeli<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required minLength={2} maxLength={160}/></label>
        <label>Nomor Telepon<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} maxLength={40}/></label>
        <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} maxLength={160}/></label>
        <label className={styles.wide}>Alamat<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} maxLength={500}/></label>
        <label className={styles.wide}>Keterangan<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows={2} maxLength={1000}/></label>
        {form.id&&<label className={styles.check}><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Aktif</label>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={reset}>Batal</button><button className={styles.primary} disabled={busy}>{busy?"Menyimpan...":"Simpan Pelanggan"}</button></div>
      </form></section>}
    <section className={styles.section}><div className={styles.sectionHeading}><h2>Daftar Pelanggan</h2><span>{initialCustomers.length} data</span></div>
      {initialCustomers.length===0?<div className={styles.empty}><b>Belum ada pelanggan</b><p>Tambahkan pembeli untuk mulai membuat penjualan.</p></div>:initialCustomers.map(c=><article className={styles.row} key={c.id}>
        <div><span className={styles.code}>{c.code}</span><b>{c.name}</b><small>{[c.phone,c.email].filter(Boolean).join(" · ")||"Kontak belum diisi"}</small>{c.address&&<small>{c.address}</small>}</div>
        <div className={styles.rowEnd}><span className={c.is_active?styles.good:styles.bad}>{c.is_active?"Aktif":"Nonaktif"}</span>{canEdit&&<button className={styles.secondary} onClick={()=>edit(c)}>Edit</button>}</div>
      </article>)}
    </section>
  </main>;
}
