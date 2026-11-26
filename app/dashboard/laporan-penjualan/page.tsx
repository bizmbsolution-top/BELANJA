import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./report.module.css";
export const dynamic="force-dynamic";
export const revalidate=0;
const money=(value:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
const qty=(value:number)=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:3}).format(value);
export default async function SalesReportPage(){
 const context=await requireAnyRole(["Finance","Management"]);const admin=createAdminClient();
 const [{data:orders,error},{data:customers},{data:projects},{data:allocations},{data:baExpenses,error:expenseError},{data:settlements,error:settlementError}]=await Promise.all([
  admin.from("sales_orders").select("id,code,customer_id,project_id,status,created_at,dispatched_at,dispatched_weight_kg,received_weight_kg,final_grade_value,final_grade_unit,final_price_per_kg,final_amount,ba_number,ba_date,discrepancy_notes,dispatched_purchase_cost").eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(300),
  admin.from("customers").select("id,name").eq("tenant_id",context.tenantId),admin.from("projects").select("id,code,name").eq("tenant_id",context.tenantId),
  admin.from("sales_order_lot_allocations").select("sales_order_id,allocated_weight_kg").eq("tenant_id",context.tenantId),
  admin.from("sales_order_expense_items").select("sales_order_id,final_amount,status,master_name_snapshot").eq("tenant_id",context.tenantId).eq("status","Ditetapkan"),
  admin.from("sales_order_settlements").select("sales_order_id,amount,gross_amount,total_deductions").eq("tenant_id",context.tenantId)
 ]);
 if(error||expenseError||settlementError)throw new Error("Rekap penjualan atau biaya BA gagal dimuat.");
 const rows=orders??[];const completed=rows.filter(o=>o.status==="Selesai");const dispatched=rows.filter(o=>o.status==="Dikirim"||o.status==="Selesai");
 const totalDispatched=dispatched.reduce((s,o)=>s+Number(o.dispatched_weight_kg??0),0);const totalReceived=completed.reduce((s,o)=>s+Number(o.received_weight_kg??0),0);
 const totalSales=completed.reduce((s,o)=>s+Number(o.final_amount??0),0);const totalCost=completed.reduce((s,o)=>s+Number(o.dispatched_purchase_cost??0),0);
 const expenseByOrder=new Map<string,number>();for(const x of baExpenses??[])expenseByOrder.set(x.sales_order_id,(expenseByOrder.get(x.sales_order_id)??0)+Number(x.final_amount??0));
 const settlementByOrder=new Map((settlements??[]).map(x=>[x.sales_order_id,x]));
 const netRevenueByOrder=(o:{id:string;final_amount:number|null})=>Number(settlementByOrder.get(o.id)?.amount??o.final_amount??0);
 const totalNetRevenue=completed.reduce((s,o)=>s+netRevenueByOrder(o),0);
 const totalInvoiceDeductions=completed.reduce((s,o)=>s+Number(settlementByOrder.get(o.id)?.total_deductions??0),0);
 const totalBAExpenses=completed.reduce((s,o)=>s+(expenseByOrder.get(o.id)??0),0);const totalProfit=totalNetRevenue-totalCost-totalBAExpenses;
 const customerMap=new Map((customers??[]).map(x=>[x.id,x.name]));const projectMap=new Map((projects??[]).map(x=>[x.id,x]));
 const lotCount=(id:string)=>(allocations??[]).filter(a=>a.sales_order_id===id).length;
 const date=(value:string|null)=>value?new Date(value+(value.length===10?"T00:00:00":"")).toLocaleDateString("id-ID"):"—";
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>LAPORAN MANAJEMEN</p><h1>Rekap Penjualan</h1><p>Ringkasan penjualan final, penerimaan bersih BA, biaya pembelian Lot, dan biaya lainnya.</p></div><span className={styles.period}>300 transaksi terbaru · Semua Project</span></header>
  <section className={styles.metrics}>
   <article><span>Total Penjualan</span><b>{rows.length}</b><small>{completed.length} selesai · {rows.filter(o=>o.status==="Dikirim").length} dikirim · {rows.filter(o=>o.status==="Draft").length} draft</small></article>
   <article><span>Berat Dikirim</span><b>{qty(totalDispatched)} kg</b><small>Transaksi Dikirim dan Selesai</small></article>
   <article><span>Berat Diterima Pembeli</span><b>{qty(totalReceived)} kg</b><small>Hanya transaksi Selesai</small></article>
   <article><span>Nilai Invoice BA</span><b>{money(totalSales)}</b><small>Nilai penjualan final bruto</small></article>
   <article><span>Potongan Invoice BA</span><b>{money(totalInvoiceDeductions)}</b><small>PPH, SCF, dan potongan pelanggan</small></article>
   <article><span>Net Penerimaan BA</span><b>{money(totalNetRevenue)}</b><small>Settlement tercatat; BA belum settle memakai nilai bruto sementara</small></article>
   <article><span>Nilai Pembelian Lot</span><b>{money(totalCost)}</b><small>Biaya aktual Lot transaksi selesai</small></article>
   <article><span>Biaya Lainnya BA</span><b>{money(totalBAExpenses)}</b><small>Fee mitra, keamanan, dan lainnya</small></article>
   <article className={totalProfit>=0?styles.profit:styles.loss}><span>Margin Akhir</span><b>{money(totalProfit)}</b><small>Net penerimaan dikurangi biaya Lot dan biaya BA</small></article>
  </section>
  <section className={styles.note}><b>Catatan perhitungan</b><p>Margin akhir menggunakan net penerimaan dari settlement (setelah PPH, SCF, dan potongan invoice), dikurangi biaya pembelian aktual Lot dan seluruh Biaya Lainnya BA berstatus Ditetapkan. Untuk BA yang belum memiliki settlement, nilai invoice bruto dipakai sementara sehingga margin masih estimasi.</p></section>
  <section className={styles.tableCard}><div className={styles.tableHeading}><div><h2>Rincian Transaksi</h2><p>{rows.length} transaksi ditampilkan</p></div></div>
   {!rows.length?<div className={styles.empty}>Belum ada transaksi penjualan.</div>:<div className={styles.tableScroll}><table>
    <thead><tr><th>Transaksi / Pembeli</th><th>Project</th><th>Status</th><th>Lot</th><th>Dikirim</th><th>Diterima</th><th>Selisih</th><th>BA Pembeli</th><th>Invoice BA</th><th>Potongan BA</th><th>Net BA</th><th>Biaya Lot</th><th>Biaya BA</th><th>Margin Akhir</th></tr></thead>
    <tbody>{rows.map(o=>{const done=o.status==="Selesai";const sent=Number(o.dispatched_weight_kg??0);const received=done?Number(o.received_weight_kg??0):0;const difference=done?sent-received:null;const sale=done?Number(o.final_amount??0):0;const settlement=settlementByOrder.get(o.id);const deductions=done?Number(settlement?.total_deductions??0):0;const net=done?netRevenueByOrder(o):0;const cost=done?Number(o.dispatched_purchase_cost??0):0;const baCost=done?(expenseByOrder.get(o.id)??0):0;const margin=net-cost-baCost;const project=projectMap.get(o.project_id);return <tr key={o.id}>
     <td><b>{o.code}</b><small>{customerMap.get(o.customer_id)??"Pelanggan"} · {date(o.created_at)}</small></td><td>{project?project.code+" · "+project.name:"—"}</td><td><span className={styles.status}>{o.status}</span></td><td>{lotCount(o.id)}</td><td>{sent?qty(sent)+" kg":"—"}</td><td>{done?qty(received)+" kg":"—"}</td><td>{difference===null?"—":qty(difference)+" kg"}</td><td>{done?<><b>{o.ba_number}</b><small>{date(o.ba_date)}</small><small>Kadar {qty(Number(o.final_grade_value??0))} {o.final_grade_unit}</small></>:"—"}</td><td>{done?money(sale):"—"}</td><td>{done?money(deductions):"—"}</td><td>{done?money(net):"—"}</td><td>{done?money(cost):"—"}</td><td>{done?money(baCost):"—"}</td><td className={done?(margin>=0?styles.positive:styles.negative):""}>{done?money(margin):"—"}</td>
    </tr>})}</tbody></table></div>}
  </section>
 </main>;
}
