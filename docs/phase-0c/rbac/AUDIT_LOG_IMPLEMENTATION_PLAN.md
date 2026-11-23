# Belanja — Rencana Implementasi Audit Log

Status: **DESAIN UNTUK REVIEW OWNER — BELUM ADA MIGRATION ATAU PERUBAHAN DATABASE**
Target: branch `ui-user-access-preview`

## 1. Tujuan tahap pertama

Mencatat perubahan administrasi pengguna yang dilakukan melalui halaman Pengguna. Audit Log tahap pertama bukan log semua aktivitas aplikasi; cakupannya dibatasi pada:

- Pembuatan akun pengguna.
- Perubahan Role dan status aktif/nonaktif.
- Perubahan Scope Project, Department, dan Warehouse.
- Perubahan Permission individual (allow/deny/unset).
- Perubahan email pengguna.
- Reset password (hanya mencatat bahwa reset berhasil; tidak pernah menyimpan password).

Tahap ini tidak mencatat isi transaksi, aktivitas pembelian/penjualan, atau setiap klik/navigasi.

## 2. Informasi yang disimpan

Setiap event menyimpan:

| Field | Tujuan |
|---|---|
| `id` | ID unik event |
| `actor_user_id` | User yang melakukan tindakan |
| `target_user_id` | User yang menjadi sasaran, bila ada |
| `action` | Kode aktivitas yang stabil |
| `entity_type` | Jenis objek, misalnya `user_access` atau `auth_user` |
| `entity_id` | ID objek yang berubah |
| `before_data` | Snapshot nilai sebelum perubahan |
| `after_data` | Snapshot nilai setelah perubahan |
| `created_at` | Waktu server saat event dicatat |

Tidak menyimpan password, token, Secret Key, session, OTP, atau data autentikasi sensitif. Untuk reset password hanya simpan event `user.password_reset` tanpa nilai sebelum/sesudah.

## 3. Kode aktivitas tahap pertama

- `user.created`
- `user.access_updated` — mencakup perubahan Role, status, Scope, dan Permission; snapshot hanya memuat field yang relevan.
- `user.email_updated` — email lama dan email baru boleh dicatat.
- `user.password_reset` — event saja, tanpa password.
  
Event hanya dibuat setelah tindakan berhasil. Perubahan multi-tabel pada Role/status/Scope/Permission harus diperlakukan sebagai satu operasi yang konsisten: jangan membuat event sukses bila sebagian penyimpanan gagal. Implementasi perlu menggunakan transaksi database (misalnya RPC terverifikasi) atau strategi server yang menjamin perubahan dan audit event tersimpan bersama.

## 4. Keamanan dan integritas

- Tabel audit memakai RLS aktif.
- Tidak memberi akses langsung kepada `anon` atau `authenticated`.
- Penulisan dilakukan server-side setelah `requireOwner()` dan validasi input.
- Pembacaan tahap pertama hanya untuk Owner.
- Tidak menyediakan edit atau delete event dari aplikasi.
- Audit event harus ditulis dalam transaksi yang sama dengan perubahan yang diaudit.
- Nilai `actor_user_id` berasal dari sesi server yang telah diverifikasi, bukan payload browser.
- Waktu berasal dari database/server, bukan jam browser.
- Kegagalan menulis audit harus menggagalkan perubahan yang diaudit (fail-closed), agar tidak ada perubahan tanpa jejak.

## 5. Rancangan tabel yang diusulkan

Nama tabel: `public.audit_logs`

Kolom awal:
- `id uuid primary key default gen_random_uuid()`
- `actor_user_id uuid null references auth.users(id) on delete set null`
- `target_user_id uuid null references auth.users(id) on delete set null`
- `action text not null`
- `entity_type text not null`
- `entity_id text null`
- `before_data jsonb null`
- `after_data jsonb null`
- `created_at timestamptz not null default now()`

Index yang diusulkan:
- `created_at desc`
- `target_user_id, created_at desc`
- `actor_user_id, created_at desc`

Tidak ada FK cascade untuk audit log. Penghapusan akun tidak boleh menghapus riwayat; referensi aktor/target menjadi NULL bila akun Auth dihapus.

## 6. Tampilan Audit Log

Halaman Owner menampilkan:
- Waktu.
- Pelaku.
- Aktivitas.
- Pengguna/objek yang diubah.
- Ringkasan perubahan.

Detail sebelum/sesudah dibuka saat dipilih. Filter awal: rentang tanggal, pelaku, pengguna, dan jenis aktivitas. Tampilan tidak menampilkan JSON mentah secara default.

## 7. Tahapan pengerjaan

1. Review dan persetujuan Owner atas skema tabel, aturan keamanan, dan daftar event.
2. Migration Supabase setelah persetujuan eksplisit.
3. Helper server-side untuk menulis event secara atomik bersama perubahan.
4. Integrasi ke aksi administrasi pengguna.
5. Halaman Riwayat Aktivitas khusus Owner.
6. Uji: event berhasil tercatat; perubahan gagal tidak menghasilkan event sukses; user non-Owner tidak bisa membaca; password/secret tidak pernah tersimpan; event tidak dapat diedit/dihapus.

## 8. Batasan

- Belum ada migration yang dibuat atau dijalankan.
- Belum ada tabel atau data Supabase yang diubah.
- Belum ada kode aplikasi yang diubah untuk menulis atau membaca audit event.
- Belum menyatakan Audit Log aktif sampai migration, integrasi, dan pengujian selesai.
