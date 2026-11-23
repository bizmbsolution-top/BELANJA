"use client";
import {useMemo,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {createExpenseCategory,updateExpenseCategory} from "./actions";
import styles from "../kategori/category.module.css";

type Classification="direct_cost"|"general_overhead"|"flexible";
export type ExpenseCategory={id:string;code:string;name:string;description:string|null;is_active:boolean;cost_classification:Classification};
type Form={name:string;description:string;isActive:boolean;costClassification:Classification};
const EMPTY:Form={name:"",description:"",isActive:true,costClassification:"flexible"};
const label=(v:Classification)=>v==="direct_cost"?"Direct Cost":v==="general_overhead"?"General Overhead":"Fleksibel";
export default function ExpenseCategoryManager({initialItems}:{initialItems:ExpenseCategory[]}){
 const router=useRouter();
 const [query,setQuery]=useState("");
 const [classificationFilter,setClassificationFilter]=useState("all");
 const [form,setForm]=useState<Form>(EMPTY);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [open,setOpen]=useState(false);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const filtered=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return initialItems.filter(x=>{
   const matchText=!q||[x.code,x.name,x.description].some(v=>v?.toLowerCase().includes(q));
   return matchText&&(classificationFilter==="all"||x.cost_classification===classificationFilter);
  });
 },[initialItems,query,classificationFilter]);
 const active=initialItems.filter(x=>x.is_active).length;
 const direct=initialItems.filter(x=>x.cost_classification==="direct_cost").length;
 const overhead=initialItems.filter(x=>x.cost_classification==="general_overhead").length;
 const flexible=initialItems.filter(x=>x.cost_classification==="flexible").length;
 function edit(x:ExpenseCategory){
  setEditingId(x.id);
  setForm({name:x.name,description:x.description??"",isActive:x.is_active,costClassification:x.cost_classification});
  setError("");setMessage("");setOpen(true);
 }
 function add(){setEditingId(null);setForm(EMPTY);setError("");setMessage("");setOpen(true);}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setSaving(true);setError("");
  const result=editingId?await updateExpenseCategory(editingId,form):await createExpenseCategory(form);
  setSaving(false);
  if(!result.ok){setError(result.error);return;}
  setMessage(editingId?"Perubahan akun biaya berhasil disimpan.":"Akun biaya berhasil ditambahkan.");
  setOpen(false);setEditingId(null);setForm(EMPTY);router.refresh();
 }
 return <main className={styles.page}>
  <header className={styles.header}>
   <div><p className={styles.eyebrow}>DATA MASTER · KEUANGAN</p><h1>Master Akun Biaya</h1><p>Satu daftar akun untuk biaya langsung dan biaya umum perusahaan. Gunakan filter untuk melihat klasifikasinya.</p></div>
   <button className={styles.primaryButton} onClick={add} type="button">+ Tambah Akun Biaya</button>
  </header>
  <section className={styles.summary}>
   <div><strong>{direct}</strong><span>Direct Cost</span></div>
   <div><strong>{overhead}</strong><span>General Overhead</span></div>
   <div><strong>{flexible}</strong><span>Fleksibel</span></div>
  </section>
  {message&&<p className={styles.success} role="status">{message}</p>}
  {open&&<section className={styles.formCard}>
   <div className={styles.formHeading}><div><h2>{editingId?"Ubah Akun Biaya":"Tambah Akun Biaya"}</h2><p>Kode akun dibuat otomatis saat data disimpan.</p></div><button className={styles.closeButton} type="button" onClick={()=>setOpen(false)}>×</button></div>
   <form className={styles.form} onSubmit={submit}>
    <label className={styles.fieldWide}><span>Nama Akun Biaya <b>*</b></span><input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Contoh: Fee Keamanan"/></label>
    <label className={styles.fieldWide}><span>Klasifikasi Biaya <b>*</b></span>
     <select required value={form.costClassification} onChange={e=>setForm({...form,costClassification:e.target.value as Classification})}>
      <option value="direct_cost">Direct Cost — biaya langsung Project / BA</option>
      <option value="general_overhead">General Overhead — biaya umum perusahaan</option>
      <option value="flexible">Fleksibel — dapat digunakan untuk keduanya</option>
     </select>
    </label>
    <label className={styles.fieldWide}><span>Keterangan</span><textarea rows={3} maxLength={500} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Penjelasan singkat (opsional)"/></label>
    {editingId&&<label className={styles.activeToggle}><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Akun aktif dan dapat dipilih pada transaksi baru</label>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={()=>setOpen(false)} disabled={saving}>Batal</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving?"Menyimpan...":editingId?"Simpan Perubahan":"Simpan Akun Biaya"}</button></div>
   </form>
  </section>}
  <section className={styles.listCard}>
   <div className={styles.listHeading}>
    <div><h2>Daftar Akun Biaya</h2><p>{filtered.length} data ditampilkan · {active} akun aktif</p></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <select className={styles.search} aria-label="Filter klasifikasi biaya" value={classificationFilter} onChange={e=>setClassificationFilter(e.target.value)}>
      <option value="all">Semua klasifikasi</option><option value="direct_cost">Direct Cost</option><option value="general_overhead">General Overhead</option><option value="flexible">Fleksibel</option>
     </select>
     <input className={styles.search} aria-label="Cari akun biaya" placeholder="Cari kode, nama, keterangan..." value={query} onChange={e=>setQuery(e.target.value)}/>
    </div>
   </div>
   {filtered.length===0?<div className={styles.empty}><h3>{initialItems.length?"Akun biaya tidak ditemukan":"Belum ada akun biaya"}</h3><p>{initialItems.length?"Coba kata kunci atau filter lain.":"Tambahkan akun untuk mulai mengelola biaya."}</p>{!initialItems.length&&<button className={styles.primaryButton} onClick={add} type="button">+ Tambah Akun Biaya</button>}</div>
   :<div className={styles.categoryList}>{filtered.map(x=><article className={styles.categoryItem} key={x.id}>
    <div className={styles.categoryMain}><div className={styles.categoryTitle}><span className={styles.code}>{x.code}</span><span className={x.is_active?styles.active:styles.inactive}>{x.is_active?"Aktif":"Nonaktif"}</span></div><h3>{x.name}</h3><p>{x.description||"Tidak ada keterangan"}</p><small>{label(x.cost_classification)}</small></div>
    <button className={styles.editButton} type="button" onClick={()=>edit(x)}>Ubah</button>
   </article>)}</div>}
  </section>
  <p className={styles.footnote}>Master ini menjadi pusat akun untuk voucher Expenses dan aturan tarif biaya BA Penjualan. Tarif dan hasil perhitungan BA disimpan sebagai snapshot sehingga perubahan akun tidak mengubah transaksi lama. Akun yang sudah digunakan tidak dihapus permanen, cukup nonaktifkan untuk transaksi baru.</p>
 </main>;
}