import Image from "next/image";
import { requireActiveUser } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const rupiah = (value: number) => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0,
}).format(value);
const dateLabel = (value: string) => new Intl.DateTimeFormat("id-ID", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
}).format(new Date(value + (value.length === 10 ? "T00:00:00" : "")));

export default async function DashboardPage() {
  const access = await requireActiveUser();
  const canViewFinancialSummary = access.isOwner || access.roles.some((role) => ["Finance", "Management"].includes(role));

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? String(now.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(now.getMonth() + 1).padStart(2, "0");
  const monthStart = `${year}-${month}-01`;
  const monthEnd = new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);
  let expenseTotal = 0;
  let expenseCount = 0;
  let recentExpenses: { code: string; expense_date: string; description: string; amount: number; status: string }[] = [];

  if (canViewFinancialSummary) {
    const admin = createAdminClient();
    const { data, error } = await admin.from("expenses")
      .select("code,expense_date,description,amount,status")
      .gte("expense_date", monthStart).lte("expense_date", monthEnd)
      .order("expense_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
    if (error) throw new Error("Ringkasan pengeluaran dashboard gagal dimuat.");
    const rows = data ?? [];
    const activeRows = rows.filter((item) => item.status === "Dibayar");
    expenseTotal = activeRows.reduce((sum, item) => sum + Number(item.amount), 0);
    expenseCount = activeRows.length;
    recentExpenses = rows.slice(0, 5).map((item) => ({
      code: item.code, expense_date: item.expense_date, description: item.description,
      amount: Number(item.amount), status: item.status,
    }));
  }

  return (
    <div className="home-dashboard">
      <div className="home-heading">
        <p className="home-eyebrow">SENTRALOGIS · OPERATIONS</p>
        <h1>Management Dashboard</h1>
        <p>Ringkasan aktivitas operasional BELANJA · {month}/{year}</p>
      </div>
      <section className="welcome-card">
        <div className="welcome-icon">
          <Image src="/logo_belanja.png" alt="" width={1026} height={1027} className="welcome-logo" />
        </div>
        <div>
          <span className="welcome-status"><i /> Sistem siap digunakan</span>
          <h2>Selamat datang di BELANJA</h2>
          <p>Pantau aktivitas operasional dari satu halaman. Angka hanya ditampilkan jika datanya sudah tersedia dan tercatat di sistem.</p>
        </div>
      </section>
      <section className="quick-grid">
        <article><span>Total Pembelian</span><strong>—</strong><small>Ringkasan tersedia setelah transaksi pembelian aktif.</small></article>
        <article className="dashboard-live"><span>Pengeluaran Bulan Ini</span><strong>{canViewFinancialSummary ? rupiah(expenseTotal) : "—"}</strong><small>{canViewFinancialSummary ? `${expenseCount} transaksi dibayar · ${month}/${year}` : "Ringkasan keuangan untuk Finance dan Management."}</small></article>
        <article><span>Posisi Kas</span><strong>—</strong><small>Menunggu pencatatan kas dan pembayaran.</small></article>
        <article><span>Nilai Penjualan</span><strong>—</strong><small>Ringkasan tersedia setelah transaksi penjualan aktif.</small></article>
      </section>
      {canViewFinancialSummary && <section className="dashboard-recent">
        <div className="dashboard-section-heading"><div><h2>Pengeluaran Terbaru</h2><p>Transaksi pada bulan berjalan</p></div><a href="/dashboard/pengeluaran">Buka Expenses</a></div>
        {recentExpenses.length === 0 ? <p className="dashboard-empty">Belum ada transaksi pengeluaran bulan ini.</p> : <div className="dashboard-table">
          {recentExpenses.map((item) => <div className="dashboard-row" key={item.code}>
            <div><strong>{item.description}</strong><small>{item.code} · {dateLabel(item.expense_date)}</small></div>
            <div className="dashboard-row-value"><strong>{rupiah(item.amount)}</strong><small className={item.status === "Dibayar" ? "dashboard-status-active" : "dashboard-status-cancelled"}>{item.status}</small></div>
          </div>)}
        </div>}
      </section>}
      <p className="dashboard-footnote">Posisi kas bukan laba. Nilai kas akan ditampilkan setelah modul kas dan pembayaran tersedia. Pengeluaran dihitung saat voucher dibayar oleh Kasir; Draft dan voucher menunggu pembayaran belum mengurangi posisi kas.</p>
    </div>
  );
}
