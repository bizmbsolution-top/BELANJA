type Props = { title: string; description: string };

export default function ModulePlaceholder({ title, description }: Props) {
  return (
    <section style={{ maxWidth: 760, padding: "8px 0" }}>
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.65 }}>
        SENTRALOGIS · OPERATIONS
      </p>
      <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>{title}</h1>
      <p style={{ margin: "0 0 20px", lineHeight: 1.6 }}>{description}</p>
      <div style={{ padding: 16, border: "1px solid var(--border, #d8dee8)", borderRadius: 12 }}>
        <strong>Akses Role berhasil diperiksa.</strong>
        <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
          Halaman uji ini sudah dilindungi pemeriksaan Role di server. Fitur transaksi pada modul ini belum diaktifkan.
        </p>
      </div>
    </section>
  );
}
