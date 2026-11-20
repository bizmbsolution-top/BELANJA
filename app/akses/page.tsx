import Link from "next/link";

export default function AccessPage() {
  return (
    <main className="dashboard-shell">
      <section className="dashboard-card">
        <p className="eyebrow">SENTRALOGIS · OPERATIONS</p>
        <h1>Akses Belum Tersedia</h1>
        <p className="intro">
          Akun Anda belum aktif atau Role belum ditetapkan oleh Owner.
        </p>
        <p className="notice">
          Silakan hubungi Owner untuk mengaktifkan akun dan mengatur Role akses Anda.
        </p>
        <p><Link href="/login">Kembali ke Login</Link></p>
      </section>
    </main>
  );
}
