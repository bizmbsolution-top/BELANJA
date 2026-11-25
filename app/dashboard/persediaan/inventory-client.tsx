"use client";

import { useMemo, useState } from "react";
import styles from "./inventory.module.css";

type WarehouseItem = { id: string; code: string; name: string; location: string | null; projectLabel: string; totalKg: number; averageValue: number | null; averageValueUnit: string | null; categories: { name: string; weight: number; averageValue: number; valueUnit: string }[] };
type LotItem = { id: string; code: string; inboundDate: string; category: string; supplier: string; initialWeight: number; availableWeight: number; gradeValue: number; gradeUnit: string; purchasePricePerKg: number; totalPurchaseCost: number };
type MovementItem = { id: string; type: string; date: string; category: string; weight: number; value: number; valueUnit: string; reference: string; lotCode: string; projectCode: string; projectName: string };
type Props = { warehouses: WarehouseItem[]; lots: Record<string, LotItem[]>; movements: Record<string, MovementItem[]>; totalKg: number; movementCount: number; categoryCount: number };

const qty = (n: number) => `${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
const date = (s: string) => new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
const shortDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("id-ID", { dateStyle: "medium" });

export default function InventoryClient({ warehouses, lots, movements, totalKg, movementCount, categoryCount }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [type, setType] = useState("all");
  const active = warehouses.find(w => w.id === selected) ?? null;
  const activeLots = selected ? lots[selected] ?? [] : [];
  const rows = useMemo(() => (selected ? movements[selected] ?? [] : []).filter(m => type === "all" || m.type === type), [selected, movements, type]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const open = (id: string) => { setSelected(id); setPage(0); setType("all"); };
  const close = () => { setSelected(null); setPage(0); };

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>OPERASIONAL</p><h1>Persediaan</h1><p>Ringkasan sisa stok berdasarkan Gudang. Pilih Gudang untuk melihat detail dan riwayatnya.</p></div></header>
    <section className={styles.metrics}>
      <article><strong>{qty(totalKg)}</strong><span>Total stok tersedia</span></article>
      <article><strong>{warehouses.length}</strong><span>Gudang dengan stok</span></article>
      <article><strong>{categoryCount}</strong><span>Kategori barang</span></article>
      <article><strong>{movementCount}</strong><span>Pergerakan tercatat</span></article>
    </section>
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><h2>Daftar Gudang</h2><p>Total/sisa stok tersedia pada setiap Gudang.</p></div></div>
      {warehouses.length === 0 ? <div className={styles.empty}><h3>Belum ada stok</h3><p>Stok akan muncul setelah penerimaan barang dinyatakan diterima.</p></div> :
        <div className={styles.stockList}>{warehouses.map(w => <button type="button" className={styles.warehouseCard} key={w.id} onClick={() => open(w.id)}>
          <div className={styles.warehouseInfo}><span className={styles.code}>{w.code}</span><h3>{w.name}</h3><p>{w.projectLabel}</p>{w.location && <small>{w.location}</small>}</div>
          <div className={styles.warehouseRight}><strong>{qty(w.totalKg)}</strong><span>Sisa stok tersedia</span>{w.averageValue !== null && w.averageValueUnit && <span>Estimasi average kadar {w.averageValue.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {w.averageValueUnit}</span>}<span className={styles.viewDetails}>View Details <b>›</b></span></div>
        </button>)}</div>}
    </section>
    <p className={styles.footnote}>Pilih Gudang untuk melihat rincian stok per kategori, Lot, dan riwayat pergerakan.</p>
    {active && <div className={styles.modalBackdrop} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title">
        <header className={styles.modalHeader}><div><p className={styles.eyebrow}>DETAIL PERSEDIAAN</p><h2 id="inventory-modal-title">{active.name}</h2><p>{active.code} · {active.projectLabel}</p></div><button type="button" className={styles.closeButton} onClick={close} aria-label="Tutup">×</button></header>
        <div className={styles.modalTotal}><div><span>Total/sisa stok Gudang</span>{active.averageValue !== null && active.averageValueUnit && <span className={styles.averageValue}>Estimasi average kadar {active.averageValue.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {active.averageValueUnit}</span>}</div><strong>{qty(active.totalKg)}</strong></div>
        <section className={styles.modalSection}><h3>Rincian Stok</h3>
          {active.categories.map((c,i) => <div className={styles.categoryRow} key={i}><div><strong>{c.name}</strong><span>Value rata-rata {c.averageValue.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {c.valueUnit}</span></div><b>{qty(c.weight)}</b></div>)}
        </section>
        <section className={styles.modalSection}><h3>Daftar Lot</h3>
          <p className={styles.footnote}>Setiap Lot berasal dari satu penerimaan barang. Stok tersisa dihitung dari kartu pergerakan Lot.</p>
          {activeLots.length === 0 ? <div className={styles.empty}><p>Belum ada Lot tersedia di Gudang ini.</p></div> : activeLots.map(lot => <div className={styles.categoryRow} key={lot.id}>
            <div><strong>{lot.code}</strong><span>{lot.category} · {lot.supplier} · Inbound {shortDate(lot.inboundDate)}</span><span>Berat awal {qty(lot.initialWeight)} · Kadar {lot.gradeValue.toLocaleString("id-ID", { maximumFractionDigits: 4 })} {lot.gradeUnit}</span></div>
            <b>{qty(lot.availableWeight)}</b>
          </div>)}
        </section>
        <section className={styles.modalSection}><div className={styles.historyHeading}><div><h3>Riwayat Pergerakan</h3><span>{rows.length} transaksi</span></div><select value={type} onChange={e => {setType(e.target.value);setPage(0);}} aria-label="Filter jenis pergerakan"><option value="all">Semua</option><option value="receipt">Stok Masuk</option><option value="issue">Stok Keluar</option><option value="sale_dispatch">Penjualan Keluar</option><option value="purchase_return">Return ke Supplier</option><option value="transfer_in">Transfer Masuk</option><option value="transfer_out">Transfer Keluar</option></select></div>
          {rows.length === 0 ? <div className={styles.empty}><p>Belum ada riwayat untuk filter ini.</p></div> : <div className={styles.modalMovements}>{pageRows.map(m => <article className={styles.modalMovement} key={m.id}><div className={styles.movementTop}><span className={m.type === "issue" || m.type === "transfer_out" || m.type === "sale_dispatch" || m.type === "purchase_return" ? styles.out : styles.in}>{({receipt:"Stok Masuk",issue:"Stok Keluar",sale_dispatch:"Penjualan Keluar",purchase_return:"Return ke Supplier",transfer_in:"Transfer Masuk",transfer_out:"Transfer Keluar"} as Record<string,string>)[m.type] ?? "Pergerakan"}</span><time>{date(m.date)}</time></div><div className={styles.movementMain}><div><h4>{m.category}</h4><small>{m.reference || "Pergerakan persediaan"}</small>{m.reason && <small>Alasan: {m.reason}</small>}</div><strong className={m.type === "issue" || m.type === "transfer_out" || m.type === "sale_dispatch" || m.type === "purchase_return" ? styles.negative : styles.positive}>{m.type === "issue" || m.type === "transfer_out" || m.type === "sale_dispatch" || m.type === "purchase_return" ? "−" : "+"}{qty(m.weight)}</strong></div><div className={styles.valueLine}>Value: {m.value.toLocaleString("id-ID", { maximumFractionDigits: 4 })} {m.valueUnit}</div></article>)}</div>}
          {rows.length > pageSize && <div className={styles.pagination}><span>Halaman {page+1} dari {pageCount}</span><div><button type="button" disabled={page===0} onClick={() => setPage(p=>p-1)}>Sebelumnya</button><button type="button" disabled={page+1>=pageCount} onClick={() => setPage(p=>p+1)}>Berikutnya</button></div></div>}
        </section>
      </section>
    </div>}
  </main>;
}
