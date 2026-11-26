"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import QuarantineEvidenceForm from "./quarantine-evidence-form";
import styles from "./inventory.module.css";
type Grade={key:string;gradeValue:number;gradeUnit:string;category:string;weight:number;readyWeight:number;quarantineWeight:number;unpaidWeight:number;inventoryValue:number;lotCount:number};
type Warehouse={id:string;code:string;name:string;location:string|null;projectLabel:string;totalKg:number;readyKg:number;quarantineKg:number;unpaidKg:number;inventoryValue:number;gradeCount:number;grades:Grade[]};
type Lot={id:string;code:string;inboundDate:string;category:string;supplier:string;initialWeight:number;availableWeight:number;normalWeight:number;quarantineWeight:number;gradeValue:number;gradeUnit:string;purchasePricePerKg:number;inventoryValue:number;isProblematic:boolean;problematicReason:string|null;problematicAt:string|null;paymentStatus:string;paidAt:string|null};
type Movement={id:string;lotId:string|null;type:string;date:string;category:string;weight:number;value:number;valueUnit:string;reason:string|null;reference:string;lotCode:string;gradeValue:number;gradeUnit:string;projectCode:string;projectName:string};
type QuarantineDocument={id:string;lotId:string;fileName:string;signedUrl:string;createdAt:string};
type Props={quarantineDocuments:QuarantineDocument[];warehouses:Warehouse[];lots:Record<string,Lot[]>;movements:Record<string,Movement[]>;totalKg:number;readyKg:number;quarantineKg:number;inventoryValue:number;gradeCount:number;movementCount:number;canManageQuarantine:boolean};
const qty=(n:number)=>Number(n).toLocaleString("id-ID",{maximumFractionDigits:3})+" kg";
const money=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const date=(s:string)=>new Date(s).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});
const day=(s:string)=>new Date(s+"T00:00:00").toLocaleDateString("id-ID",{dateStyle:"medium"});
const movementLabel:Record<string,string>={receipt:"Penerimaan",issue:"Stok keluar",sale_dispatch:"Penjualan keluar",purchase_return:"Return supplier",transfer_in:"Transfer masuk",transfer_out:"Transfer keluar"};
const outgoing=(type:string)=>["issue","transfer_out","sale_dispatch","purchase_return"].includes(type);
export default function InventoryClient({quarantineDocuments,warehouses,lots,movements,totalKg,readyKg,quarantineKg,inventoryValue,gradeCount,movementCount,canManageQuarantine}:Props){
 const [selected,setSelected]=useState<string|null>(null);
 const [selectedGrade,setSelectedGrade]=useState<string|null>(null);
 const [selectedLot,setSelectedLot]=useState<string|null>(null);
 const [type,setType]=useState("all");
 const [page,setPage]=useState(0);
 const [categoryFilter,setCategoryFilter]=useState("all");
 const [gradeFilter,setGradeFilter]=useState("all");
 const active=warehouses.find(w=>w.id===selected)??null;
 const activeLots=selected?lots[selected]??[]:[];
 const activeMoves=selected?movements[selected]??[]:[];
 const grade=active?.grades.find(g=>g.key===selectedGrade)??null;
 const categoryOptions=[...new Set((active?.grades??[]).map(g=>g.category))].sort((a,b)=>a.localeCompare(b));
 const gradeOptions=[...new Set((active?.grades??[]).filter(g=>categoryFilter==="all"||g.category===categoryFilter).map(g=>g.gradeValue+"|"+g.gradeUnit))].map(value=>({value,label:value.replace("|"," ")})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
 const filteredGrades=(active?.grades??[]).filter(g=>(categoryFilter==="all"||g.category===categoryFilter)&&(gradeFilter==="all"||(g.gradeValue+"|"+g.gradeUnit)===gradeFilter));
 const lot=activeLots.find(l=>l.id===selectedLot)??null;
 const gradeLots=grade?activeLots.filter(l=>l.category===grade.category&&l.gradeValue===grade.gradeValue&&l.gradeUnit===grade.gradeUnit):[];
 const lotEvidence=quarantineDocuments.filter(doc=>doc.lotId===selectedLot);
 const rows=useMemo(()=>activeMoves.filter(m=>(type==="all"||m.type===type)&&(!selectedLot||m.lotId===selectedLot)),[activeMoves,type,selectedLot]);
 const pageSize=12,pageCount=Math.max(1,Math.ceil(rows.length/pageSize)),pageRows=rows.slice(page*pageSize,(page+1)*pageSize);
 const open=(id:string)=>{setSelected(id);setSelectedGrade(null);setSelectedLot(null);setCategoryFilter("all");setGradeFilter("all");setType("all");setPage(0);};
 const backWarehouse=()=>{setSelected(null);setSelectedGrade(null);setSelectedLot(null);setCategoryFilter("all");setGradeFilter("all");setPage(0);};
 const backGrade=()=>{setSelectedGrade(null);setSelectedLot(null);setType("all");setPage(0);};
 const openGrade=(key:string)=>{setSelectedGrade(key);setSelectedLot(null);setType("all");setPage(0);};
 const openLot=(id:string)=>{setSelectedLot(id);setType("all");setPage(0);};
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>WAREHOUSE MANAGEMENT</p><h1>Persediaan</h1><p>Kontrol stok fisik, kategori, kadar/value, dan status kelayakan penjualan.</p></div></header>
  <section className={styles.metrics}>
   <article><strong>{money(inventoryValue)}</strong><span>Estimasi nilai stok fisik</span></article>
   <article><strong>{qty(totalKg)}</strong><span>Total stok fisik</span></article>
   <article><strong>{qty(readyKg)}</strong><span>Stok siap dijual</span></article>
   <article><strong>{qty(quarantineKg)}</strong><span>Stok karantina</span></article>
  </section>
  {!active?<section className={styles.section}>
   <div className={styles.sectionHeading}><div><h2>Persediaan per Gudang</h2><p>{warehouses.length} gudang · {gradeCount} kombinasi kategori dan kadar · {movementCount} catatan mutasi</p></div></div>
   {!warehouses.length?<div className={styles.empty}><h3>Belum ada stok</h3><p>Persediaan muncul setelah barang diterima di Pembelian.</p></div>:
    <div className={styles.stockList}>{warehouses.map(w=><button type="button" className={styles.warehouseCard} key={w.id} onClick={()=>open(w.id)}>
     <div className={styles.warehouseInfo}><span className={styles.code}>{w.code}</span><h3>{w.name}</h3><p>{w.projectLabel||"—"}</p><small>{w.gradeCount} kelompok kategori & kadar · {w.location||"Lokasi belum diatur"}</small></div>
     <div className={styles.warehouseRight}><strong>{qty(w.totalKg)}</strong><span>Total stok fisik</span><span className={styles.readyText}>Siap dijual: {qty(w.readyKg)}</span><span className={styles.quarantineText}>Karantina: {qty(w.quarantineKg)}</span><span className={styles.viewDetails}>Buka Inventory Detail →</span></div>
    </button>)}</div>}
  </section>:<div className={styles.inventoryWorkspace}>
   <button type="button" className={styles.backLink} onClick={selectedLot?()=>{setSelectedLot(null);setPage(0);}:selectedGrade?backGrade:backWarehouse}>← {selectedLot?"Kembali ke daftar Lot":selectedGrade?"Kembali ke kategori & kadar":"Kembali ke daftar gudang"}</button>
   <section className={styles.inventoryHero}>
    <div><p className={styles.eyebrow}>INVENTORY DETAIL · {active.code}</p><h2>{active.name}</h2><p>{active.projectLabel||"Tanpa project"} · {active.location||"Lokasi belum diatur"}</p></div>
    <div className={styles.heroTotal}><strong>{qty(active.totalKg)}</strong><span>Total stok fisik</span></div>
   </section>
   <section className={styles.metrics+" "+styles.detailMetrics}>
    <article><strong>{qty(active.readyKg)}</strong><span>Siap dijual</span></article>
    <article><strong>{qty(active.quarantineKg)}</strong><span>Karantina</span></article>
    <article><strong>{qty(active.unpaidKg)}</strong><span>Belum lunas</span></article>
    <article><strong>{money(active.inventoryValue)}</strong><span>Nilai persediaan</span></article>
   </section>
   {!selectedGrade?<section className={styles.section}>
    <div className={styles.sectionHeading}><div><h2>Kategori & Kadar / Value</h2><p>Filter kelompok persediaan, lalu buka daftar Lot yang membentuk saldo tersebut.</p></div><span className={styles.countPill}>{filteredGrades.length} dari {active.grades.length} kelompok</span></div>
    <div className={styles.inventoryFilters}>
     <label><span>Filter kategori</span><select value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setGradeFilter("all");}}><option value="all">Semua kategori</option>{categoryOptions.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
     <label><span>Filter kadar / value</span><select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}><option value="all">Semua kadar</option>{gradeOptions.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label>
     <button type="button" onClick={()=>{setCategoryFilter("all");setGradeFilter("all");}}>Reset filter</button>
    </div>
    {!active.grades.length?<div className={styles.empty}><p>Tidak ada saldo stok untuk gudang ini.</p></div>:!filteredGrades.length?<div className={styles.empty}><p>Tidak ada kelompok yang sesuai dengan filter.</p></div>:<div className={styles.categoryTableWrap}>
     <div className={styles.categoryTableHead}><span>Kategori & kadar</span><span>Jumlah Lot</span><span>Total saldo</span><span>Siap dijual</span><span>Karantina</span><span>Nilai stok</span><span></span></div>
     {filteredGrades.map(g=><div className={styles.categoryTableRow} key={g.key}>
      <div className={styles.categoryIdentity}><strong>{g.category}</strong><span>Kadar {g.gradeValue} {g.gradeUnit}</span></div>
      <span data-label="Jumlah Lot">{g.lotCount} Lot</span><strong data-label="Total saldo">{qty(g.weight)}</strong>
      <span className={styles.readyText} data-label="Siap dijual">{qty(g.readyWeight)}</span><span className={styles.quarantineText} data-label="Karantina">{qty(g.quarantineWeight)}</span>
      <span data-label="Nilai stok">{money(g.inventoryValue)}</span><button type="button" onClick={()=>openGrade(g.key)}>View Lot Details →</button>
     </div>)}
    </div>}
   </section>:!selectedLot?<section className={styles.section}>
    <div className={styles.sectionHeading}><div><span className={styles.categoryTag}>{grade?.category}</span><h2>Kadar {grade?.gradeValue} {grade?.gradeUnit}</h2><p>{gradeLots.length} Lot · Total saldo {qty(grade?.weight??0)}</p></div><span className={styles.countPill}>Daftar Lot</span></div>
    {gradeLots.length===0?<div className={styles.empty}><p>Tidak ada Lot pada kelompok ini.</p></div>:<div className={styles.lotList}>{gradeLots.map(l=><article className={styles.lotCard} key={l.id}>
     <div className={styles.lotTop}><div><strong>{l.code}</strong><span>{l.supplier} · Diterima {day(l.inboundDate)}</span></div><strong>{qty(l.availableWeight)}</strong></div>
     <div className={styles.lotStatus}><span><strong>Harga beli/kg:</strong> {money(l.purchasePricePerKg)}</span><span><strong>Nilai persediaan:</strong> {money(l.inventoryValue)}</span>{l.normalWeight>0?<span className={styles.readyBadge}>Siap dijual {qty(l.normalWeight)}</span>:null}{l.quarantineWeight>0?<span className={styles.quarantineBadge}>Karantina {qty(l.quarantineWeight)}</span>:null}<span className={styles.unpaidBadge}>{l.paymentStatus}</span></div>
     {l.isProblematic&&l.problematicReason&&<p className={styles.reasonText}>Alasan karantina: {l.problematicReason}</p>}
     <button type="button" className={styles.stockCardButton} onClick={()=>openLot(l.id)}>View Detail Lot & Stock Card →</button>
    </article>)}</div>}
   </section>:<section className={styles.section}>
    <div className={styles.sectionHeading}><div><span className={styles.categoryTag}>{lot?.category} · Kadar {lot?.gradeValue} {lot?.gradeUnit}</span><h2>Detail Lot · {lot?.code}</h2><p>{lot?.supplier} · Diterima {lot?day(lot.inboundDate):""}</p></div></div>
    {lot&&<><div className={styles.lotOverview}>
     <div><span>Saldo fisik tersisa</span><strong>{qty(lot.availableWeight)}</strong></div><div><span>Berat awal diterima</span><strong>{qty(lot.initialWeight)}</strong></div><div><span>Harga beli per kg</span><strong>{money(lot.purchasePricePerKg)}</strong></div><div><span>Nilai persediaan Lot</span><strong>{money(lot.inventoryValue)}</strong></div><div><span>Stok normal / siap dijual</span><strong>{qty(lot.normalWeight)}</strong></div><div><span>Stok karantina</span><strong>{qty(lot.quarantineWeight)}</strong></div><div><span>Status pembayaran</span><strong>{lot.paymentStatus}</strong></div>
    </div>
    {lot.isProblematic&&<p className={styles.reasonText}>Alasan karantina: {lot.problematicReason||"Status penolakan/karantina aktif."}</p>}
    {!!lotEvidence.length&&<div className={styles.evidenceBlock}><div className={styles.evidenceHeading}><span aria-hidden="true">📷</span><div><strong>Bukti Foto Karantina</strong><small>{lotEvidence.length} foto · Dokumentasi saat barang dimasukkan ke karantina</small></div></div><div className={styles.evidenceGrid}>{lotEvidence.map(doc=><a key={doc.id} href={doc.signedUrl} target="_blank" rel="noreferrer" className={styles.evidenceItem}><img src={doc.signedUrl} alt={doc.fileName}/><span>{doc.fileName}</span></a>)}</div></div>}
    <div style={{display:"flex",gap:10,flexWrap:"wrap",margin:"12px 0"}}>
     {canManageQuarantine&&lot.normalWeight>0.0001&&<QuarantineEvidenceForm lotId={lot.id} maxWeight={lot.normalWeight}/> }
     {canManageQuarantine&&<Link href="/dashboard/retur-pembelian" className={styles.stockCardButton}>Buka Return Pembelian →</Link>}
    </div>
    <div className={styles.milestoneList}><div><b>01</b><span><strong>Barang diterima</strong><small>{day(lot.inboundDate)} · {qty(lot.initialWeight)}</small></span></div>{lot.paidAt&&<div><b>02</b><span><strong>Pembayaran lunas</strong><small>{date(lot.paidAt)}</small></span></div>}{lot.isProblematic&&<div><b>!</b><span><strong>Masuk karantina</strong><small>{lot.problematicAt?date(lot.problematicAt):"Status karantina aktif"} · {lot.problematicReason||"Alasan tidak tersedia"}</small></span></div>}</div>
    <div className={styles.historyHeading}><div><h3>Stock Card / Riwayat Mutasi Lot</h3><span>{rows.length} catatan pergerakan</span></div><select value={type} onChange={e=>{setType(e.target.value);setPage(0);}} aria-label="Filter jenis pergerakan"><option value="all">Semua aktivitas</option><option value="receipt">Penerimaan</option><option value="sale_dispatch">Penjualan keluar</option><option value="purchase_return">Return supplier</option><option value="issue">Stok keluar</option><option value="transfer_in">Transfer masuk</option><option value="transfer_out">Transfer keluar</option></select></div>
    {!rows.length?<div className={styles.empty}><p>Belum ada riwayat mutasi Lot ini.</p></div>:<div className={styles.modalMovements}>{pageRows.map(m=><article className={styles.modalMovement} key={m.id}><div className={styles.movementTop}><span className={outgoing(m.type)?styles.out:styles.in}>{movementLabel[m.type]??"Mutasi"}</span><time>{date(m.date)}</time></div><div className={styles.movementMain}><div><h4>{m.reference||"Mutasi persediaan"}</h4>{m.reason&&<small>Alasan: {m.reason}</small>}</div><strong className={outgoing(m.type)?styles.negative:styles.positive}>{outgoing(m.type)?"−":"+"}{qty(m.weight)}</strong></div></article>)}</div>}
    {rows.length>pageSize&&<div className={styles.pagination}><span>Halaman {page+1} dari {pageCount}</span><div><button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Sebelumnya</button><button type="button" disabled={page+1>=pageCount} onClick={()=>setPage(p=>p+1)}>Berikutnya</button></div></div>}
    </>}
   </section>}
  </div>}
  <p className={styles.footnote}>Saldo dihitung per Lot berdasarkan seluruh mutasi. Barang yang sudah diterima lalu dinyatakan bermasalah dipisahkan ke Karantina dan tidak dapat dipilih pada Penjualan. Barang yang ditolak saat pemeriksaan penerimaan tidak menjadi stok Lot. Status pembayaran ditampilkan terpisah dari kelayakan penjualan.</p>
 </main>;
}
