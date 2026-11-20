import Image from "next/image";
import { signIn } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = Boolean(params.error);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">
          <Image
            src="/logo_belanja.png"
            alt="BELANJA"
            width={1026}
            height={1027}
            className="brand-mark-logo"
            priority
          />
        </div>
        <p className="eyebrow">SENTRALOGIS · OPERATIONS</p>
        <h1>Masuk ke Belanja</h1>
        <p className="auth-intro">Gunakan akun yang telah didaftarkan oleh administrator.</p>

        {hasError && (
          <p className="auth-error" role="alert">
            {params.error === "missing"
              ? "Email dan password wajib diisi."
              : "Email atau password tidak sesuai, atau akun tidak dapat digunakan."}
          </p>
        )}

        <form action={signIn} className="auth-form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit">Masuk</button>
        </form>

        <p className="auth-footnote">Akses hanya untuk pengguna terdaftar. Pendaftaran mandiri tidak tersedia.</p>
      </section>
      <footer>© {new Date().getFullYear()} Sentralogis</footer>
    </main>
  );
}
