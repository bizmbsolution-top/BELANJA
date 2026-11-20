import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">SENTRALOGIS · OPERATIONS</p>
          <h1>Belanja</h1>
        </div>
        <form action={signOut}>
          <button className="button-secondary" type="submit">Keluar</button>
        </form>
      </header>
      <section className="dashboard-card">
        <div className="status-row"><span className="status-dot" />Autentikasi berhasil</div>
        <h2>Selamat datang</h2>
        <p className="intro">{user.email}</p>
        <p className="notice">
          Sesi pengguna sudah terhubung. Modul operasional dan pemeriksaan status aktif,
          role, serta scope akan disambungkan setelah fondasi data otorisasi disiapkan.
        </p>
      </section>
    </main>
  );
}
