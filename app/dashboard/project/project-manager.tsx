"use client";
import {useMemo,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {createProject,updateProject} from "./actions";
import styles from "./project.module.css";
export type Project={id:string;code:string;name:string;location:string|null;description:string|null;is_active:boolean};
type Form={name:string;location:string;description:string;isActive:boolean};
const EMPTY:Form={name:"",location:"",description:"",isActive:true};
const toForm=(p:Project):Form=>({name:p.name,location:p.location??"",description:p.description??"",isActive:p.is_active});
export default function ProjectManager({initialProjects}:{initialProjects:Project[]}){
 const router=useRouter();const[query,setQuery]=useState("");const[form,setForm]=useState<Form>(EMPTY);const[editingId,setEditingId]=useState<string|null>(null);const[formOpen,setFormOpen]=useState(false);const[saving,setSaving]=useState(false);const[message,setMessage]=useState("");const[errorMessage,setErrorMessage]=useState("");
 const filtered=useMemo(()=>{const t=query.trim().toLowerCase();return t?initialProjects.filter(p=>[p.code,p.name,p.location,p.description].some(v=>v?.toLowerCase().includes(t))):initialProjects},[initialProjects,query]);const active=initialProjects.filter(p=>p.is_active).length;
 function startNew(){setEditingId(null);setForm(EMPTY);setErrorMessage("");setMessage("");setFormOpen(true)}
 function startEdit(p:Project){setEditingId(p.id);setForm(toForm(p));setErrorMessage("");setMessage("");setFormOpen(true)}
 function close(){if(saving)return;setFormOpen(false);setEditingId(null);setForm(EMPTY);setErrorMessage("")}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setErrorMessage("");setMessage("");const r=editingId?await updateProject(editingId,form):await createProject(form);setSaving(false);if(!r.ok){setErrorMessage(r.error);return}setMessage(editingId?"Perubahan Project berhasil disimpan.":"Project baru berhasil ditambahkan.");setFormOpen(false);setEditingId(null);setForm(EMPTY);router.refresh()}
 return <main className={styles.page}>
 <header className={styles.header}><div><p className={styles.eyebrow}>DATA MASTER</p><h1>Master Project</h1><p>Kelola Project operasional sebagai dasar Area Kerja dan saldo Kasir per Project.</p></div><button className={styles.primaryButton} onClick={startNew} type="button">+ Tambah Project</button></header>
 <section className={styles.summary}><div><strong>{initialProjects.length}</strong><span>Total Project</span></div><div><strong>{active}</strong><span>Project aktif</span></div><div><strong>{initialProjects.length-active}</strong><span>Nonaktif</span></div></section>
 {message&&<p className={styles.success} role="status">{message}</p>}
 {formOpen&&<section className={styles.formCard}><div className={styles.formHeading}><div><h2>{editingId?"Ubah Project":"Tambah Project"}</h2><p>Kode Project dibuat otomatis saat data disimpan.</p></div><button className={styles.closeButton} type="button" onClick={close}>×</button></div>
 <form className={styles.form} onSubmit={submit}><label className={styles.fieldWide}><span>Nama Project <b>*</b></span><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} maxLength={160} required placeholder="Contoh: SentraShip - Project A"/></label>
 <label className={styles.fieldWide}><span>Lokasi</span><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})} maxLength={200} placeholder="Lokasi Project"/></label>
 <label className={styles.fieldWide}><span>Keterangan</span><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} maxLength={500} rows={3} placeholder="Keterangan tambahan (opsional)"/></label>
 {editingId&&<label className={styles.activeToggle}><input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/>Project aktif dan dapat ditugaskan kepada pengguna</label>}
 {errorMessage&&<p className={styles.error} role="alert">{errorMessage}</p>}<div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={close} disabled={saving}>Batal</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving?"Menyimpan...":editingId?"Simpan Perubahan":"Simpan Project"}</button></div></form></section>}
 <section className={styles.listCard}><div className={styles.listHeading}><div><h2>Daftar Project</h2><p>{filtered.length} data ditampilkan</p></div><input className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari kode, nama, lokasi..." aria-label="Cari Project"/></div>
 {!filtered.length?<div className={styles.empty}><h3>{initialProjects.length?"Project tidak ditemukan":"Belum ada Project"}</h3><p>{initialProjects.length?"Coba kata kunci pencarian yang lain.":"Tambahkan Project terlebih dahulu sebelum menetapkan Area Kerja pengguna."}</p>{!initialProjects.length&&<button className={styles.primaryButton} type="button" onClick={startNew}>+ Tambah Project</button>}</div>:
 <div className={styles.itemList}>{filtered.map(p=><article className={styles.item} key={p.id}><div className={styles.main}><div className={styles.itemTitle}><span className={styles.code}>{p.code}</span><span className={p.is_active?styles.active:styles.inactive}>{p.is_active?"Aktif":"Nonaktif"}</span></div><h3>{p.name}</h3><p>{p.location||"Lokasi belum diisi"}</p>{p.description&&<small>{p.description}</small>}</div><button className={styles.editButton} type="button" onClick={()=>startEdit(p)}>Ubah</button></article>)}</div>}</section>
 <p className={styles.footnote}>Project yang sudah digunakan tidak dihapus permanen. Nonaktifkan Project agar tidak dapat dipilih untuk penugasan atau transaksi baru; riwayatnya tetap tersimpan.</p></main>
}
