"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cancelExpense, createExpenseDraft, deleteExpenseDocument, openExpenseDocument, openExpensePaymentEvidence, payExpense, submitExpense, updateExpenseDraft, uploadExpenseDocuments, uploadExpensePaymentEvidence } from "./actions";
import styles from "./expenses.module.css";

export type ExpenseCategory = { id: string; code: string; name: string };
export type ProjectOption = { id: string; code: string; name: string };
type Document = { id: string; file_name: string; mime_type: string; file_size: number; uploaded_at: string };
export type Expense = {
  id: string; code: string; expense_date: string; project_id: string | null; expense_category_id: string;
  description: string; amount: number; payment_method: string; paid_method: string | null; paid_at: string | null;
  paid_amount: number | null; submitted_at: string | null;
  status: "Draft" | "Menunggu Pembayaran" | "Dibayar" | "Dibatalkan";
  cancellation_reason: string | null; cancelled_at: string | null; created_at: string;
  expense_categories: { name: string } | null; projects: { code: string; name: string } | null; expense_documents: Document[]; expense_payment_documents: Document[];
};
const formatAmount = (v: string) => v.replace(/\D/g, "").slice(0,16).replace(/\B(?=(\d{3})+(?!\d))/g,".");
const money = (v: number) => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(v);
const date = (v: string) => new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeZone:"Asia/Jakarta"}).format(new Date(v+(v.length===10?"T00:00:00":"")));
const dateTime = (v: string) => new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jakarta"}).format(new Date(v));
const bytes = (v: number) => v<1048576?`${Math.max(1,Math.round(v/1024))} KB`:`${(v/1048576).toFixed(1)} MB`;
const statusLabel = (s: Expense["status"]) => s==="Menunggu Pembayaran"?"Menunggu Pembayaran":s==="Dibayar"?"Dibayar":s;

