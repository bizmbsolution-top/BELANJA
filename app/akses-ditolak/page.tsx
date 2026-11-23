import { signOut } from "@/app/login/actions";

type DenialReason =
  | "inactive"
  | "no-role"
  | "role-not-permitted"
  | "not-owner"
  | "invalid-role";

const messages: Record<DenialReason, { title: string; description: string }> = {
  inactive: {
    title: "Akses Belum Tersedia",
    description: "Akun Anda belum aktif. Hubungi Owner Belanja untuk memeriksa status akun.",
  },
  "no-role": {
    title: "Role Belum Diatur",
    description: "Akun Anda belum memiliki Role. Hubungi Owner Belanja untuk mengatur Role dan area kerja.",
  },
  "role-not-permitted": {
    title: "Akses Tidak Diizinkan",
    description: "Role Anda tidak memiliki akses ke halaman ini. Hubungi Owner Belanja jika Anda memerlukan akses.",
  },
  "not-owner": {
    title: "Akses Khusus Owner",
    description: "Halaman ini hanya dapat dibuka oleh Owner Belanja.",
  },
  "invalid-role": {
    title: "Data Role Tidak Valid",
    description: "Data Role akun Anda tidak dapat diverifikasi. Hubungi Owner Belanja untuk memeriksanya.",
  },
};

function isDenialReason(value: string | undefined): value is DenialReason {
  return value === "inactive"
    || value === "no-role"
    || value === "role-not-permitted"
    || value === "not-owner"
    || value === "invalid-role";
}

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = isDenialReason(reason)
    ? messages[reason]
    : {
        title: "Akses Ditolak",
        description: "Anda tidak memiliki izin untuk membuka halaman ini. Hubungi Owner Belanja jika membutuhkan bantuan.",
      };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fb", color: "#172b4d" }}>
      <section style={{ width: "min(100%, 460px)", padding: 32, border: "1px solid #e1e7f0", borderRadius: 18, background: "#fff", textAlign: "center" }}>
        <p style={{ margin: "0 0 10px", color: "#155eef", fontSize: 11, fontWeight: 800, letterSpacing: ".13em" }}>SENTRALOGIS · OPERATIONS</p>
        <h1 style={{ margin: "0 0 12px", fontSize: 25 }}>{message.title}</h1>
        <p style={{ margin: "0 0 22px", color: "#62718a", fontSize: 14, lineHeight: 1.6 }}>
          {message.description}
        </p>
        <form action={signOut}>
          <button type="submit" style={{ padding: "11px 18px", border: 0, borderRadius: 9, background: "#155eef", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Keluar</button>
        </form>
      </section>
    </main>
  );
}
