"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveCustomer } from "./actions";
import styles from "./customer.module.css";
export type Customer = { id: string; code: string; name: string; phone: string | null; email: string | null; billing_address: string | null; notes: string | null; is_active: boolean; created_at: string; warehouse_addresses: {id:string;label:string;address:string}[] };
const blank = { id: "", name: "", phone: "", email: "", billingAddress: "", notes: "", active: true, warehouseAddresses: [] as {id?:string;label:string;address:string}[] };
export default function CustomerManager({ initialCustomers, canEdit }: { initialCustomers: Customer[]; canEdit: boolean }) {
  const router = useRouter(); const [form, setForm] = useState(blank); const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  function edit(c: Customer) { setForm({ id:c.id,name:c.name,phone:c.phone??"",email:c.email??"",billingAddress:c.billing_address??"",notes:c.notes??"",active:c.is_active,warehouseAddresses:(c.warehouse_addresses??[]).map(a=>({id:a.id,label:a.label,address:a.address})) }); setOpen(true); setError(""); }
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
        <label className={styles.wide}>Alamat Billing / Penagihan<textarea value={form.billingAddress} onChange={e=>setForm({...form,billingAddress:e.target.value})} rows={2} maxLength={1000} placeholder="Alamat invoice dan penagihan"/></label>
        <div className={styles.wide}><div className={styles.formTitle}><b>Alamat Gudang / Penerimaan</b><button type="button" className={styles.secondary} onClick={()=>setForm({...form,warehouseAddresses:[...form.warehouseAddresses,{label:"",address:""}]})}>+ Tambah Alamat Gudang</button></div>
        {form.warehouseAddresses.map((a,i)=><div key={a.id??i} className={styles.addressRow}><label>Nama Lokasi<input value={a.label} onChange={e=>setForm({...form,warehouseAddresses:form.warehouseAddresses.map((x,j)=>j===i?{...x,label:e.target.value}:x)})} placeholder="Contoh: Gudang Utama"/></label><label>Alamat Gudang<textarea value={a.address} onChange={e=>setForm({...form,warehouseAddresses:form.warehouseAddresses.map((x,j)=>j===i?{...x,address:e.target.value}:x)})} rows={2} placeholder="Alamat lengkap lokasi penerimaan"/></label><button type="button" className={styles.secondary} onClick={()=>setForm({...form,warehouseAddresses:form.warehouseAddresses.filter((_,j)=>j!==i)})}>Hapus</button></div>)}
        {!form.warehouseAddresses.length&&<small>Belum ada alamat gudang. Tambahkan alamat tujuan pengiriman milik pelanggan.</small>}</div>
        <label className={styles.wide}>Keterangan<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} rows={2} maxLength={1000}/></label>
        {form.id&&<label className={styles.check}><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Aktif</label>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={reset}>Batal</button><button className={styles.primary} disabled={busy}>{busy?"Menyimpan...":"Simpan Pelanggan"}</button></div>
      </form></section>}
    <section className={styles.section}><div className={styles.sectionHeading}><h2>Daftar Pelanggan</h2><span>{initialCustomers.length} data</span></div>
      {initialCustomers.length===0?<div className={styles.empty}><b>Belum ada pelanggan</b><p>Tambahkan pembeli untuk mulai membuat penjualan.</p></div>:initialCustomers.map(c=><article className={styles.row} key={c.id}>
        <div><span className={styles.code}>{c.code}</span><b>{c.name}</b><small>{[c.phone,c.email].filter(Boolean).join(" · ")||"Kontak belum diisi"}</small>{c.billing_address&&<small>Billing: {c.billing_address}</small>}{(c.warehouse_addresses??[]).map(a=><small key={a.id}>Gudang {a.label}: {a.address}</small>)}</div>
        <div className={styles.rowEnd}><span className={c.is_active?styles.good:styles.bad}>{c.is_active?"Aktif":"Nonaktif"}</span>{canEdit&&<button className={styles.secondary} onClick={()=>edit(c)}>Edit</button>}</div>
      </article>)}
    </section>
  </main>;
}