export default function ExpenseManager({categories,projects,initialItems,balances,canCreate,canPay,canViewBalances,canCancel}:{
  categories:ExpenseCategory[];projects:ProjectOption[];initialItems:Expense[];balances:Record<string,number>;
  canCreate:boolean;canPay:boolean;canViewBalances:boolean;canCancel:boolean;
}) {
  const router=useRouter();
  const [showForm,setShowForm]=useState(false),[saving,setSaving]=useState(false);
  const [message,setMessage]=useState(""),[error,setError]=useState(""),[query,setQuery]=useState(""),[filter,setFilter]=useState("Semua");
  const [editId,setEditId]=useState(""),[dateValue,setDateValue]=useState(new Date().toLocaleDateString("en-CA"));
  const [projectId,setProjectId]=useState(projects[0]?.id??""),[categoryId,setCategoryId]=useState("");
  const [description,setDescription]=useState(""),[amount,setAmount]=useState("");
  const [busyId,setBusyId]=useState(""),[cancelId,setCancelId]=useState(""),[cancelReason,setCancelReason]=useState("");
  const [uploadId,setUploadId]=useState(""),[paymentMethods,setPaymentMethods]=useState<Record<string,string>>({});
  const filtered=useMemo(()=>initialItems.filter(item=>{
    const q=query.trim().toLowerCase();
    const match=!q||[item.code,item.description,item.projects?.name,item.expense_categories?.name].some(v=>v?.toLowerCase().includes(q));
    return match&&(filter==="Semua"||item.status===filter);
  }),[initialItems,query,filter]);
  const active=initialItems.filter(i=>i.status!=="Dibatalkan");
  const totalPaid=initialItems.filter(i=>i.status==="Dibayar").reduce((s,i)=>s+Number(i.paid_amount??i.amount),0);
  function clearForm(){setEditId("");setDateValue(new Date().toLocaleDateString("en-CA"));setProjectId(projects[0]?.id??"");setCategoryId("");setDescription("");setAmount("");}
  function startEdit(item:Expense){setEditId(item.id);setDateValue(item.expense_date);setProjectId(item.project_id??"");setCategoryId(item.expense_category_id);setDescription(item.description);setAmount(formatAmount(String(item.amount)));setShowForm(true);setError("");}
  async function saveDraft(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setSaving(true);setError("");setMessage("");
    const input={expenseDate:dateValue,projectId,categoryId,description,amount:amount.replace(/\./g,"")};
    const result=editId?await updateExpenseDraft({expenseId:editId,...input}):await createExpenseDraft(input);
    setSaving(false);if(!result.ok){setError(result.error);return;}
    setMessage(editId?"Draft berhasil diperbarui.":"Draft voucher berhasil dibuat.");
    setShowForm(false);clearForm();router.refresh();
  }
  async function sendVoucher(id:string){
    setBusyId(id);setError("");setMessage("");const result=await submitExpense(id);setBusyId("");
    if(!result.ok){setError(result.error);return;}setMessage("Voucher dikirim ke antrean Kasir. Data terkunci dari perubahan staf.");router.refresh();
  }
  async function makePayment(item:Expense){
    setBusyId(item.id);setError("");setMessage("");
    const result=await payExpense({expenseId:item.id,paymentMethod:paymentMethods[item.id]??"Transfer"});setBusyId("");
    if(!result.ok){setError(result.error);return;}setMessage("Pembayaran berhasil. Saldo Kasir Project telah dikurangi.");router.refresh();
  }
  async function cancel(id:string,e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusyId(id);setError("");setMessage("");
    const result=await cancelExpense(id,cancelReason);setBusyId("");
    if(!result.ok){setError(result.error);return;}setCancelId("");setCancelReason("");setMessage("Voucher dibatalkan. Riwayat dan dokumen tetap tersimpan.");router.refresh();
  }
  async function uploadDocs(id:string,e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=e.currentTarget;setBusyId(id);setError("");setMessage("");
    const result=await uploadExpenseDocuments(id,new FormData(form));setBusyId("");
    if(!result.ok){setError(result.error);return;}form.reset();setUploadId("");setMessage("Dokumen billing berhasil ditambahkan.");router.refresh();
  }
  async function uploadPaymentEvidence(id:string,e:FormEvent<HTMLFormElement>){\n    e.preventDefault();const form=e.currentTarget;setBusyId(id);setError("");setMessage("");\n    const result=await uploadExpensePaymentEvidence(id,new FormData(form));setBusyId("");\n    if(!result.ok){setError(result.error);return;}form.reset();setMessage("Bukti transfer berhasil diunggah. Silakan konfirmasi pembayaran.");router.refresh();\n  }\n  async function viewPaymentEvidence(id:string){\n    const tab=window.open("about:blank","_blank");setBusyId(id);const result=await openExpensePaymentEvidence(id);setBusyId("");\n    if(!result.ok||!result.url){tab?.close();setError(result.ok?"Tautan bukti tidak tersedia.":result.error);return;}\n    if(tab)tab.location.href=result.url;else window.location.href=result.url;\n  }\n  async function viewDoc(id:string){
    const tab=window.open("about:blank","_blank");setBusyId(id);const result=await openExpenseDocument(id);setBusyId("");
    if(!result.ok||!result.url){tab?.close();setError(result.ok?"Tautan dokumen tidak tersedia.":result.error);return;}
    if(tab)tab.location.href=result.url;else window.location.href=result.url;
  }
  async function deleteDoc(id:string){
    if(!window.confirm("Hapus permanen dokumen billing ini?"))return;
    setBusyId(id);const result=await deleteExpenseDocument(id);setBusyId("");
    if(!result.ok){setError(result.error);return;}setMessage("Dokumen berhasil dihapus.");router.refresh();
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>KAS & OPERASIONAL</p><h1>Pengeluaran / Expenses</h1><p>Staf membuat voucher. Kasir memeriksa dan membayar dari saldo Project.</p></div>
      {canCreate&&<button className={styles.primary} type="button" onClick={()=>{setShowForm(v=>!v);if(showForm)clearForm();setError("");}}>{showForm?"Tutup Form":"+ Buat Voucher Expenses"}</button>}
    </header>
    <section className={styles.summary}><div><strong>{initialItems.length}</strong><span>Total voucher & riwayat</span></div><div><strong>{active.length}</strong><span>Belum dibatalkan</span></div><div><strong>{money(totalPaid)}</strong><span>Total sudah dibayar</span></div></section>
    {message&&<p className={styles.success} role="status">{message}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
    {showForm&&canCreate&&<section className={styles.panel}><h2>{editId?"Ubah Draft Voucher":"Buat Draft Voucher"}</h2><p>Draft dapat diubah. Setelah dikirim, voucher masuk ke antrean Kasir dan tidak dapat diedit staf.</p>
      <form className={styles.form} onSubmit={saveDraft}>
        <label>Tanggal *<input required type="date" value={dateValue} onChange={e=>setDateValue(e.target.value)}/></label>
        <label>Project *<select required value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Pilih Project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label>Kategori Expenses *<select required value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Pilih kategori</option>{categories.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <label className={styles.wide}>Keterangan / Keperluan *<textarea required rows={3} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Contoh: Pembelian konsumsi tim lapangan"/></label>
        <label className={styles.amountField}>Nominal (Rp) *<input className={styles.amountInput} required inputMode="numeric" value={amount} onChange={e=>setAmount(formatAmount(e.target.value))} placeholder="0"/></label>
        <div className={styles.wide}><button className={styles.primary} disabled={saving||!projects.length||!categories.length}>{saving?"Menyimpan...":editId?"Simpan Perubahan Draft":"Simpan Draft"}</button></div>
        {!projects.length&&<p className={styles.error}>Area kerja Project belum tersedia untuk akun ini.</p>}
      </form>
    </section>}
    {canViewBalances&&<section className={styles.balances??styles.panel}><div className={styles.listHead}><div><h2>Saldo Kasir per Project</h2><p>Saldo bersama Project. Berkurang hanya setelah pembayaran voucher berhasil.</p></div></div>
      <div className={styles.summary}>{projects.map(p=><div key={p.id}><strong>{money(balances[p.id]??0)}</strong><span>{p.code} · {p.name}</span></div>)}</div>
    </section>}
    <section className={styles.panel}><div className={styles.listHead}><div><h2>Daftar Voucher Expenses</h2><p>{filtered.length} data ditampilkan · maksimal 300 terbaru</p></div><div className={styles.filters}><input placeholder="Cari kode, Project, keterangan..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={filter} onChange={e=>setFilter(e.target.value)}><option>Semua</option><option>Draft</option><option>Menunggu Pembayaran</option><option>Dibayar</option><option>Dibatalkan</option></select></div></div>
      {!filtered.length?<div className={styles.empty}><h3>Belum ada voucher Expenses</h3><p>Voucher baru akan tampil di sini setelah dibuat.</p></div>:<div className={styles.list}>{filtered.map(item=><article className={styles.item} key={item.id}>
        <div className={styles.itemTop}><div><span className={styles.code}>{item.code}</span><span className={item.status==="Dibayar"?styles.active:item.status==="Dibatalkan"?styles.cancelled:styles.pending}>{statusLabel(item.status)}</span></div><time>{date(item.expense_date)}</time></div>
        <div className={styles.itemMain}><div><h3>{item.description}</h3><p>{item.projects?item.projects.code+" · "+item.projects.name:"Riwayat sebelum alur voucher"} · {item.expense_categories?.name??"Kategori tidak tersedia"}</p></div><strong className={styles.amount}>{money(Number(item.amount))}</strong></div>
        {item.status==="Dibayar"&&<p className={styles.note}>Dibayar penuh · {item.paid_method??item.payment_method} · {item.paid_at?dateTime(item.paid_at):"waktu tidak tersedia"}</p>}
        {item.status==="Dibatalkan"&&<p className={styles.cancelNote}>Dibatalkan: {item.cancellation_reason}</p>}\n        {item.status==="Dibayar"&&!!item.expense_payment_documents?.length&&<div className={styles.docs}><strong>Bukti Pembayaran ({item.expense_payment_documents.length})</strong><div className={styles.docList}>{item.expense_payment_documents.map(d=><div className={styles.doc} key={d.id}><span className={styles.fileIcon}>{d.mime_type==="application/pdf"?"PDF":"IMG"}</span><span className={styles.fileName}><strong>{d.file_name}</strong><small>{bytes(Number(d.file_size))}</small></span><button type="button" onClick={()=>viewPaymentEvidence(d.id)}>Lihat</button></div>)}</div></div>}
        {item.status==="Menunggu Pembayaran"&&canPay&&<div className={styles.executeForm}><p>Saldo Project saat ini: <strong>{money(item.project_id?balances[item.project_id]??0:0)}</strong></p><label>Metode Pembayaran<select value={paymentMethods[item.id]??"Transfer"} onChange={e=>setPaymentMethods(v=>({...v,[item.id]:e.target.value}))}><option>Transfer</option><option>Tunai</option></select></label>{(paymentMethods[item.id]??"Transfer")==="Transfer"&&<div className={styles.docs}><strong>Bukti Transfer ({item.expense_payment_documents?.length??0})</strong><form onSubmit={e=>uploadPaymentEvidence(item.id,e)}><label className={styles.fileButton}>+ Unggah Bukti Transfer<input name="files" type="file" multiple required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/></label><button className={styles.smallPrimary} disabled={busyId===item.id}>Unggah Bukti</button></form>{!!item.expense_payment_documents?.length&&<div className={styles.docList}>{item.expense_payment_documents.map(d=><div className={styles.doc} key={d.id}><span className={styles.fileIcon}>{d.mime_type==="application/pdf"?"PDF":"IMG"}</span><span className={styles.fileName}><strong>{d.file_name}</strong><small>{bytes(Number(d.file_size))}</small></span><button type="button" onClick={()=>viewPaymentEvidence(d.id)}>Lihat</button></div>)}</div>}</div>}<button type="button" className={styles.primary} disabled={busyId===item.id||((paymentMethods[item.id]??"Transfer")==="Transfer"&&!(item.expense_payment_documents?.length))} onClick={()=>makePayment(item)}>{busyId===item.id?"Memproses...":"Konfirmasi Bayar Penuh"}</button></div>}
        {item.status==="Draft"&&canCreate&&<div className={styles.itemActions}><button type="button" onClick={()=>startEdit(item)}>Ubah Draft</button><button type="button" className={styles.primary} onClick={()=>sendVoucher(item.id)} disabled={busyId===item.id}>{busyId===item.id?"Mengirim...":"Submit ke Kasir"}</button></div>}
        {item.status==="Draft"&&canCreate&&<div className={styles.docs}><div className={styles.docsHead}><strong>Billing / Dokumen ({item.expense_documents?.length??0})</strong><form onSubmit={e=>uploadDocs(item.id,e)}><label className={styles.fileButton}>+ Tambah Billing<input name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e=>{if(e.target.files?.length)setUploadId(item.id);}}/></label>{uploadId===item.id&&<button className={styles.smallPrimary} disabled={busyId===item.id}>Unggah</button>}</form></div>
          {!!item.expense_documents?.length&&<div className={styles.docList}>{item.expense_documents.map(d=><div className={styles.doc} key={d.id}><span className={styles.fileIcon}>{d.mime_type==="application/pdf"?"PDF":"IMG"}</span><span className={styles.fileName}><strong>{d.file_name}</strong><small>{bytes(Number(d.file_size))}</small></span><button type="button" onClick={()=>viewDoc(d.id)}>Lihat</button><button type="button" className={styles.delete} onClick={()=>deleteDoc(d.id)}>Hapus</button></div>)}</div>}
        </div>}
        {item.status!=="Draft"&&!!item.expense_documents?.length&&<div className={styles.docs}><strong>Billing / Dokumen ({item.expense_documents.length})</strong><div className={styles.docList}>{item.expense_documents.map(d=><div className={styles.doc} key={d.id}><span className={styles.fileIcon}>{d.mime_type==="application/pdf"?"PDF":"IMG"}</span><span className={styles.fileName}><strong>{d.file_name}</strong><small>{bytes(Number(d.file_size))}</small></span><button type="button" onClick={()=>viewDoc(d.id)}>Lihat</button></div>)}</div></div>}
        {canCancel&&(item.status==="Draft"||item.status==="Menunggu Pembayaran")&&<div className={styles.itemActions}>{cancelId===item.id?<form className={styles.cancelForm} onSubmit={e=>cancel(item.id,e)}><label>Alasan pembatalan *<textarea required rows={2} maxLength={500} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label><button className={styles.danger} disabled={busyId===item.id}>Konfirmasi Pembatalan</button><button type="button" onClick={()=>{setCancelId("");setCancelReason("");}}>Kembali</button></form>:<button type="button" className={styles.cancelButton} onClick={()=>setCancelId(item.id)}>Batalkan Voucher</button>}</div>}
      </article>)}</div>}
    </section>
    <p className={styles.note}>Draft dapat diubah. Setelah Submit, voucher terkunci dan menunggu Kasir. Pembayaran harus penuh; saldo tidak cukup berarti pembayaran diblokir. Voucher yang sudah dibayar tidak dapat dibatalkan.</p>
  </main>;
}
