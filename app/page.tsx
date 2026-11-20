export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="welcome-panel">
        <div className="brand-mark" aria-hidden="true">B</div>
        <p className="eyebrow">SENTRALOGIS · OPERATIONS</p>
        <h1>Belanja</h1>
        <p className="intro">
          Platform operasional untuk mengelola kebutuhan, penggunaan dana,
          pembelian, persediaan, dan pembayaran.
        </p>
        <div className="status-row">
          <span className="status-dot" />
          <span>Fondasi aplikasi berhasil dimuat</span>
        </div>
        <p className="notice">
          Tahap berikutnya: koneksi autentikasi dan database Supabase.
        </p>
      </section>
      <footer>© {new Date().getFullYear()} Sentralogis</footer>
    </main>
  );
}
