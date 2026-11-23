"use client";
import { useMemo,useState,type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSalesDraft } from "./actions";
import styles from "./sales.module.css";
type Lookup={id:string;code:string;name:string};
type Lot={id:string;code:string;project_id:string;warehouse_id:string;category_id:string;supplier_id:string;initial_weight_kg:number;grade_value:number;grade_unit:string;purchase_price_per_kg:number;total_purchase_cost:number;inbound_date:string;available_weight_kg:number;category_name:string;supplier_name:string};
type Order={id:string;code:string;customer_id:string;project_id:string;destination:string;sale_price_per_kg:number;notes:string|null;status:string;created_at:string};
type Allocation={id:string;sales_order_id:string;lot_id:string;source_warehouse_id:string;category_id:string;allocated_weight_kg:number;grade_value:number;grade_unit:string;purchase_cost_per_kg:number;allocated_purchase_cost:number};
export type SalesPageData={actorRoles:string[];projects:Lookup[];warehouses:Lookup[];warehouseProjects:{project_id:string;warehouse_id:string}[];customers:Lookup[];lots:Lot[];orders:Order[];allocations:Allocation[];categories:Lookup[];suppliers:Lookup[]};
const money=(n:number)=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n);
const qty=(n:number)=>Number(n).toLocaleString("id-ID",{maximumFractionDigits:3});
export default function SalesManager({data}:{data:SalesPageData}){
 const router=useRouter();const canCreate=data.actorRoles.includes("Sales")||data.actorRoles.includes("Superadmin");
 const [open,setOpen]=useState(false),[projectId,setProjectId]=useState(""),[warehouseIds,setWarehouseIds]=useState<string[]>([]),[weights,setWeights]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const warehousesForProject=useMemo(()=>data.warehouses.filter(w=>data.warehouseProjects.some(m=>m.project_id===projectId&&m.warehouse_id===w.id)),[data.warehouses,data.warehouseProjects,projectId]);
 const selectableLots=data.lots.filter(l=>l.project_id===projectId&&warehouseIds.includes(l.warehouse_id));
 const selected=Object.entries(weights).filter(([id,v])=>selectableLots.some(l=>l.id===id)&&Number(v)>0);
 const selectedWeight=selected.reduce((s,[,v])=>s+Number(v),0);
 const estimatedCost=selected.reduce((s,[id,v])=>{const l=data.lots.find(x=>x.id===id);return s+(l?Number(l.total_purchase_cost)/Number(l.initial_weight_kg)*Number(v):0)},0);
 function reset(){setOpen(false);setProjectId("");setWarehouseIds([]);setWeights({});setError("");}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError("");setMessage("");const f=new FormData(e.currentTarget);
  const r=await createSalesDraft({customerId:String(f.get("customerId")??""),projectId,destination:String(f.get("destination")??""),salePricePerKg:String(f.get("salePricePerKg")??""),notes:String(f.get("notes")??""),allocations:selected.map(([lotId,weightKg])=>({lotId,weightKg}))});
  setBusy(false);if(!r.ok){setError(r.error);return;}setMessage("Draft Penjualan berhasil dibuat.");reset();router.refresh();
 }
 function toggleWarehouse(id:string,checked:boolean){setWarehouseIds(old=>checked?[...old,id]:old.filter(x=>x!==id));}
 return <main className={styles.page}>
  <header className={styles.header}><div><p className={styles.eyebrow}>OPERASIONAL</p><h1>Penjualan</h1><p>Penjualan berdasarkan Lot dan berat aktual barang yang akan dikirim.</p></div>{canCreate&&<button className={styles.primary} onClick={()=>{setOpen(true);setError("");}}>+ Buat Penjualan</button>}</header>
  <section className={styles.metrics}><article><b>{data.orders.length}</b><span>Total Penjualan</span></article><article><b>{data.orders.filter(o=>o.status==="Draft").length}</b><span>Draft</span></article><article><b>{data.orders.filter(o=>o.status==="Dikirim").length}</b><span>Dalam Proses Penerimaan</span></article><article><b>{data.orders.filter(o=>o.status==="Selesai").length}</b><span>Selesai</span></article></section>
  {message&&<p className={styles.success}>{message}</p>}{error&&<p className={styles.error}>{error}</p>}
  {open&&<section className={styles.formCard}><div className={styles.formTitle}><div><h2>Draft Penjualan Baru</h2><p>Pilih beberapa Lot, termasuk dari beberapa gudang dalam Project yang sama.</p></div><button type="button" className={styles.close} onClick={reset}>×</button></div>
   <form className={styles.form} onSubmit={submit}>
    <label>Pelanggan / Pembeli<select name="customerId" required defaultValue=""><option value="">Pilih Pelanggan</option>{data.customers.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select><small>Master Pelanggan dikelola melalui menu Data Master → Pelanggan.</small></label>
    <label>Project<select required value={projectId} onChange={e=>{setProjectId(e.target.value);setWarehouseIds([]);setWeights({});}}><option value="">Pilih Project</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
    <div className={styles.wide}><b className={styles.fieldTitle}>Gudang Sumber</b><div className={styles.checkList}>{warehousesForProject.map(w=><label key={w.id}><input type="checkbox" checked={warehouseIds.includes(w.id)} onChange={e=>toggleWarehouse(w.id,e.target.checked)}/>{w.code} · {w.name}</label>)}</div>{projectId&&!warehousesForProject.length&&<small>Belum ada Warehouse yang terhubung dengan Project ini.</small>}</div>
    <div className={styles.wide}><b className={styles.fieldTitle}>Pilih Lot & Berat yang Akan Dijual</b><p className={styles.hint}>Pilih satu atau banyak Lot. Berat penjualan tidak boleh melebihi stok tersedia.</p>
     {!warehouseIds.length?<p className={styles.emptyInline}>Pilih Project dan minimal satu Gudang Sumber.</p>:!selectableLots.length?<p className={styles.emptyInline}>Tidak ada Lot dengan stok tersedia di gudang yang dipilih.</p>:<div className={styles.lotList}>{selectableLots.map(l=><div className={styles.lotRow} key={l.id}>
      <label className={styles.lotCheck}><input type="checkbox" checked={Boolean(weights[l.id])} onChange={e=>setWeights(old=>{const next={...old};if(e.target.checked)next[l.id]=String(l.available_weight_kg);else delete next[l.id];return next;})}/><span><b>{l.code}</b><small>{l.category_name} · {l.supplier_name} · {data.warehouses.find(w=>w.id===l.warehouse_id)?.name}</small><small>Stok {qty(l.available_weight_kg)} kg · Kadar {qty(Number(l.grade_value))} {l.grade_unit}</small></span></label>
      {weights[l.id]!==undefined&&<label className={styles.weightInput}>Berat (kg)<input type="number" min="0.001" max={l.available_weight_kg} step="0.001" value={weights[l.id]} onChange={e=>setWeights(old=>({...old,[l.id]:e.target.value}))}/></label>}
     </div>)}</div>}
    </div>
    <label>Harga Jual Awal per kg (Rp)<input name="salePricePerKg" type="number" min="0.01" step="0.01" required placeholder="Harga penawaran per kg"/></label>
    <label>Tujuan Pengiriman<input name="destination" required maxLength={500} placeholder="Lokasi / alamat tujuan pembeli"/></label>
    <label className={styles.wide}>Keterangan<textarea name="notes" rows={2} maxLength={1000} placeholder="Catatan penjualan (opsional)"/></label>
    <div className={styles.summary}><span>Lot dipilih: <b>{selected.length}</b></span><span>Total berat: <b>{qty(selectedWeight)} kg</b></span><span>Estimasi nilai pembelian Lot: <b>{money(estimatedCost)}</b></span></div>
    <p className={styles.notice}>Draft belum mengurangi stok. Stok baru berkurang setelah barang benar-benar keluar dan dikonfirmasi pada tahap berikutnya.</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} onClick={reset}>Batal</button><button className={styles.primary} disabled={busy||!selected.length}>{busy?"Menyimpan...":"Simpan Draft"}</button></div>
   </form></section>}
  <section className={styles.section}><div className={styles.sectionHeading}><div><h2>Daftar Penjualan</h2><p>{data.orders.length} transaksi ditampilkan</p></div></div>
   {!data.orders.length?<div className={styles.empty}><b>Belum ada transaksi penjualan</b><p>Draft penjualan yang dibuat akan muncul di sini.</p></div>:data.orders.map(o=>{const c=data.customers.find(x=>x.id===o.customer_id);const p=data.projects.find(x=>x.id===o.project_id);const a=data.allocations.filter(x=>x.sales_order_id===o.id);return <article className={styles.orderCard} key={o.id}>
    <div className={styles.cardTop}><div><span className={styles.code}>{o.code}</span><span className={styles.status}>{o.status}</span><h3>{c?.name??"Pelanggan"}</h3><p>{p?.code} · {p?.name} · {o.destination}</p></div><b className={styles.price}>{money(Number(o.sale_price_per_kg))}/kg</b></div>
    <div className={styles.allocations}><b>Lot yang Dipilih ({a.length})</b>{a.map(x=><div key={x.id}><span>{data.lots.find(l=>l.id===x.lot_id)?.code??"Lot"} · {data.warehouses.find(w=>w.id===x.source_warehouse_id)?.name??"Gudang"}</span><b>{qty(Number(x.allocated_weight_kg))} kg</b></div>)}</div>
    {o.notes&&<p className={styles.note}>{o.notes}</p>}
    <p className={styles.footnote}>Draft tersimpan · Stok belum dikurangi.</p>
   </article>})}
  </section>
 </main>;
}
