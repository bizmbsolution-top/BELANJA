"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelPurchaseReturnDraft, createPurchaseReturnDraft, postPurchaseReturn, setPurchaseReturnCreditDecision } from "../pembelian/actions";

type CaseRow={id:string;lotCode:string;lotId:string;quarantinedWeightKg:number;returnedWeightKg:number;releasedWeightKg:number;reservedWeightKg:number;availableWeightKg:number;reason:string;createdAt:string};
type CreditRow={id:string;supplier_id:string;returned_weight_kg:number;unit_price_per_kg:number;credit_amount:number;remaining_amount:number;decision:string;status:string;supplier:{code:string;name:string}|null};
type ReturnRow={id:string;code:string;status:string;return_date:string;reason:string;created_at:string;posted_at:string|null;purchase_return_items:{id:string;weight_kg:number;lot_id:string;inventory_lots:{code:string}|{code:string}[]|null;credit:CreditRow|null}[]};
const kg=(n:number)=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:3}).format(n);
const rupiah=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
export default function ReturnClient({cases,returns}:{cases:CaseRow[];returns:ReturnRow[]}){
 const router=useRouter();
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [reason,setReason]=useState("");
 const [notes,setNotes]=useState("");
 const [weights,setWeights]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 async function createDraft(){
  const items=cases.filter(c=>Number(weights[c.id]??0)>0).map(c=>({quarantineId:c.id,weightKg:weights[c.id]}));
  if(!items.length){setError("Masukkan kuantitas Return minimal pada satu Lot Karantina.");return;}
  setBusy(true);setError("");setMessage("");
  const result=await createPurchaseReturnDraft({returnDate:date,reason,notes,items});
  setBusy(false);
  if(!result.ok){setError(result.error);return;}
  setMessage("Draft Return berhasil dibuat. Stok fisik belum berubah.");
  setWeights({});setReason("");setNotes("");router.refresh();
 }
 async function post(id:string){
  if(!window.confirm("Posted Return? Stok fisik akan berkurang sesuai kuantitas Draft."))return;
  setBusy(true);setError("");setMessage("");
  const result=await postPurchaseReturn(id);setBusy(false);
  if(!result.ok){setError(result.error);return;}
  setMessage("Return berhasil di-Posted. Stok fisik gudang telah diperbarui.");router.refresh();
 }
 async function cancel(id:string){
  if(!window.confirm("Batalkan Draft Return ini? Kuantitas Karantina akan tersedia kembali."))return;
  setBusy(true);setError("");setMessage("");
  const result=await cancelPurchaseReturnDraft(id);setBusy(false);
  if(!result.ok){setError(result.error);return;}
  setMessage("Draft Return dibatalkan.");router.refresh();
 }
 async function decideCredit(id:string,decision:"replacement"|"refund"){
  const label=decision==="replacement"?"Penggantian Barang":"Pengembalian Uang";
  if(!window.confirm("Tetapkan penyelesaian Return sebagai "+label+"?"))return;
  setBusy(true);setError("");setMessage("");
  const result=await setPurchaseReturnCreditDecision(id,decision);setBusy(false);
  if(!result.ok){setError(result.error);return;}
  setMessage("Keputusan "+label+" berhasil disimpan.");router.refresh();
 }
 return <main style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px",color:"var(--foreground,#172033)"}}>
  <header style={{marginBottom:24}}><p style={{fontSize:12,letterSpacing:1.4,fontWeight:700,opacity:.65}}>OPERASIONAL · PEMBELIAN</p><h1 style={{fontSize:26,margin:"6px 0"}}>Return Pembelian</h1><p style={{opacity:.72}}>Return hanya berasal dari barang Karantina. Draft tidak mengurangi stok; Posted mencatat barang keluar.</p></header>
  {message&&<p role="status" style={{padding:12,background:"#e8f5ee",borderRadius:8}}>{message}</p>}
  {error&&<p role="alert" style={{padding:12,background:"#fff0ef",borderRadius:8,color:"#a22"}}>{error}</p>}
  <section style={{border:"1px solid var(--border,#ddd)",borderRadius:12,padding:16,marginBottom:24}}>
   <h2 style={{fontSize:18,marginTop:0}}>Buat Draft Return</h2>
   <p style={{fontSize:13,opacity:.7}}>Semua Karantina aktif tetap ditampilkan, termasuk yang seluruh kuantitasnya sudah dialokasikan pada Draft. Hanya saldo yang masih tersedia yang dapat dimasukkan ke Draft baru.</p>
   <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:650}}>
     <thead><tr>{["Lot","Karantina","Sudah Return","Dialokasikan Draft","Tersedia untuk Return","Berat Return (kg)"].map(x=><th key={x} style={{textAlign:"left",padding:9,borderBottom:"1px solid var(--border,#ddd)"}}>{x}</th>)}</tr></thead>
     <tbody>{cases.map(c=><tr key={c.id}>
      <td style={{padding:9,borderBottom:"1px solid var(--border,#ddd)"}}><strong>{c.lotCode}</strong><div style={{opacity:.65}}>{c.reason}</div></td>
      <td style={{padding:9}}>{kg(c.quarantinedWeightKg)} kg</td><td style={{padding:9}}>{kg(c.returnedWeightKg)} kg</td><td style={{padding:9}}>{kg(c.reservedWeightKg)} kg</td><td style={{padding:9}}><strong>{kg(c.availableWeightKg)} kg</strong></td>
      <td style={{padding:9}}><input aria-label={"Berat Return "+c.lotCode} type="number" min="0" max={c.availableWeightKg} step="0.001" disabled={busy||c.availableWeightKg<=0.0001} value={weights[c.id]??""} onChange={e=>setWeights(v=>({...v,[c.id]:e.target.value}))} placeholder={c.availableWeightKg>0.0001?"0":"Sudah dialokasikan"} style={{width:110,padding:8,border:"1px solid var(--border,#ccc)",borderRadius:6}}/></td>
     </tr>)}
     {!cases.length&&<tr><td colSpan={6} style={{padding:18,textAlign:"center",opacity:.65}}>Belum ada data Karantina aktif.</td></tr>}
     </tbody>
    </table>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginTop:16}}>
    <label style={{fontSize:13}}>Tanggal Return<input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{display:"block",width:"100%",padding:9,marginTop:5,border:"1px solid var(--border,#ccc)",borderRadius:6}}/></label>
    <label style={{fontSize:13}}>Alasan Return<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Contoh: kadar tidak sesuai" style={{display:"block",width:"100%",padding:9,marginTop:5,border:"1px solid var(--border,#ccc)",borderRadius:6}}/></label>
    <label style={{fontSize:13}}>Catatan (opsional)<input value={notes} onChange={e=>setNotes(e.target.value)} style={{display:"block",width:"100%",padding:9,marginTop:5,border:"1px solid var(--border,#ccc)",borderRadius:6}}/></label>
   </div>
   <button type="button" disabled={busy||!cases.length} onClick={createDraft} style={{marginTop:16,padding:"10px 18px",border:0,borderRadius:7,background:"#173d62",color:"white",fontWeight:700,cursor:"pointer"}}>{busy?"Memproses…":"Simpan Draft Return"}</button>
  </section>
  <section style={{border:"1px solid var(--border,#ddd)",borderRadius:12,padding:16}}>
   <h2 style={{fontSize:18,marginTop:0}}>Daftar Return & Riwayat</h2>
   <div style={{display:"grid",gap:10}}>
    {returns.map(r=><article key={r.id} style={{border:"1px solid var(--border,#ddd)",borderRadius:9,padding:13,display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
     <div><strong>{r.code}</strong> · {r.status}<div style={{fontSize:13,opacity:.7}}>{r.return_date} · {r.reason}</div><div style={{fontSize:12,marginTop:5,display:"grid",gap:8}}>{(r.purchase_return_items??[]).map(item=>{const lot=Array.isArray(item.inventory_lots)?item.inventory_lots[0]:item.inventory_lots;return <div key={item.id}>
       <div style={{marginRight:10}}><strong>{lot?.code??"Lot"}</strong>: {kg(Number(item.weight_kg))} kg</div>
       {item.credit&&<div style={{marginTop:5,padding:9,borderRadius:7,background:"var(--surface-secondary,rgba(120,130,140,.08))"}}>
        <div><strong>Kredit Supplier · {item.credit.supplier?.name??"Supplier"}</strong></div>
        <div>{kg(Number(item.credit.returned_weight_kg))} kg × {rupiah(Number(item.credit.unit_price_per_kg))}/kg</div>
        <div>Nilai awal: {rupiah(Number(item.credit.credit_amount))} · Sisa: {rupiah(Number(item.credit.remaining_amount))}</div>
        <div>Status: {item.credit.status==="pending_decision"?"Menunggu keputusan":item.credit.status==="available"?"Kredit penggantian tersedia":item.credit.status==="partially_used"?"Sebagian digunakan":item.credit.status==="used"?"Sudah digunakan":item.credit.status==="refund_pending"?"Menunggu pengembalian uang":"Selesai"}</div>
        {(item.credit.status==="pending_decision"||item.credit.status==="available"||item.credit.status==="refund_pending")&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
         <button type="button" disabled={busy} onClick={()=>decideCredit(item.credit!.id,"replacement")} style={{padding:"7px 10px",border:0,borderRadius:6,background:"#176342",color:"white"}}>{item.credit.status==="pending_decision"?"Penggantian Barang":"Ubah ke Penggantian Barang"}</button>
         <button type="button" disabled={busy} onClick={()=>decideCredit(item.credit!.id,"refund")} style={{padding:"7px 10px",border:"1px solid var(--border,#bbb)",borderRadius:6,background:"transparent"}}>{item.credit.status==="pending_decision"?"Pengembalian Uang":"Ubah ke Pengembalian Uang"}</button>
        </div>}
       </div>}
      </div>;})}</div><div style={{fontSize:12,opacity:.6}}>Dibuat {new Date(r.created_at).toLocaleString("id-ID")}{r.posted_at?" · Posted "+new Date(r.posted_at).toLocaleString("id-ID"):""}</div></div>
     {r.status==="Draft"&&<div style={{display:"flex",gap:8,alignItems:"center"}}><button type="button" disabled={busy} onClick={()=>post(r.id)} style={{padding:"8px 12px",border:0,borderRadius:6,background:"#176342",color:"white"}}>Posted</button><button type="button" disabled={busy} onClick={()=>cancel(r.id)} style={{padding:"8px 12px",border:"1px solid var(--border,#bbb)",borderRadius:6,background:"transparent"}}>Batalkan</button></div>}
    </article>)}
    {!returns.length&&<p style={{opacity:.65}}>Belum ada dokumen Return.</p>}
   </div>
  </section>
 </main>;
}
