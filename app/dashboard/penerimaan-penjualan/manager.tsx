"use client";
import {useMemo,useState,type FormEvent,type CSSProperties} from "react";
import {useRouter} from "next/navigation";
import {recordSalesSettlement} from "./actions";
type Order={id:string;code:string;customer_id:string;project_id:string;final_amount:number;ba_number:string;ba_date:string;finalized_at:string;customer_name:string;project_label:string;settled:boolean};
type Component={id:string;customer_id:string|null;code:string;name:string;calculation_method:string;default_value:number;is_active:boolean;sort_order:number};
type Settlement={id:string;sales_order_id:string;amount:number;gross_amount:number;total_deductions:number;payment_method:string;payment_reference:string|null;received_at:string;customer_name:string;ba_number:string;evidence_file_name:string|null};
type Deduction={settlement_id:string;component_name:string;deduction_amount:number};
const money=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const date=(v:string)=>new Date(v+"T00:00:00").toLocaleDateString("id-ID");
export default function SettlementManager({orders,components,settlements,deductions}:{orders:Order[];components:Component[];settlements:Settlement[];deductions:Deduction[]}){
 const router=useRouter();const [selected,setSelected]=useState("");const [amounts,setAmounts]=useState<Record<string,string>>({});const [included,setIncluded]=useState<Record<string,boolean>>({});const [method,setMethod]=useState("Transfer");const [receivedAt,setReceivedAt]=useState(new Date().toISOString().slice(0,16));const [reference,setReference]=useState("");const [notes,setNotes]=useState("");const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");
 const order=orders.find(o=>o.id===selected);
 const applicable=useMemo(()=>order?components.filter(c=>c.customer_id===null||c.customer_id===order.customer_id).sort((a,b)=>a.sort_order-b.sort_order):[],[order,components]);
 function choose(id:string){setSelected(id);setError("");setMessage("");setAmounts({});setIncluded({});setFile(null);}
 function isIncluded(c:Component){return included[c.id]??true;}
 function amountFor(c:Component){if(amounts[c.id]!==undefined)return Number(amounts[c.id]||0);return c.calculation_method==="percent"?Math.round(Number(order?.final_amount??0)*Number(c.default_value)/100):Number(c.default_value);}
 const total=applicable.filter(isIncluded).reduce((s,c)=>s+amountFor(c),0);const gross=Number(order?.final_amount??0);const net=gross-total;
 async function submit(e:FormEvent){e.preventDefault();if(!order)return;setError("");setMessage("");if(!file){setError("Lampirkan invoice breakdown PT TIMAH / pembeli.");return;}if(total>gross){setError("Total potongan melebihi nilai invoice.");return;}
  setBusy(true);const r=await recordSalesSettlement({salesOrderId:order.id,paymentMethod:method,receivedAt,paymentReference:reference,notes,deductions:applicable.filter(isIncluded).map(c=>({componentId:c.id,amount:String(amountFor(c))}))},file);setBusy(false);
  if(!r.ok){setError(r.error);return;}setMessage("Settlement BA berhasil dicatat. Nilai net penerimaan tersimpan.");setSelected("");setFile(null);router.refresh();
 }
 return <main style={{maxWidth:1100,margin:"0 auto",padding:"26px 18px 56px",color:"var(--ink,#172b4d)"}}>
  <header style={{marginBottom:18}}><p style={{fontSize:11,fontWeight:800,color:"#155eef",letterSpacing:".12em"}}>FINANCE · PENERIMAAN PENJUALAN</p><h1 style={{fontSize:30,margin:"4px 0"}}>Penerimaan Pembayaran BA</h1><p style={{fontSize:13,color:"#64748b"}}>Catat penerimaan penuh dari pembeli berdasarkan invoice breakdown dan bukti transfer.</p></header>
  {message&&<p style={notice}>{message}</p>}{error&&<p style={{...notice,color:"#b42318",background:"#fff1f0"}}>{error}</p>}
  <section style={panel}><h2 style={h2}>BA Menunggu Settlement</h2>{orders.filter(o=>!o.settled).length===0?<p style={muted}>Semua BA yang tersedia sudah memiliki settlement.</p>:orders.filter(o=>!o.settled).map(o=><article key={o.id} style={row}><div><b>{o.code} · BA {o.ba_number}</b><div style={muted}>{o.customer_name} · {o.project_label} · {date(o.ba_date)}</div><b style={{display:"block",marginTop:5}}>{money(Number(o.final_amount))}</b></div><button style={primary} onClick={()=>choose(o.id)}>{selected===o.id?"Dipilih":"Catat Penerimaan"}</button></article>)}</section>
  {order&&<section style={panel}><h2 style={h2}>Perincian Invoice · {order.code} / BA {order.ba_number}</h2><p style={muted}>{order.customer_name} · Nilai invoice final dari BA</p>
   <form onSubmit={submit} style={{display:"grid",gap:13}}>
    <div style={summary}><span>Nilai Invoice / BA</span><b>{money(gross)}</b></div>
    <div><b style={{fontSize:13}}>Potongan sesuai Master</b><p style={muted}>Finance dapat menonaktifkan komponen yang tidak berlaku dan mengubah nominal mengikuti invoice aktual.</p>
     {applicable.length===0?<p style={muted}>Belum ada komponen potongan aktif untuk pembeli ini.</p>:applicable.map(c=><div key={c.id} style={deductionRow}>
      <label style={{display:"flex",alignItems:"center",gap:8,minWidth:170}}><input type="checkbox" checked={isIncluded(c)} onChange={e=>setIncluded(v=>({...v,[c.id]:e.target.checked}))}/><span><b>{c.name}</b><small style={muted}>{c.calculation_method==="percent"?"Default "+c.default_value+"%":"Default "+money(Number(c.default_value))}</small></span></label>
      <label style={{display:"grid",gap:4,fontSize:11,color:"#64748b",flex:1}}>Nominal Potongan (Rp)<input type="number" min="0" step="1" disabled={!isIncluded(c)} value={amountFor(c)} onChange={e=>setAmounts(v=>({...v,[c.id]:e.target.value}))} style={control}/></label></div>)}
    </div>
    <div style={summary}><span>Total Potongan</span><b>{money(total)}</b><span>Net Pembayaran Diterima</span><b style={{fontSize:21,color:"#12804a"}}>{money(net)}</b></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12}}>
     <label style={field}>Tanggal & Waktu Penerimaan<input style={control} type="datetime-local" required value={receivedAt} onChange={e=>setReceivedAt(e.target.value)}/></label>
     <label style={field}>Metode Penerimaan<select style={control} value={method} onChange={e=>setMethod(e.target.value)}><option>Transfer</option><option>Tunai</option></select></label>
     <label style={field}>Nomor Referensi Transfer<input style={control} maxLength={120} value={reference} onChange={e=>setReference(e.target.value)} placeholder="Nomor referensi / berita transfer"/></label>
     <label style={field}>Catatan<input style={control} maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
     <label style={{...field,gridColumn:"1/-1"}}>Invoice Breakdown / Rincian Potongan (PDF/JPG/PNG, maks. 10 MB)<input required type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
    </div>
    <p style={muted}>Sistem menyimpan nilai bruto, setiap potongan, dan net penerimaan sebagai snapshot. Satu BA hanya dapat diselesaikan satu kali; tidak ada settlement parsial.</p>
    <div style={{display:"flex",justifyContent:"end",gap:8}}><button type="button" style={secondary} onClick={()=>setSelected("")}>Batal</button><button style={primary} disabled={busy||net<0||!file}>{busy?"Menyimpan...":"Konfirmasi Penerimaan Penuh"}</button></div>
   </form>
  </section>}
  <section style={panel}><h2 style={h2}>Riwayat Settlement</h2>{!settlements.length?<p style={muted}>Belum ada penerimaan pembayaran yang dicatat.</p>:settlements.map(s=><article key={s.id} style={row}><div><b>BA {s.ba_number} · {s.customer_name}</b><div style={muted}>{new Date(s.received_at).toLocaleString("id-ID")} · {s.payment_method} · {s.payment_reference??"Tanpa referensi"}</div><div style={muted}>Invoice {money(Number(s.gross_amount))} · Potongan {money(Number(s.total_deductions))}</div><b style={{display:"block",marginTop:4}}>Net diterima {money(Number(s.amount))}</b><small style={muted}>{deductions.filter(d=>d.settlement_id===s.id).map(d=>d.component_name+": "+money(Number(d.deduction_amount))).join(" · ")}</small></div><span style={badge}>Diterima</span></article>)}</section>
 </main>;
}
const panel:CSSProperties={background:"var(--surface,#fff)",border:"1px solid var(--line,#e2e8f0)",borderRadius:14,padding:17,marginTop:16};
const h2:CSSProperties={fontSize:17,margin:"0 0 10px"};
const muted:CSSProperties={display:"block",fontSize:12,color:"#64748b",marginTop:4};
const row:CSSProperties={display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"13px 0",borderTop:"1px solid #e2e8f0",fontSize:13};
const primary:CSSProperties={background:"#155eef",color:"#fff",border:0,borderRadius:9,padding:"10px 14px",fontWeight:800,cursor:"pointer",whiteSpace:"nowrap" as const};
const secondary:CSSProperties={background:"transparent",color:"inherit",border:"1px solid #cbd5e1",borderRadius:8,padding:"9px 13px",fontWeight:700,cursor:"pointer"};
const control:CSSProperties={width:"100%",minHeight:40,border:"1px solid #cbd5e1",borderRadius:8,padding:"8px 10px",background:"var(--surface,#fff)",color:"inherit",font:"inherit"};
const field:CSSProperties={display:"grid",gap:6,fontSize:12,fontWeight:700};
const summary:CSSProperties={display:"grid",gridTemplateColumns:"1fr auto",gap:7,alignItems:"center",padding:13,borderRadius:10,background:"var(--surface-secondary,#f1f5f9)",fontSize:13};
const deductionRow:CSSProperties={display:"flex",gap:14,alignItems:"center",padding:"10px 0",borderBottom:"1px solid #e2e8f0",flexWrap:"wrap" as const};
const badge:CSSProperties={padding:"5px 9px",borderRadius:20,background:"#e8f7ee",color:"#18794e",fontSize:11,fontWeight:800};
const notice:CSSProperties={padding:10,borderRadius:8,background:"#eef6ff",color:"#155eef",fontSize:12};