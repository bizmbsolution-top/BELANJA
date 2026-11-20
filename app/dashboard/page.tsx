import Image from "next/image";

export default function DashboardPage() {
  return (
    <div className="home-dashboard">
      <div className="home-heading">
        <p className="home-eyebrow">SENTRALOGIS · OPERATIONS</p>
        <h1>Dashboard</h1>
        <p>Ringkasan aktivitas operasional Belanja.</p>
      </div>
      <section className="welcome-card">
        <div className="welcome-icon">
          <Image
            src="/logo_belanja.png"
            alt=""
            width={1026}
            height={1027}
            className="welcome-logo"
          />
        </div>
        <div>
          <span className="welcome-status"><i /> Sistem siap digunakan</span>
          <h2>Selamat datang di BELANJA</h2>
          <p>Fondasi login, status akun, dan pemeriksaan Role sudah terhubung. Modul operasional akan ditampilkan bertahap sesuai akses pengguna.</p>
        </div>
      </section>
      <section className="quick-grid">
        <article><span>Total Pembelian</span><strong>—</strong><small>Data akan ditampilkan setelah modul aktif</small></article>
        <article><span>Total Pengeluaran</span><strong>—</strong><small>Data akan ditampilkan setelah modul aktif</small></article>
        <article><span>Posisi Kas</span><strong>—</strong><small>Data akan ditampilkan setelah modul aktif</small></article>
        <article><span>Nilai Penjualan</span><strong>—</strong><small>Data akan ditampilkan setelah modul aktif</small></article>
      </section>
    </div>
  );
}
