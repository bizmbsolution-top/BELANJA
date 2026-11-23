"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { closeSalesExpensePeriod } from "./actions";
import styles from "./report.module.css";

export type ReportBA = { id:string; code:string; customer_id:string; customer_name:string; project_id:string; ba_number:string; ba_date:string; received_weight_kg:number; final_amount:number };
export type ReportItem = { id:string; sales_order_id:string; master_code_snapshot:string; master_name_snapshot:string; expense_type:string; final_amount:number; recipient_name_snapshot:string|null };
export type ReportExpense = { id:string; code:string; status:string; amount:number; paid_amount:number|null; paid_at:string|null; paid_method:string|null; sales_order_expense_item_id:string };
export type ReportProject = { id:string; code:string; name:string };
export type ReportClosing = { id:string; project_id:string; period_month:string; total_paid_amount:number; voucher_count:number; component_count:number; closed_by:string; closed_at:string };

const money=(value:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
const monthOf=(date:string)=>date.slice(0,7);
const monthLabel=(value:string)=>new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric",timeZone:"Asia/Jakarta"}).format(new Date(value+"-01T00:00:00"));
const dateLabel=(value:string)=>new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeZone:"Asia/Jakarta"}).format(new Date(value+"T00:00:00"));
const dateTime=(value:string)=>new Intl.DateTimeFormat("id-ID",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Jakarta"}).format(new Date(value));
const statusClass=(status:string)=>status==="Dibayar"?styles.paid:status==="Dibatalkan"?styles.cancelled:styles.outstanding;

export default function SalesExpenseReport({orders,items,expenses,projects,closings,canClose,viewerIsCashier}:{orders:ReportBA[];items:ReportItem[];expenses:ReportExpense[];projects:ReportProject[];closings:ReportClosing[];canClose:boolean;viewerIsCashier:boolean}){
 const router=useRouter();
 const months=useMemo(()=>Array.from(new Set(orders.map(order=>monthOf(order.ba_date)))).sort(),[orders]);
 const [fromMonth,setFromMonth]=useState(months[months.length-1]??"");
 const [toMonth,setToMonth]=useState(months[months.length-1]??"");
 const [projectFilter,setProjectFilter]=useState("all");
 const [busy,setBusy]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const expenseByItem=new Map(expenses.map(expense=>[expense.sales_order_expense_item_id,expense]));
 const itemsByOrder=new Map<string,ReportItem[]>();
 for(const item of items){const list=itemsByOrder.get(item.sales_order_id)??[];list.push(item);itemsByOrder.set(item.sales_order_id,list);}
 const projectById=new Map(projects.map(project=>[project.id,project]));
 const closingByKey=new Map(closings.map(closing=>[closing.project_id+"|"+closing.period_month.slice(0,7),closing]));
 const filteredOrders=orders.filter(order=>(!fromMonth||monthOf(order.ba_date)>=fromMonth)&&(!toMonth||monthOf(order.ba_date)<=toMonth)&&(projectFilter==="all"||order.project_id===projectFilter));
 const totals=filteredOrders.reduce((acc,order)=>{
  for(const item of itemsByOrder.get(order.id)??[]){if(item.expense_type!=="company_payable")continue;const expense=expenseByItem.get(item.id);if(!expense||expense.status==="Dibatalkan")continue;acc.total+=Number(item.final_amount);if(expense.status==="Dibayar")acc.paid+=Number(expense.paid_amount??expense.amount);else acc.outstanding+=Number(item.final_amount);}
  return acc;
 },{total:0,paid:0,outstanding:0});
 const monthGroups=new Map<string,{project:ReportProject;month:string;orders:ReportBA[];items:ReportItem[]}>();
 for(const order of filteredOrders){const month=monthOf(order.ba_date),key=order.project_id+"|"+month,group=monthGroups.get(key)??{project:projectById.get(order.project_id)!,month,orders:[],items:[]};group.orders.push(order);group.items.push(...(itemsByOrder.get(order.id)??[]).filter(item=>item.expense_type==="company_payable"));monthGroups.set(key,group);}
 async function close(projectId:string,month:string){if(!window.confirm("Konfirmasi closing biaya penjualan untuk "+(projectById.get(projectId)?.code??"Project")+" · "+monthLabel(month)+"? Closing hanya dapat dilakukan sekali."))return;setBusy(projectId+"|"+month);setError("");setMessage("");const result=await closeSalesExpensePeriod({projectId,periodMonth:month+"-01"});setBusy("");if(!result.ok){setError(result.error);return;}setMessage("Closing berhasil disimpan. Periode ini sekarang terkunci.");router.refresh();}
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>LAPORAN FINANCE · KASIR PROJECT</p><h1>Laporan Biaya Penjualan</h1><p>Rincian biaya per BA, penerima pembayaran, status voucher, dan closing bulanan per Project.</p></div></header>
  {message&&<p className={styles.success}>{message}</p>}{error&&<p className={styles.error}>{error}</p>}
  <section className={styles.filters}>
   <label>Bulan dari<select value={fromMonth} onChange={event=>setFromMonth(event.target.value)}><option value="">Semua</option>{months.map(month=><option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
   <label>Sampai bulan<select value={toMonth} onChange={event=>setToMonth(event.target.value)}><option value="">Semua</option>{months.map(month=><option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
   <label>Project<select value={projectFilter} onChange={event=>setProjectFilter(event.target.value)}><option value="all">Semua Project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
  </section>
  <section className={styles.metrics}>
   <article><span>Total biaya aktif</span><b>{money(totals.total)}</b></article>
   <article><span>Paid</span><b>{money(totals.paid)}</b></article>
   <article><span>Outstanding</span><b>{money(totals.outstanding)}</b></article>
  </section>
  <section className={styles.panel}><h2>Rincian per Berita Acara</h2><p className={styles.muted}>{filteredOrders.length} BA ditampilkan · diurutkan berdasarkan tanggal BA terbaru</p>
   {!filteredOrders.length?<div className={styles.empty}>Tidak ada BA pada periode ini.</div>:filteredOrders.map(order=>{const project=projectById.get(order.project_id);const baItems=(itemsByOrder.get(order.id)??[]).filter(item=>item.expense_type==="company_payable");const active=baItems.filter(item=>expenseByItem.get(item.id)?.status!=="Dibatalkan");const total=active.reduce((sum,item)=>sum+Number(item.final_amount),0);const paid=active.reduce((sum,item)=>{const expense=expenseByItem.get(item.id);return sum+(expense?.status==="Dibayar"?Number(expense.paid_amount??expense.amount):0);},0);const outstanding=Math.max(0,total-paid);
    return <article className={styles.ba} key={order.id}>
     <div className={styles.baHead}><div><span className={styles.code}>{order.code} · BA {order.ba_number||"—"} · {dateLabel(order.ba_date)}</span><h3>{order.customer_name}</h3><p>{project?project.code+" · "+project.name:"Project"} · {Number(order.received_weight_kg).toLocaleString("id-ID")} kg · Nilai BA {money(Number(order.final_amount))}</p></div><div className={styles.baTotal}><b>{money(total)}</b><small>Total biaya aktif</small></div></div>
     {!baItems.length?<p className={styles.muted}>Tidak ada komponen biaya perusahaan untuk BA ini.</p>:<div className={styles.tableWrap}><table><thead><tr><th>Komponen</th><th>Penerima</th><th>Voucher</th><th>Nominal</th><th>Status</th><th>Pembayaran</th></tr></thead><tbody>{baItems.map(item=>{const expense=expenseByItem.get(item.id);const status=expense?.status??"Belum ada voucher";return <tr key={item.id}><td><b>{item.master_name_snapshot}</b><small>{item.master_code_snapshot}</small></td><td>{item.recipient_name_snapshot||"Belum ditentukan"}</td><td>{expense?.code??"—"}</td><td>{money(Number(item.final_amount))}</td><td><span className={statusClass(status)}>{status==="Menunggu Pembayaran"?"Outstanding":status==="Dibayar"?"Paid":status}</span></td><td>{expense?.status==="Dibayar"?<>{expense.paid_method??"—"}<small>{expense.paid_at?dateTime(expense.paid_at):"Tanggal tidak tersedia"}</small></>: "—"}</td></tr>;})}</tbody></table></div>}
     <div className={styles.baSummary}><span>Total: <b>{money(total)}</b></span><span>Paid: <b>{money(paid)}</b></span><span>Outstanding: <b>{money(outstanding)}</b></span></div>
    </article>;
   })}
  </section>
  <section className={styles.panel}><h2>Closing Kasir per Project</h2><p className={styles.muted}>Closing dilakukan per Project dan bulan BA. Seluruh voucher biaya perusahaan pada periode tersebut harus Paid atau Dibatalkan; tidak boleh ada Outstanding atau voucher yang belum dibuat.</p>
   {[...monthGroups.values()].sort((a,b)=>b.month.localeCompare(a.month)||a.project.code.localeCompare(b.project.code)).map(group=>{const key=group.project.id+"|"+group.month;const closing=closingByKey.get(key);const activeItems=group.items.filter(item=>expenseByItem.get(item.id)?.status!=="Dibatalkan");const allSettled=group.items.length>0&&group.items.every(item=>{const status=expenseByItem.get(item.id)?.status;return status==="Dibayar"||status==="Dibatalkan";});const paidTotal=activeItems.reduce((sum,item)=>{const expense=expenseByItem.get(item.id);return sum+(expense?.status==="Dibayar"?Number(expense.paid_amount??expense.amount):0);},0);const outstanding=activeItems.reduce((sum,item)=>{const expense=expenseByItem.get(item.id);return sum+(!expense||expense.status!=="Dibayar"?Number(item.final_amount):0);},0);
    return <article className={styles.closing} key={key}><div><span className={styles.code}>{group.project.code} · {monthLabel(group.month)}</span><h3>{group.project.name}</h3><p>{group.orders.length} BA · {group.items.length} komponen biaya · Paid {money(paidTotal)} · Outstanding {money(outstanding)}</p>{closing?<span className={styles.closed}>CLOSED · {dateTime(closing.closed_at)} · {closing.voucher_count} voucher</span>:<span className={outstanding===0&&allSettled?styles.paid:styles.outstanding}>{allSettled?"Siap Closing":"Belum dapat Closing"}</span>}</div>{!closing&&canClose&&<button className={styles.closeButton} disabled={!allSettled||busy===key} onClick={()=>close(group.project.id,group.month)}>{busy===key?"Memproses...":"Closing Project"}</button>}{closing&&<b>{money(Number(closing.total_paid_amount))}</b>}</article>;
   })}
   {!monthGroups.size&&<div className={styles.empty}>Tidak ada data BA untuk dibuat closing.</div>}
  </section>
  {!viewerIsCashier&&<p className={styles.muted}>Mode Finance / Management: laporan dan riwayat closing dapat dilihat, tetapi closing hanya dilakukan oleh Kasir Project.</p>}
 </main>;
}
