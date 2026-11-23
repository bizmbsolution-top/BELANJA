import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./report.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const qty = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);

export default async function SalesReportPage() {
  await requireAnyRole(["Finance", "Management"]);
  const admin = createAdminClient();
  const [{ data: orders, error }, { data: customers }, { data: projects }, { data: allocations }] = await Promise.all([
    admin.from("sales_orders").select("id,code,customer_id,project_id,status,created_at,dispatched_at,dispatched_weight_kg,received_weight_kg,final_grade_value,final_grade_unit,final_price_per_kg,final_amount,ba_number,ba_date,discrepancy_notes,dispatched_purchase_cost").order("created_at", { ascending: false }).limit(300),
    admin.from("customers").select("id,name"),
    admin.from("projects").select("id,code,name"),
    admin.from("sales_order_lot_allocations").select("sales_order_id,allocated_weight_kg")
  ]);
  if (error) throw new Error("Rekap penjualan gagal dimuat.");

  const rows = orders ?? [];
  const completed = rows.filter((o) => o.status === "Selesai");
  const dispatched = rows.filter((o) => o.status === "Dikirim" || o.status === "Selesai");
  const totalDispatched = dispatched.reduce((sum, o) => sum + Number(o.dispatched_weight_kg ?? 0), 0);
  const totalReceived = completed.reduce((sum, o) => sum + Number(o.received_weight_kg ?? 0), 0);
  const totalSales = completed.reduce((sum, o) => sum + Number(o.final_amount ?? 0), 0);
  const totalCost = completed.reduce((sum, o) => sum + Number(o.dispatched_purchase_cost ?? 0), 0);
  const totalProfit = totalSales - totalCost;
  const customerMap = new Map((customers ?? []).map((x) => [x.id, x.name]));
  const projectMap = new Map((projects ?? []).map((x) => [x.id, x]));
  const lotCount = (id: string) => (allocations ?? []).filter((a) => a.sales_order_id === id).length;
  const date = (value: string | null) => value ? new Date(value + (value.length === 10 ? "T00:00:00" : "")).toLocaleDateString("id-ID") : "—";

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>LAPORAN MANAJEMEN</p><h1>Rekap Penjualan</h1><p>Ringkasan penjualan berdasarkan penerimaan final pembeli dan biaya pembelian Lot.</p></div>
      <span className={styles.period}>300 transaksi terbaru · Semua Project</span>
    </header>
    <section className={styles.metrics}>
      <article><span>Total Penjualan</span><b>{rows.length}</b><small>{completed.length} selesai · {rows.filter(o => o.status === "Dikirim").length} dikirim · {rows.filter(o => o.status === "Draft").length} draft</small></article>
      <article><span>Berat Dikirim</span><b>{qty(totalDispatched)} kg</b><small>Transaksi Dikirim dan Selesai</small></article>
      <article><span>Berat Diterima Pembeli</span><b>{qty(totalReceived)} kg</b><small>Hanya transaksi Selesai</small></article>
      <article><span>Nilai Penjualan Final</span><b>{money(totalSales)}</b><small>Berdasarkan BA pembeli</small></article>
      <article><span>Nilai Pembelian Lot</span><b>{money(totalCost)}</b><small>Biaya aktual Lot transaksi selesai</small></article>
      <article className={totalProfit >= 0 ? styles.profit : styles.loss}><span>Estimasi Laba Kotor</span><b>{money(totalProfit)}</b><small>Penjualan final dikurangi nilai pembelian Lot</small></article>
    </section>
    <section className={styles.note}><b>Catatan perhitungan</b><p>Laba kotor dihitung dari nilai penjualan final pada BA dikurangi biaya pembelian aktual Lot yang dialokasikan ke transaksi. Belum dikurangi biaya operasional, transportasi, atau biaya lainnya. Draft dan transaksi Dikirim belum masuk perhitungan laba.</p></section>
    <section className={styles.tableCard}>
      <div className={styles.tableHeading}><div><h2>Rincian Transaksi</h2><p>{rows.length} transaksi ditampilkan</p></div></div>
      {!rows.length ? <div className={styles.empty}>Belum ada transaksi penjualan.</div> : <div className={styles.tableScroll}><table>
        <thead><tr><th>Transaksi / Pembeli</th><th>Project</th><th>Status</th><th>Lot</th><th>Dikirim</th><th>Diterima</th><th>Selisih</th><th>BA Pembeli</th><th>Nilai Final</th><th>Biaya Lot</th><th>Laba Kotor</th></tr></thead>
        <tbody>{rows.map((o) => {
          const done = o.status === "Selesai";
          const sent = Number(o.dispatched_weight_kg ?? 0);
          const received = done ? Number(o.received_weight_kg ?? 0) : 0;
          const difference = done ? sent - received : null;
          const sale = done ? Number(o.final_amount ?? 0) : 0;
          const cost = done ? Number(o.dispatched_purchase_cost ?? 0) : 0;
          const project = projectMap.get(o.project_id);
          return <tr key={o.id}>
            <td><b>{o.code}</b><small>{customerMap.get(o.customer_id) ?? "Pelanggan"} · {date(o.created_at)}</small></td>
            <td>{project ? project.code + " · " + project.name : "—"}</td>
            <td><span className={styles.status}>{o.status}</span></td>
            <td>{lotCount(o.id)}</td>
            <td>{sent ? qty(sent) + " kg" : "—"}</td>
            <td>{done ? qty(received) + " kg" : "—"}</td>
            <td>{difference === null ? "—" : qty(difference) + " kg"}</td>
            <td>{done ? <><b>{o.ba_number}</b><small>{date(o.ba_date)}</small><small>Kadar {qty(Number(o.final_grade_value ?? 0))} {o.final_grade_unit}</small></> : "—"}</td>
            <td>{done ? money(sale) : "—"}</td>
            <td>{done ? money(cost) : "—"}</td>
            <td className={done ? (sale - cost >= 0 ? styles.positive : styles.negative) : ""}>{done ? money(sale - cost) : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
  </main>;
}
