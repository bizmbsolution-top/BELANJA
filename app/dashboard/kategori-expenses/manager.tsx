"use client";
import {useMemo,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {createExpenseCategory,updateExpenseCategory} from "./actions";
import styles from "../kategori/category.module.css";

type Classification="direct_cost"|"general_overhead"|"flexible";
export type ExpenseCategory={id:string;code:string;name:string;description:string|null;is_active:boolean;cost_classification:Classification;expense_type?:ExpenseType;calculation_method?:Method;calculation_basis?:string;calculation_rate?:number|null};
type Method="manual"|"percentage"|"per_kg"|"per_grade_point"|"per_kg_grade"|"per_transaction"|"fixed";
type ExpenseType="company_payable"|"transaction_deduction";\ntype Form={name:string;description:string;isActive:boolean;costClassification:Classification;expenseType:ExpenseType;calculationMethod:Method;calculationRate:string};
const EMPTY:Form={name:"",description:"",isActive:true,costClassification:"flexible",expenseType:"company_payable",calculationMethod:"manual",calculationRate:""};
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
  setForm({name:x.name,description:x.description??"",isActive:x.is_active,costClassification:x.cost_classification,expenseType:x.expense_type??"company_payable",calculationMethod:x.calculation_method??"manual",calculationRate:x.calculation_rate==null?"":(x.calculation_basis==="purchase_cost"?"purchase:":"final:")+String(x.calculation_rate)});
  setError("");setMessage("");setOpen(true);
 }
 function add(){setEditingId(null);setForm(EMPTY);setError("");setMessage("");setOpen(true);}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setSaving(true);setError("");
  const result=editingId?await updateExpenseCategory(editingId,form):await createExpenseCategory(form);
  setSaving(false);
  if(!result.ok){setError(result.error);return;}
  setMessage(editingId?"Perubahan kategori pengeluaran berhasil disimpan.":"Kategori berhasil ditambahkan.");
  setOpen(false);setEditingId(null);setForm(EMPTY);router.refresh();
 }
 return <main className={styles.page}>
  <header className={styles.header}>
   <div><p className={styles.eyebrow}>DATA MASTER · KEUANGAN</p><h1>Master Kategori Pengeluaran</h1><p>Kelola kategori pengeluaran perusahaan. Gunakan klasifikasi untuk membedakan biaya langsung dan biaya umum.</p></div>
   <button className={styles.primaryButton} onClick={add} type="button">+ Tambah Kategori</button>
  </header>
  <section className={styles.summary}>
   <div><strong>{direct}</strong><span>Direct Cost</span></div>
   <div><strong>{overhead}</strong><span>General Overhead</span></div>
   <div><strong>{flexible}</strong><span>Fleksibel</span></div>
  </section>
  {message&&<p className={styles.success} role="status">{message}</p>}
  {open&&<section className={styles.formCard}>
   <div className={styles.formHeading}><div><h2>{editingId?"Ubah Kategori":"Tambah Kategori"}</h2><p>Kode kategori dibuat otomatis saat data disimpan.</p></div><button className={styles.closeButton} type="button" onClick={()=>setOpen(false)}>×</button></div>
   <form className={styles.form} onSubmit={submit}>
    <label className={styles.fieldWide}><span>Nama Kategori <b>*</b></span><input required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Contoh: Fee Keamanan"/></label>
    <label className={styles.fieldWide}><span>Klasifikasi Biaya <b>*</b></span>
     <select required value={form.costClassification} onChange={e=>setForm({...form,costClassification:e.target.value as Classification})}>
      <option value="direct_cost">Direct Cost — biaya langsung Project / BA</option>
      <option value="general_overhead">General Overhead — biaya umum perusahaan</option>
      <option value="flexible">Fleksibel — dapat digunakan untuk keduanya</option>
     </select>
    </label>
    <label className={styles.fieldWide}><span>Jenis Biaya *</span><select value={form.expenseType} onChange={e=>setForm({...form,expenseType:e.target.value as ExpenseType})}><option value="company_payable">Kewajiban Perusahaan (dapat dibuat AP)</option><option value="transaction_deduction">Potongan Transaksi (bukan AP)</option></select></label>
    <label className={styles.fieldWide}><span>Metode Perhitungan *</span><select value={form.calculationMethod} onChange={e=>setForm({...form,calculationMethod:e.target.value as Method,calculationRate:""})}><option value="manual">Manual / nominal diisi Finance</option><option value="percentage">Persentase dari nilai BA atau biaya pembelian</option><option value="per_kg">Tarif Rupiah per Kg</option><option value="per_grade_point">Tarif Rupiah per poin Grade</option><option value="per_kg_grade">Tarif per Kg × Grade (grade/100)</option><option value="per_transaction">Nominal per BA/transaksi</option><option value="fixed">Nominal tetap</option></select></label>
    {form.calculationMethod==="percentage"&&<label className={styles.fieldWide}><span>Dasar Persentase *</span><select value={form.calculationRate.startsWith("purchase:")?"purchase":"final"} onChange={e=>setForm({...form,calculationRate:(e.target.value==="purchase"?"purchase:":"final:")+form.calculationRate.replace(/^(purchase:|final:)/,"")})}><option value="final">Nilai Final BA</option><option value="purchase">Biaya Pembelian</option></select></label>}
    {form.calculationMethod!=="manual"&&<label className={styles.fieldWide}><span>{form.calculationMethod==="percentage"?"Tarif (%)":"Tarif (Rupiah)"} *</span><input required type="number" min="0.000001" step="any" value={form.calculationRate.replace(/^(purchase:|final:)/,"")} onChange={e=>setForm({...form,calculationRate:(form.calculationRate.startsWith("purchase:")?"purchase:":"final:")+e.target.value})} placeholder="Masukkan tarif"/></label>}
    <label className={styles.fieldWide}><span>Keterangan</span><textarea rows={3} maxLength={500} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Penjelasan singkat (opsional)"/></label>
    {editingId&&<label className={styles.activeToggle}><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Kategori aktif dan dapat dipilih pada transaksi baru</label>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={()=>setOpen(false)} disabled={saving}>Batal</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving?"Menyimpan...":editingId?"Simpan Perubahan":"Simpan Akun Biaya"}</button></div>
   </form>
  </section>}
  <section className={styles.listCard}>
   <div className={styles.listHeading}>
    <div><h2>Daftar Kategori Pengeluaran</h2><p>{filtered.length} data ditampilkan · {active} kategori aktif</p></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <select className={styles.search} aria-label="Filter klasifikasi biaya" value={classificationFilter} onChange={e=>setClassificationFilter(e.target.value)}>
      <option value="all">Semua klasifikasi</option><option value="direct_cost">Direct Cost</option><option value="general_overhead">General Overhead</option><option value="flexible">Fleksibel</option>
     </select>
     <input className={styles.search} aria-label="Cari kategori pengeluaran" placeholder="Cari kode, nama, keterangan..." value={query} onChange={e=>setQuery(e.target.value)}/>
    </div>
   </div>
   {filtered.length===0?<div className={styles.empty}><h3>{initialItems.length?"Kategori tidak ditemukan":"Belum ada kategori pengeluaran"}</h3><p>{initialItems.length?"Coba kata kunci atau filter lain.":"Tambahkan kategori untuk mulai mengelola pengeluaran."}</p>{!initialItems.length&&<button className={styles.primaryButton} onClick={add} type="button">+ Tambah Kategori</button>}</div>
   :<div className={styles.categoryList}>{filtered.map(x=><article className={styles.categoryItem} key={x.id}>
    <div className={styles.categoryMain}><div className={styles.categoryTitle}><span className={styles.code}>{x.code}</span><span className={x.is_active?styles.active:styles.inactive}>{x.is_active?"Aktif":"Nonaktif"}</span></div><h3>{x.name}</h3><p>{x.description||"Tidak ada keterangan"}</p><small>{label(x.cost_classification)}</small></div>
    <button className={styles.editButton} type="button" onClick={()=>edit(x)}>Ubah</button>
   </article>)}</div>}
  </section>
  <p className={styles.footnote}>Master kategori ini digunakan untuk mengelompokkan pengeluaran perusahaan. Ini bukan Chart of Accounts dan tidak membentuk jurnal debit/kredit. Kategori yang sudah digunakan tidak dihapus permanen; nonaktifkan untuk transaksi baru.</p>
 </main>;
}