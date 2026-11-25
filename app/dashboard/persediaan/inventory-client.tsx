"use client";
import { useMemo, useState } from "react";
import styles from "./inventory.module.css";
type Grade={key:string;gradeValue:number;gradeUnit:string;category:string;weight:number;readyWeight:number;quarantineWeight:number;unpaidWeight:number;inventoryValue:number;lotCount:number};
type Warehouse={id:string;code:string;name:string;location:string|null;projectLabel:string;totalKg:number;readyKg:number;quarantineKg:number;unpaidKg:number;inventoryValue:number;gradeCount:number;grades:Grade[]};
type Lot={id:string;code:string;inboundDate:string;category:string;supplier:string;initialWeight:number;availableWeight:number;gradeValue:number;gradeUnit:string;purchasePricePerKg:number;inventoryValue:number;isProblematic:boolean;problematicReason:string|null;problematicAt:string|null;paymentStatus:string;paidAt:string|null};
type Movement={id:string;lotId:string|null;type:string;date:string;category:string;weight:number;value:number;valueUnit:string;reason:string|null;reference:string;lotCode:string;gradeValue:number;gradeUnit:string;projectCode:string;projectName:string};
type Props={warehouses:Warehouse[];lots:Record<string,Lot[]>;movements:Record<string,Movement[]>;totalKg:number;readyKg:number;quarantineKg:number;inventoryValue:number;gradeCount:number;movementCount:number};
const qty=(n:number)=>Number(n).toLocaleString("id-ID",{maximumFractionDigits:3})+" kg";
const money=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const date=(s:string)=>new Date(s).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});
const day=(s:string)=>new Date(s+"T00:00:00").toLocaleDateString("id-ID",{dateStyle:"medium"});
export default function InventoryClient({warehouses,lots,movements,totalKg,readyKg,quarantineKg,inventoryValue,gradeCount,movementCount}:Props){
 const [selected,setSelected]=useState<string|null>(null),[selectedLot,setSelectedLot]=useState<string|null>(null),[type,setType]=useState("all"),[page,setPage]=useState(0);
 const active=warehouses.find(w=>w.id===selected)??null,activeLots=selected?lots[selected]??[]:[],activeMoves=selected?movements[selected]??[]:[];
 const rows=useMemo(()=>activeMoves.filter(m=>(type==="all"||m.type===type)&&(!selectedLot||m.lotId===selectedLot)),[activeMoves,type,selectedLot]);
 const pageSize=12,pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),pageRows=rows.slice(page*pageSize,(page+1)*pageSize);
 const open=(id:string)=>{setSelected(id);setSelectedLot(null);setType("all");setPage(0);};
 const stockCard=(id:string)=>{setSelectedLot(id);setType("all");setPage(0);};
 const close=()=>{setSelected(null);setSelectedLot(null);setPage(0);};
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>WAREHOUSE MANAGEMENT</p><h1>Persediaan</h1><p>Stok dipisahkan berdasarkan kategori dan kadar/value aktual setiap Lot.</p></div></header>
  <section className={styles.metrics}>
   <article><strong>{money(inventoryValue)}</strong><span>Estimasi nilai stok fisik</span></article>
   <article><strong>{qty(totalKg)}</strong><span>Total stok fisik di gudang</span></article>
   <article><strong>{qty(readyKg)}</strong><span>Stok siap dijual · Lunas & normal</span></article>
   <article><strong>{qty(quarantineKg)}</strong><span>Stok karantina · ditahan</span></article>
  </section>
  <section className={styles.section}>
   <div className={styles.sectionHeading}><div><h2>Persediaan per Gudang</h2><p>{gradeCount} kombinasi kategori dan kadar/value terdeteksi · {movementCount} catatan mutasi</p></div></div>
   {!warehouses.length?<div className={styles.empty}><h3>Belum ada stok</h3><p>Persediaan muncul setelah barang diterima di Pembelian.</p></div>:
    <div className={styles.stockList}>{warehouses.map(w=><button type="button" className={styles.warehouseCard} key={w.id} onClick={()=>open(w.id)}>
     <div className={styles.warehouseInfo}><span className={styles.code}>{w.code}</span><h3>{w.name}</h3><p>{w.projectLabel||"—"}</p><small>{w.gradeCount} kelompok kadar/value · {w.location||"Lokasi belum diatur"}</small>
      <div className={styles.gradeChips}>{w.grades.map(g=><span key={g.key}>{g.category} · {g.gradeValue} {g.gradeUnit} <b>{qty(g.weight)}</b></span>)}</div>
     </div><div className={styles.warehouseRight}><strong>{qty(w.totalKg)}</strong><span>Total fisik</span><span className={styles.readyText}>Siap jual: {qty(w.readyKg)}</span><span className={styles.quarantineText}>Karantina: {qty(w.quarantineKg)}</span><span className={styles.viewDetails}>Lihat Detail & Stock Card ›</span></div>
    </button>)}</div>}
  </section>
  <p className={styles.footnote}>Kadar/value tidak dirata-ratakan antar-Lot. Contoh kadar 69, 70, dan 72 akan memiliki saldo persediaan masing-masing.</p>
  {active&&<div className={styles.modalBackdrop} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
   <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">
    <header className={styles.modalHeader}><div><p className={styles.eyebrow}>INVENTORY DETAIL</p><h2 id="inventory-modal-title">{active.name}</h2><p>{active.code} · {active.projectLabel}</p></div><button type="button" className={styles.closeButton} onClick={close} aria-label="Tutup">×</button></header>
    <div className={styles.modalTotal}><div><span>Total stok fisik</span><span className={styles.averageValue}>Siap jual {qty(active.readyKg)} · Karantina {qty(active.quarantineKg)}</span></div><strong>{qty(active.totalKg)}</strong></div>
    <section className={styles.modalSection}><h3>Stok berdasarkan Kadar / Value</h3>
     {active.grades.map(g=><div className={styles.gradeRow} key={g.key}><div><strong>{g.category} · Kadar {g.gradeValue} {g.gradeUnit}</strong><span>{g.lotCount} Lot · Nilai persediaan {money(g.inventoryValue)}</span><span>Siap jual {qty(g.readyWeight)} · Karantina {qty(g.quarantineWeight)} · Belum lunas {qty(g.unpaidWeight)}</span></div><b>{qty(g.weight)}</b></div>)}
    </section>
    <section className={styles.modalSection}><h3>Daftar Lot</h3><p className={styles.footnote}>Setiap Lot menyimpan kadar aktual, status, saldo fisik, dan histori pergerakan sendiri.</p>
     {activeLots.length===0?<div className={styles.empty}><p>Tidak ada Lot aktif.</p></div>:activeLots.map(l=><article className={styles.lotCard} key={l.id}>
      <div className={styles.lotTop}><div><strong>{l.code}</strong><span>{l.category} · {l.supplier} · {day(l.inboundDate)}</span><b className={styles.gradeLabel}>Kadar {l.gradeValue} {l.gradeUnit}</b></div><strong>{qty(l.availableWeight)}</strong></div>
      <div className={styles.lotStatus}>{l.isProblematic?<span className={styles.quarantineBadge}>Karantina</span>:l.paymentStatus==="Lunas"?<span className={styles.readyBadge}>Siap dijual · {l.paymentStatus}</span>}<span>Nilai stok {money(l.inventoryValue)}</span></div>
      {l.isProblematic&&l.problematicReason&&<p className={styles.reasonText}>Keterangan karantina: {l.problematicReason}</p>}
      <button type="button" className={styles.stockCardButton} onClick={()=>stockCard(l.id)}>Buka Stock Card / Milestone →</button>
     </article>)}
    </section>
    {selectedLot&&(()=>{const lot=activeLots.find(l=>l.id===selectedLot);return lot?<section className={styles.modalSection}><h3>Milestone Lot · {lot.code}</h3><div className={styles.milestoneList}><div><b>01</b><span><strong>Barang diterima</strong><small>{day(lot.inboundDate)} · {qty(lot.initialWeight)}</small></span></div>{lot.paidAt&&<div><b>02</b><span><strong>Pembayaran lunas</strong><small>{date(lot.paidAt)}</small></span></div>}{lot.isProblematic&&<div><b>!</b><span><strong>Masuk karantina</strong><small>{lot.problematicAt?date(lot.problematicAt):"Status karantina aktif"} · {lot.problematicReason||"Alasan tidak tersedia"}</small></span></div>}</div></section>:null;})()}
    <section className={styles.modalSection}><div className={styles.historyHeading}><div><h3>{selectedLot?"Stock Card / Milestone":"Riwayat Mutasi Gudang"}</h3><span>{selectedLot?activeLots.find(l=>l.id===selectedLot)?.code:rows.length+" catatan"}</span></div><div className={styles.historyControls}>{selectedLot&&<button type="button" onClick={()=>{setSelectedLot(null);setPage(0);}}>Semua Lot</button>}<select value={type} onChange={e=>{setType(e.target.value);setPage(0);}} aria-label="Filter jenis pergerakan"><option value="all">Semua aktivitas</option><option value="receipt">Penerimaan</option><option value="sale_dispatch">Penjualan keluar</option><option value="purchase_return">Return supplier</option><option value="issue">Stok keluar</option><option value="transfer_in">Transfer masuk</option><option value="transfer_out">Transfer keluar</option></select></div></div>
     {!rows.length?<div className={styles.empty}><p>Belum ada catatan pergerakan untuk pilihan ini.</p></div>:<div className={styles.modalMovements}>{pageRows.map(m=><article className={styles.modalMovement} key={m.id}><div className={styles.movementTop}><span className={["issue","transfer_out","sale_dispatch","purchase_return"].includes(m.type)?styles.out:styles.in}>{({receipt:"Penerimaan",issue:"Stok keluar",sale_dispatch:"Penjualan keluar",purchase_return:"Return supplier",transfer_in:"Transfer masuk",transfer_out:"Transfer keluar"} as Record<string,string>)[m.type]??"Mutasi"}</span><time>{date(m.date)}</time></div><div className={styles.movementMain}><div><h4>{m.category} · Kadar {m.gradeValue} {m.gradeUnit}</h4><small>{m.reference||"Mutasi persediaan"}</small>{m.reason&&<small>Alasan: {m.reason}</small>}</div><strong className={["issue","transfer_out","sale_dispatch","purchase_return"].includes(m.type)?styles.negative:styles.positive}>{["issue","transfer_out","sale_dispatch","purchase_return"].includes(m.type)?"−":"+"}{qty(m.weight)}</strong></div></article>)}</div>}
     {rows.length>pageSize&&<div className={styles.pagination}><span>Halaman {page+1} dari {pageCount}</span><div><button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Sebelumnya</button><button type="button" disabled={page+1>=pageCount} onClick={()=>setPage(p=>p+1)}>Berikutnya</button></div></div>}
    </section>
   </section>
  </div>}
 </main>;
}
