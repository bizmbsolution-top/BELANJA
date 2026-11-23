import { requireAnyRole } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import styles from "./inventory.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Movement = {
  id: string; movement_type: string; receipt_id: string; project_id: string;
  warehouse_id: string; category_id: string; weight_kg: number; value: number;
  value_unit: string; created_at: string;
};

const weightLabel = (value: number) => `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;

export default async function PersediaanPage() {
  const actor = await requireAnyRole(["Warehouse", "Management"]);
  const admin = createAdminClient();
  const broadAccess = actor.isOwner || actor.roles.includes("Management");

  let warehouseIds: string[] | null = null;
  let projectIds: string[] | null = null;
  if (!broadAccess) {
    const [{ data: warehouseScope, error: warehouseScopeError }, { data: projectScope, error: projectScopeError }] = await Promise.all([
      admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id", actor.userId).eq("dimension", "warehouse").maybeSingle(),
      admin.from("user_work_scopes").select("scope_mode,resource_ids").eq("user_id", actor.userId).eq("dimension", "project").maybeSingle(),
    ]);
    if (warehouseScopeError || projectScopeError || !warehouseScope) throw new Error("Area kerja Warehouse belum dapat diverifikasi.");
    warehouseIds = warehouseScope.scope_mode === "all" ? null :
      warehouseScope.scope_mode === "selected" ? warehouseScope.resource_ids ?? [] : [];
    if (projectScope) {
      projectIds = projectScope.scope_mode === "all" ? null :
        projectScope.scope_mode === "selected" ? projectScope.resource_ids ?? [] : [];
    } else {
      projectIds = [];
    }
  }

  const [{ data: movements, error: movementError }, { data: warehouses }, { data: projects }, { data: categories }] = await Promise.all([
    admin.from("inventory_movements").select("id,movement_type,receipt_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_at").order("created_at", { ascending: false }).limit(1000),
    admin.from("warehouses").select("id,code,name,location").order("name"),
    admin.from("projects").select("id,code,name").order("name"),
    admin.from("purchase_categories").select("id,name").order("name"),
  ]);
  if (movementError) throw new Error("Data pergerakan persediaan gagal dimuat.");

  const visibleMovements = ((movements ?? []) as Movement[]).filter(row =>
    (warehouseIds === null || warehouseIds.includes(row.warehouse_id)) &&
    (projectIds === null || projectIds.includes(row.project_id))
  );
  const warehouseMap = new Map((warehouses ?? []).map(row => [row.id, row]));
  const projectMap = new Map((projects ?? []).map(row => [row.id, row]));
  const categoryMap = new Map((categories ?? []).map(row => [row.id, row]));
  const receiptIds = [...new Set(visibleMovements.map(row => row.receipt_id).filter(Boolean))];
  const { data: receipts } = receiptIds.length
    ? await admin.from("purchase_receipts").select("id,code,receipt_date,status").in("id", receiptIds)
    : { data: [] };
  const receiptMap = new Map((receipts ?? []).map(row => [row.id, row]));

  const stock = new Map<string, { warehouse_id: string; project_id: string; category_id: string; weight: number; valueWeight: number; valueUnit: string }>();
  for (const row of visibleMovements) {
    const key = [row.warehouse_id, row.project_id, row.category_id, row.value_unit].join(":");
    const item = stock.get(key) ?? { warehouse_id: row.warehouse_id, project_id: row.project_id, category_id: row.category_id, weight: 0, valueWeight: 0, valueUnit: row.value_unit };
    const quantity = Number(row.weight_kg);
    const sign = row.movement_type === "issue" ? -1 : 1;
    item.weight += sign * quantity;
    item.valueWeight += sign * quantity * Number(row.value);
    stock.set(key, item);
  }
  const stockRows = [...stock.values()].filter(row => row.weight > 0.0001).sort((a,b) =>
    (warehouseMap.get(a.warehouse_id)?.name ?? "").localeCompare(warehouseMap.get(b.warehouse_id)?.name ?? "")
  );
  const totalKg = stockRows.reduce((sum,row) => sum + row.weight, 0);
  const warehouseCount = new Set(stockRows.map(row => row.warehouse_id)).size;
  const categoryCount = new Set(stockRows.map(row => row.category_id)).size;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>OPERASIONAL</p><h1>Persediaan</h1><p>Saldo stok dan riwayat pergerakan barang berdasarkan Project dan Gudang.</p></div>
      </header>
      <section className={styles.metrics}>
        <article><strong>{weightLabel(totalKg)}</strong><span>Total stok tersedia</span></article>
        <article><strong>{warehouseCount}</strong><span>Gudang dengan stok</span></article>
        <article><strong>{categoryCount}</strong><span>Kategori barang</span></article>
        <article><strong>{visibleMovements.length}</strong><span>Pergerakan tercatat</span></article>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Saldo Stok per Gudang</h2><p>Stok dihitung dari seluruh pergerakan barang yang tercatat.</p></div></div>
        {stockRows.length === 0 ? <div className={styles.empty}><h3>Belum ada stok</h3><p>Stok akan muncul setelah penerimaan barang dinyatakan diterima.</p></div> :
          <div className={styles.stockList}>{stockRows.map((row,index) => {
            const warehouse = warehouseMap.get(row.warehouse_id), project = projectMap.get(row.project_id), category = categoryMap.get(row.category_id);
            const averageValue = row.weight > 0 ? row.valueWeight / row.weight : 0;
            return <article className={styles.stockCard} key={index}>
              <div><span className={styles.code}>{warehouse?.code ?? "GDG"}</span><h3>{warehouse?.name ?? "Gudang"}</h3><p>{project?.code} · {project?.name}</p><small>{category?.name ?? "Barang"}</small></div>
              <div className={styles.stockAmount}><strong>{weightLabel(row.weight)}</strong><span>Value rata-rata {averageValue.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {row.valueUnit}</span></div>
            </article>;
          })}</div>}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><h2>Kartu Stok</h2><p>Riwayat barang masuk dan keluar, terbaru lebih dahulu.</p></div></div>
        {visibleMovements.length === 0 ? <div className={styles.empty}><p>Belum ada riwayat pergerakan stok.</p></div> :
          <div className={styles.movementList}>{visibleMovements.map(row => {
            const warehouse = warehouseMap.get(row.warehouse_id), project = projectMap.get(row.project_id), category = categoryMap.get(row.category_id), receipt = receiptMap.get(row.receipt_id);
            return <article className={styles.movement} key={row.id}>
              <div className={styles.movementTop}><span className={row.movement_type === "issue" ? styles.out : styles.in}>{row.movement_type === "issue" ? "Stok Keluar" : "Stok Masuk"}</span><time>{new Date(row.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</time></div>
              <div className={styles.movementMain}><div><h3>{category?.name ?? "Barang"}</h3><p>{warehouse?.code} · {warehouse?.name} · {project?.code} {project?.name}</p><small>{receipt?.code ? `Penerimaan ${receipt.code}` : "Pergerakan persediaan"}</small></div><strong className={row.movement_type === "issue" ? styles.negative : styles.positive}>{row.movement_type === "issue" ? "−" : "+"}{weightLabel(Number(row.weight_kg))}</strong></div>
              <div className={styles.valueLine}>Value: {Number(row.value).toLocaleString("id-ID", { maximumFractionDigits: 4 })} {row.value_unit}</div>
            </article>;
          })}</div>}
      </section>
      <p className={styles.footnote}>Stok bertambah setelah penerimaan Pembelian disetujui. Pengurangan stok akan dicatat melalui transaksi Persediaan berikutnya.</p>
    </main>
  );
}
