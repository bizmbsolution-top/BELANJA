# Belanja — Implementasi Audit Log

Status: **Skema dan integrasi awal diterapkan pada Supabase serta branch preview**
Target: branch `ui-user-access-preview` · Supabase project `zguzjoqmghmmviyixecz`

## 1. Cakupan

Audit Log tahap pertama mencatat administrasi pengguna:
- Pembuatan akun.
- Perubahan Role, status aktif/nonaktif, Scope Project/Department/Warehouse, dan Permission individual.
- Permintaan dan hasil perubahan email.
- Permintaan dan hasil reset password.

Tidak mencatat isi transaksi Pembelian/Penjualan, atau klik/navigasi. Perubahan Master Supplier dicatat sebagai event data master.

## 2. Data dan keamanan

Tabel: `public.audit_logs`.

Kolom: `id`, `actor_user_id`, `target_user_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `created_at`.

- RLS aktif; tidak ada grant langsung untuk `anon` atau `authenticated`.
- `service_role` hanya memiliki `SELECT` dan `INSERT` pada tabel audit.
- Tidak ada izin `UPDATE`, `DELETE`, atau `TRUNCATE` untuk `service_role`.
- Fungsi penyimpanan akses menggunakan `SECURITY INVOKER` dan hanya dapat dijalankan oleh `service_role`.
- Semua pembacaan dan penulisan audit melalui server-side code yang memverifikasi `requireOwner()`.
- Nilai pelaku berasal dari sesi server, bukan input browser.
- Password, token, Secret Key, session, OTP, dan data autentikasi sensitif tidak pernah disimpan.

## 3. Atomisitas dan operasi Auth

Perubahan Role/status/Scope/Permission dijalankan oleh fungsi database `save_user_access_profile_with_audit`. Update profil, scope, permission, dan insert audit berada dalam satu transaksi PostgreSQL. Jika insert audit gagal, seluruh perubahan akses ikut dibatalkan.

Supabase Auth Admin API untuk pembuatan akun, perubahan email, dan reset password tidak dapat bergabung ke transaksi PostgreSQL. Karena itu:
- Pembuatan akun mencatat `user.created` setelah profil berhasil dibuat; jika audit gagal, proses kompensasi menghapus profil dan akun Auth yang baru dibuat.
- Perubahan email dan reset password mencatat event permintaan sebelum memanggil Auth Admin API, lalu mencatat hasil berhasil/gagal.
- Password tidak pernah dimasukkan ke payload audit.

## 4. Kode aktivitas

- `user.created`
- `user.access_updated`
- `user.email_update_requested`, `user.email_updated`, `user.email_update_failed`
- `user.password_reset_requested`, `user.password_reset`, `user.password_reset_failed`

## 5. Tampilan

Halaman Owner: `/dashboard/riwayat-aktivitas`.
- Menampilkan 200 aktivitas terbaru.
- Menampilkan waktu WIB, pelaku, pengguna terkait, dan jenis aktivitas.
- Detail sebelum/sesudah ditampilkan sebagai ringkasan, bukan JSON mentah.
- Menu hanya tampil pada navigasi Owner.
- Filter belum termasuk tahap awal ini.

## 6. Migration

Migration yang tercatat pada Supabase:
- `20261123051909_create_audit_logs`
- `20261123051943_save_user_access_profile_with_audit`

File SQL yang sesuai disimpan di `supabase/migrations/` pada branch preview. File dokumentasi `AUDIT_LOG_SCHEMA_MIGRATION_REVIEW.sql` menjadi salinan/referensi skema tabel.

## 7. Hasil verifikasi

- Tabel `public.audit_logs` tersedia.
- RLS aktif.
- Index waktu, target+waktu, pelaku+waktu tersedia; satu index tambahan adalah primary key.
- Grant `service_role`: hanya `SELECT, INSERT`.
- Grant langsung untuk `anon`, `authenticated`, dan `public`: tidak ada.
- Uji fungsi akses dilakukan dalam transaksi yang di-rollback; fungsi berjalan tanpa error dan tidak meninggalkan event uji.
- Pemeriksaan advisor masih menampilkan peringatan lama pada `public.rls_auto_enable()` yang dapat dieksekusi `anon` dan `authenticated`, serta peringatan perlindungan password bocor yang belum aktif. Peringatan tersebut tidak dibuat oleh migration Audit Log dan belum diubah.

## 8. Master Supplier (tahap awal)

- Tabel `public.suppliers` tersedia dengan kode otomatis, nama, kontak, telepon, email, alamat, catatan, status aktif, timestamp, dan pencatat.
- RLS aktif; akses tabel hanya melalui server-side `service_role`, tanpa grant untuk browser.
- Create/update menggunakan RPC `SECURITY INVOKER`; perubahan data dan insert Audit Log berada dalam satu transaksi.
- Tidak ada hard delete. Supplier yang tidak digunakan dapat dinonaktifkan.
- Event: `supplier.created` dan `supplier.updated`.
- Menu Supplier tersedia untuk Procurement, Finance, dan Management.

## 9. Belum diverifikasi

- Build Vercel dan pengujian browser end-to-end untuk halaman Riwayat Aktivitas.
- Uji login sebagai non-Owner untuk memastikan halaman ditolak.
- Uji aksi create/email/password langsung melalui UI dan verifikasi event masing-masing.
- Uji kegagalan audit saat operasi Auth dan perilaku kompensasi.
- Uji bahwa event tidak dapat diubah/dihapus melalui jalur aplikasi.

Audit Log sudah memiliki skema dan integrasi awal, tetapi belum dinyatakan lulus pengujian end-to-end sampai butir di atas selesai.
