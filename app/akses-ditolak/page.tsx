import { signOut } from "@/app/login/actions";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const inactive = reason === "inactive";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fb", color: "#172b4d" }}>
      <section style={{ width: "min(100%, 460px)", padding: 32, border: "1px solid #e1e7f0", borderRadius: 18, background: "#fff", textAlign: "center" }}>
        <p style={{ margin: "0 0 10px", color: "#155eef", fontSize: 11, fontWeight: 800, letterSpacing: ".13em" }}>SENTRALOGIS · OPERATIONS</p>
        <h1 style={{ margin: "0 0 12px", fontSize: 25 }}>Akses Belum Tersedia</h1>
        <p style={{ margin: "0 0 22px", color: "#62718a", fontSize: 14, lineHeight: 1.6 }}>
          {inactive
            ? "Akun Anda belum aktif. Hubungi Owner Belanja untuk memeriksa status akun."
            : "Akun Anda belum memiliki Role. Hubungi Owner Belanja untuk mengatur Role dan area kerja."}
        </p>
        <form action={signOut}>
          <button type="submit" style={{ padding: "11px 18px", border: 0, borderRadius: 9, background: "#155eef", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Keluar</button>
        </form>
      </section>
    </main>
  );
}
