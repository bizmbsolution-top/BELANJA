# Belanja — Rencana Implementasi Audit Log

Status: **SQL schema draft tersedia untuk review — belum ada migration formal atau perubahan database**
Target: branch `ui-user-access-preview`

## 1. Tujuan tahap pertama

Mencatat perubahan administrasi pengguna melalui halaman Pengguna:
- Pembuatan akun.
- Perubahan Role dan status aktif/nonaktif.
- Perubahan Scope Project, Department, Warehouse.
- Perubahan Permission individual (allow/deny/unset).
- Perubahan email.
- Reset password (event saja; password tidak pernah disimpan).

Tidak mencatat isi transaksi, aktivitas pembelian/penjualan, atau setiap klik/navigasi.

## 2. Data yang disimpan

- `id`: ID event.
- `actor_user_id`: pelaku yang diverifikasi server.
- `target_user_id`: pengguna sasaran.
- `action`: kode aktivitas.
- `entity_type` dan `entity_id`: objek terkait.
- `before_data` dan `after_data`: snapshot non-rahasia yang diizinkan.
- `created_at`: waktu database/server.

Dilarang menyimpan password, token, Secret Key, session, OTP, atau data autentikasi sensitif.

## 3. Kode aktivitas

- `user.created`
- `user.access_updated`
- `user.email_update_requested`, `user.email_updated`, `user.email_update_failed`
- `user.password_reset_requested`, `user.password_reset`, `user.password_reset_failed`

Untuk email dan password, event hanya mencatat permintaan dan hasil; password tidak pernah masuk ke snapshot.

## 4. Keamanan dan transaksi

- RLS aktif; tidak ada akses langsung untuk `anon` atau `authenticated`.
- Hanya server-side code yang boleh membaca/menulis, setelah `requireOwner()`.
- `service_role` hanya dipakai di server dan tidak boleh masuk ke browser.
- Tidak menyediakan edit/delete event di aplikasi.
- Nilai pelaku berasal dari sesi server, bukan payload browser.
- Waktu dibuat oleh database/server.
- Perubahan Role/status/Scope/Permission dan event audit harus berada dalam satu transaksi database. Jika audit gagal, perubahan database ikut dibatalkan.
- Supabase Auth Admin API untuk email/password tidak dapat bergabung ke transaksi PostgreSQL. Karena itu dicatat sebagai event permintaan dan hasil (berhasil/gagal), tanpa mengklaim atomisitas lintas Auth dan database.

## 5. Skema tabel

Nama tabel: `public.audit_logs`.

SQL schema draft terpisah: `AUDIT_LOG_SCHEMA_MIGRATION_REVIEW.sql`.

Kolom:
- `id uuid primary key`
- `actor_user_id uuid null references auth.users(id) on delete set null`
- `target_user_id uuid null references auth.users(id) on delete set null`
- `action text not null`
- `entity_type text not null`
- `entity_id text null`
- `before_data jsonb null`
- `after_data jsonb null`
- `created_at timestamptz not null default now()`

Index pada waktu, target+waktu, dan pelaku+waktu. Referensi akun memakai `ON DELETE SET NULL`, sehingga penghapusan akun tidak menghapus histori.

## 6. Tampilan

Halaman khusus Owner menampilkan waktu, pelaku, aktivitas, pengguna sasaran, dan ringkasan perubahan. Detail sebelum/sesudah dapat dibuka. Filter awal: tanggal, pelaku, pengguna, jenis aktivitas. JSON mentah tidak ditampilkan sebagai tampilan utama.

## 7. Tahapan

1. Review SQL schema draft.
2. Setelah persetujuan, buat migration formal melalui Supabase CLI.
3. Integrasikan perubahan Role/status/Scope/Permission dan audit dalam satu transaksi.
4. Integrasikan event permintaan/hasil untuk operasi Auth.
5. Buat halaman Riwayat Aktivitas khusus Owner.
6. Uji akses non-Owner, atomisitas, kegagalan, append-only, dan larangan penyimpanan secret.

## 8. Status

- SQL schema draft tersedia di folder dokumentasi untuk ditinjau; **bukan migration formal**.
- Belum ada migration formal yang dibuat atau dijalankan.
- Belum ada tabel atau data Supabase yang diubah.
- Belum ada kode aplikasi yang menulis atau membaca audit event.
- Audit Log belum aktif sampai implementasi dan pengujian selesai.
