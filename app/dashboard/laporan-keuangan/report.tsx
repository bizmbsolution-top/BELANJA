"use client";
import { useMemo, useState } from "react";
import styles from "./report.module.css";
export type FinancialOrder = { id:string; code:string; customer_id:string; customer_name:string; project_id:string; status:string; dispatched_weight_kg:number|null; received_weight_kg:number|null; final_amount:number|null; dispatched_purchase_cost:number|null; ba_number:string|null; ba_date:string };
export type FinancialProject = { id:string; code:string; name:string };
export type FinancialExpenseItem = { id:string; sales_order_id:string; master_code_snapshot:string; master_name_snapshot:string; expense_type:string; final_amount:number; recipient_name_snapshot:string|null };
export type FinancialVoucher = { id:string; code:string; status:string; amount:number; paid_amount:number|null; sales_order_expense_item_id:string };
export type FinancialSettlement = { id:string; sales_order_id:string; gross_amount:number|null; total_deductions:number|null; amount:number; payment_method:string; received_at:string };
export type FinancialDeduction = { settlement_id:string; component_code:string|null; component_name:string; deduction_amount:number };
const money=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const month=(d:string)=>d.slice(0,7);
const monthName=(m:string)=>new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric",timeZone:"Asia/Jakarta"}).format(new Date(m+"-01T00:00:00"));
export default function FinancialReport({orders,projects,expenseItems,vouchers,settlements,deductions}:{orders:FinancialOrder[];projects:FinancialProject[];allocations:{sales_order_id:string;allocated_weight_kg:number}[];expenseItems:FinancialExpenseItem[];vouchers:FinancialVoucher[];settlements:FinancialSettlement[];deductions:FinancialDeduction[]}){
 const months=useMemo(()=>Array.from(new Set(orders.map(o=>month(o.ba_date)))).sort(),[orders]);
 const [from,setFrom]=useState(months[0]??""); const [to,setTo]=useState(months[months.length-1]??""); const [project,setProject]=useState("all");
 const projectMap=new Map(projects.map(p=>[p.id,p])); const voucherMap=new Map(vouchers.map(v=>[v.sales_order_expense_item_id,v])); const settlementMap=new Map(settlements.map(s=>[s.sales_order_id,s]));
 const deductionMap=new Map<string,FinancialDeduction[]>(); deductions.forEach(d=>{const list=deductionMap.get(d.settlement_id)??[];list.push(d);deductionMap.set(d.settlement_id,list);});
 const rows=orders.filter(o=>(!from||month(o.ba_date)>=from)&&(!to||month(o.ba_date)<=to)&&(project==="all"||o.project_id===project)).map(o=>{
  const gross=Number(o.final_amount??0),cost=Number(o.dispatched_purchase_cost??0);
  const costs=expenseItems.filter(i=>i.sales_order_id===o.id&&i.expense_type==="company_payable");
  const active=costs.filter(i=>voucherMap.get(i.id)?.status!=="Dibatalkan");
  const salesExpense=active.reduce((s,i)=>s+Number(i.final_amount),0);
  const settlement=settlementMap.get(o.id); const detail=settlement?deductionMap.get(settlement.id)??[]:[];
  const scf=detail.filter(d=>(d.component_code??"").toUpperCase().includes("SCF")||d.component_name.toUpperCase().includes("SCF")).reduce((s,d)=>s+Number(d.deduction_amount),0);
  const pph=detail.filter(d=>(d.component_code??"").toUpperCase().includes("PPH")||d.component_name.toUpperCase().includes("PPH")).reduce((s,d)=>s+Number(d.deduction_amount),0);
  const other=detail.filter(d=>!((d.component_code??"").toUpperCase().includes("SCF")||d.component_name.toUpperCase().includes("SCF")||(d.component_code??"").toUpperCase().includes("PPH")||d.component_name.toUpperCase().includes("PPH"))).reduce((s,d)=>s+Number(d.deduction_amount),0);
  const paid=active.reduce((s,i)=>{const v=voucherMap.get(i.id);return s+(v?.status==="Dibayar"?Number(v.paid_amount??v.amount):0);},0);
  const outstanding=active.reduce((s,i)=>{const v=voucherMap.get(i.id);return s+(!v||v.status!=="Dibayar"?Number(i.final_amount):0);},0);
  return {order:o,gross,cost,grossProfit:gross-cost,salesExpense,scf,pph,other,ebitda:gross-cost-salesExpense-scf,settlement,netReceived:settlement?Number(settlement.amount):0,paid,outstanding};
 });
 const total=rows.reduce((a,r)=>({sales:a.sales+r.gross,cost:a.cost+r.cost,gp:a.gp+r.grossProfit,expense:a.expense+r.salesExpense,scf:a.scf+r.scf,pph:a.pph+r.pph,other:a.other+r.other,ebitda:a.ebitda+r.ebitda,net:a.net+r.netReceived}),{sales:0,cost:0,gp:0,expense:0,scf:0,pph:0,other:0,ebitda:0,net:0});
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>SENTRALOGIS · LAPORAN MANAJEMEN</p><h1>Laporan Keuangan</h1><p>Ringkasan hasil penjualan per Berita Acara, biaya, penerimaan, dan estimasi EBITDA.</p></div></header>
  <section className={styles.filters}>
   <label>Bulan dari<select value={from} onChange={e=>setFrom(e.target.value)}><option value="">Semua</option>{months.map(m=><option key={m} value={m}>{monthName(m)}</option>)}</select></label>
   <label>Sampai bulan<select value={to} onChange={e=>setTo(e.target.value)}><option value="">Semua</option>{months.map(m=><option key={m} value={m}>{monthName(m)}</option>)}</select></label>
   <label>Project<select value={project} onChange={e=>setProject(e.target.value)}><option value="all">Semua Project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
  </section>
  <section className={styles.metrics}>
   <article><span>Penjualan Bruto</span><b>{money(total.sales)}</b></article><article><span>Harga Pokok Lot</span><b>{money(total.cost)}</b></article><article><span>Gross Profit</span><b>{money(total.gp)}</b></article><article><span>Biaya Penjualan</span><b>{money(total.expense)}</b></article><article><span>SCF / Biaya Pembiayaan</span><b>{money(total.scf)}</b></article><article className={total.ebitda>=0?styles.positive:styles.negative}><span>Estimasi EBITDA*</span><b>{money(total.ebitda)}</b></article>
  </section>
  <section className={styles.secondary}><article><span>Penerimaan Bersih dari Pembeli</span><b>{money(total.net)}</b></article><article><span>PPh Dipotong Pembeli (terpisah)</span><b>{money(total.pph)}</b></article><article><span>Potongan Invoice Lainnya</span><b>{money(total.other)}</b></article></section>
  <section className={styles.note}><b>Dasar pembacaan laporan</b><p>Gross Profit = nilai BA final dikurangi biaya pembelian Lot. Estimasi EBITDA* = Gross Profit dikurangi biaya penjualan perusahaan dan SCF. PPh ditampilkan terpisah dan tidak mengurangi EBITDA. Angka EBITDA ini masih estimasi kontribusi sebelum biaya operasional umum, gaji, administrasi, pajak penghasilan, dan biaya lain yang belum dimasukkan ke laporan.</p><p>Biaya penjualan dihitung dari komponen perusahaan yang aktif, bukan hanya voucher yang sudah dibayar. Status pembayaran ditampilkan terpisah. Penerimaan bersih hanya berasal dari BA yang sudah dicatat settlement-nya.</p></section>
  <section className={styles.panel}><div className={styles.panelHead}><div><h2>Rincian Hasil per Berita Acara</h2><p>{rows.length} BA ditampilkan · periode mengikuti tanggal BA</p></div></div>
   {!rows.length?<div className={styles.empty}>Belum ada BA pada filter ini.</div>:<div className={styles.tableWrap}><table><thead><tr><th>BA / Pembeli</th><th>Project</th><th>Penjualan</th><th>Harga Pokok Lot</th><th>Gross Profit</th><th>Biaya Penjualan</th><th>SCF</th><th>Estimasi EBITDA</th><th>PPh</th><th>Penerimaan Bersih</th></tr></thead><tbody>{rows.map(r=><tr key={r.order.id}><td><b>{r.order.code}</b><small>BA {r.order.ba_number||"—"} · {r.order.ba_date}</small><small>{r.order.customer_name}</small></td><td>{projectMap.get(r.order.project_id)?.code??"—"}<small>{projectMap.get(r.order.project_id)?.name??""}</small></td><td>{money(r.gross)}</td><td>{money(r.cost)}</td><td className={r.grossProfit>=0?styles.good:styles.bad}>{money(r.grossProfit)}</td><td>{money(r.salesExpense)}<small>Paid {money(r.paid)}</small><small>Outstanding {money(r.outstanding)}</small></td><td>{money(r.scf)}</td><td className={r.ebitda>=0?styles.good:styles.bad}>{money(r.ebitda)}</td><td>{money(r.pph)}</td><td>{r.settlement?money(r.netReceived):"Belum diterima"}</td></tr>)}</tbody></table></div>}
  </section><p className={styles.foot}>*Estimasi EBITDA operasional terbatas berdasarkan data yang saat ini tersedia di Belanja. Alokasi Lot menggunakan biaya Lot yang tersimpan pada transaksi penjualan.</p>
 </main>;
}
