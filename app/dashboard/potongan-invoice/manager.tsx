"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {saveInvoiceDeduction} from "./actions";
type Component={id:string;customer_id:string|null;code:string;name:string;calculation_method:string;default_value:number;is_active:boolean;sort_order:number;notes:string|null};
type Customer={id:string;code:string;name:string};
const empty={customerId:"",code:"",name:"",method:"percent",value:"",sortOrder:"100",notes:"",active:true};
const money=(v:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(v);
export default function DeductionMaster({components,customers}:{components:Component[];customers:Customer[]}){
 const router=useRouter();const [form,setForm]=useState(empty);const [editId,setEditId]=useState("");const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
 function edit(x:Component){setEditId(x.id);setForm({customerId:x.customer_id??"",code:x.code,name:x.name,method:x.calculation_method,value:String(x.default_value),sortOrder:String(x.sort_order),notes:x.notes??"",active:x.is_active});setOpen(true);setError("");}
 function add(){setEditId("");setForm(empty);setOpen(true);setError("");}
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");const r=await saveInvoiceDeduction({id:editId||undefined,...form});setBusy(false);if(!r.ok){setError(r.error);return;}setOpen(false);setMessage("Master potongan berhasil disimpan.");router.refresh();}
 return <main style={{maxWidth:1000,margin:"0 auto",padding:"28px 18px 56px",color:"var(--ink,#172b4d)"}}>
  <header style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><p style={{fontSize:11,fontWeight:800,color:"#155eef",letterSpacing:".12em"}}>DATA MASTER · OWNER</p><h1 style={{fontSize:30,margin:"4px 0"}}>Master Potongan Invoice</h1><p style={{color:"var(--muted,#62718a)",fontSize:13}}>Komponen potongan nilai invoice BA, seperti PPh dan SCF. Bukan voucher Expenses.</p></div><button onClick={add} style={primary}>+ Tambah Komponen</button></header>
  {message&&<p style={notice}>{message}</p>}{error&&<p style={{...notice,color:"#b42318"}}>{error}</p>}
  <section style={panel}><h2 style={{fontSize:17}}>Daftar Komponen</h2><p style={{fontSize:12,color:"#64748b"}}>Default awal hanya untuk pengisian Finance. Finance tetap mencocokkan nominal dengan rincian invoice aktual.</p>
   {components.map(x=><article key={x.id} style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:"13px 0",borderTop:"1px solid #e2e8f0"}}><div><b>{x.name}</b> <small style={{color:"#64748b"}}>· {x.code} · {x.is_active?"Aktif":"Nonaktif"}</small><div style={{fontSize:12,color:"#64748b",marginTop:4}}>{customers.find(c=>c.id===x.customer_id)?.name??"Semua pembeli"} · {x.calculation_method==="percent"?x.default_value+"%":money(Number(x.default_value))}</div>{x.notes&&<small style={{color:"#64748b"}}>{x.notes}</small>}</div><button style={secondary} onClick={()=>edit(x)}>Ubah</button></article>)}
   {!components.length&&<p>Belum ada komponen potongan.</p>}
  </section>
  {open&&<section style={panel}><h2 style={{fontSize:17}}>{editId?"Ubah Komponen":"Tambah Komponen"}</h2><form onSubmit={save} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
   <label style={field}>Berlaku Untuk<select style={control} value={form.customerId} onChange={e=>setForm(v=>({...v,customerId:e.target.value}))}><option value="">Semua Pembeli</option>{customers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
   <label style={field}>Kode<input style={control} required maxLength={24} value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value.toUpperCase()}))} placeholder="PPH / SCF"/></label>
   <label style={field}>Nama Komponen<input style={control} required maxLength={100} value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="Contoh: SCF PT TIMAH"/></label>
   <label style={field}>Metode Default<select style={control} value={form.method} onChange={e=>setForm(v=>({...v,method:e.target.value}))}><option value="percent">Persentase (%)</option><option value="fixed">Nominal Rupiah</option></select></label>
   <label style={field}>Nilai Default<input style={control} required type="number" min="0" step="0.0001" value={form.value} onChange={e=>setForm(v=>({...v,value:e.target.value}))}/></label>
   <label style={field}>Urutan<input style={control} type="number" step="1" value={form.sortOrder} onChange={e=>setForm(v=>({...v,sortOrder:e.target.value}))}/></label>
   <label style={{...field,gridColumn:"1/-1"}}>Keterangan<input style={control} maxLength={500} value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></label>
   <label style={{...field,gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8}}><input type="checkbox" checked={form.active} onChange={e=>setForm(v=>({...v,active:e.target.checked}))}/> Aktif untuk settlement BA berikutnya</label>
   <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"end",gap:8}}><button type="button" style={secondary} onClick={()=>setOpen(false)}>Batal</button><button style={primary} disabled={busy}>{busy?"Menyimpan...":"Simpan"}</button></div>
  </form></section>}
  <p style={{fontSize:12,color:"#64748b",marginTop:14}}>Perubahan master hanya berlaku untuk settlement berikutnya. Settlement lama menyimpan snapshot komponen dan nominalnya.</p>
 </main>;
}
const panel={background:"var(--surface,#fff)",border:"1px solid var(--line,#e2e8f0)",borderRadius:14,padding:18,marginTop:18};
const primary={background:"#155eef",color:"#fff",border:0,borderRadius:9,padding:"11px 15px",fontWeight:800,cursor:"pointer"};
const secondary={background:"transparent",color:"inherit",border:"1px solid #cbd5e1",borderRadius:8,padding:"8px 12px",fontWeight:700,cursor:"pointer"};
const notice={padding:10,borderRadius:8,background:"#eef6ff",color:"#155eef",fontSize:12};
const field={display:"grid",gap:6,fontSize:12,fontWeight:700};
const control={width:"100%",minHeight:40,border:"1px solid #cbd5e1",borderRadius:8,padding:"8px 10px",background:"var(--surface,#fff)",color:"inherit",font:"inherit"};