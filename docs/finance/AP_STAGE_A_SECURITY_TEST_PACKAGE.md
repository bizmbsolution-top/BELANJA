# BELANJA — Paket Uji Keamanan AP Stage A

Status: **Paket uji repository-only; belum dijalankan**  
Branch: `ui-user-access-preview`  
Database production: **tidak disentuh**  
Tujuan: memastikan pembatasan akses AP v2 tidak membuka data lintas tenant/Project dan tidak merusak voucher Pengeluaran lama.

## 1. Aturan keselamatan

- Jangan jalankan migrasi AP Stage A di Supabase production.
- Jangan jalankan paket ini di production.
- File SQL ini hanya untuk database uji terisolasi setelah migrasi Stage A diterapkan di sana.
- SQL assertion melakukan pemeriksaan katalog, privilege, policy, definisi RPC, dan constraint. Tidak ada INSERT/UPDATE/DELETE atau perubahan schema.
- Paket ini tidak membuat Supabase development branch berbayar.

## 2. File pengujian

- `supabase/tests/ap_stage_a_security_assertions.sql` — pemeriksaan otomatis berbasis `DO` assertion. Jika ada syarat yang gagal, query berhenti dengan pesan `FAIL`.
- `docs/finance/AP_STAGE_A_VERIFICATION.sql` — query inspeksi rinci untuk membantu membaca hasil.

## 3. Pemeriksaan otomatis yang dicakup

1. Tiga tabel AP baru tersedia dan RLS aktif.
2. `anon` dan `authenticated` tidak memiliki akses langsung ke tabel AP baru.
3. `service_role` tetap dapat membaca tabel AP baru.
4. Policy restrictive membatasi SELECT/INSERT/UPDATE/DELETE header AP v2 di `expenses`.
5. Policy restrictive mencegah authenticated menulis ledger debit pembayaran AP baru secara langsung.
6. Enam RPC legacy tetap hanya dapat dieksekusi oleh `service_role` dan memiliki pagar versi 1.
7. Default status lama `Aktif` dan constraint status `Aktif` + `Partial` tetap tersedia.
8. Constraint paid-fields legacy tetap ada.
9. Allow-list permission tenant mencakup `ap.create_edit` dan `ap.submit`; RPC pengaturan akses tervalidasi dan menyimpan kedua permission tersebut.

Jika seluruh blok `DO` selesai tanpa error, seluruh assertion di atas lulus. Query ringkasan di bagian akhir juga menampilkan beberapa status boolean.

## 4. Pengujian manual yang tetap wajib

Pemeriksaan katalog SQL **tidak membuktikan** bahwa aplikasi server action benar-benar memfilter tenant dan Project, atau bahwa tindakan AP sudah memeriksa permission tersebut. Permission baru pada Pengaturan Pengguna hanya menyimpan konfigurasi; enforcement AP harus hadir pada server action dan RPC Stage B sebelum AP dibuka. Setelah Stage B/AP read actions dibuat, lakukan pengujian integrasi berikut pada database uji dengan dua tenant dan dua Project:

| Skenario | Hasil yang wajib |
|---|---|
| User Tenant A meminta header AP Tenant B melalui URL/ID langsung | Ditolak atau tidak ditemukan |
| User Tenant A meminta item, pembayaran, atau bukti Tenant B | Ditolak atau tidak ditemukan |
| User Project A meminta AP Project B dalam tenant yang sama | Ditolak atau tidak ditemukan |
| User tanpa role/permission AP memanggil server action langsung | Ditolak |
| Finance dengan ap.create_edit = unset atau deny mencoba membuat/mengubah Draft | Ditolak |
| Finance dengan ap.create_edit = allow mencoba membuat/mengubah Draft | Lolos pemeriksaan permission, tetap wajib lolos Project scope dan validasi AP |
| Finance dengan ap.submit = unset atau deny mencoba submit | Ditolak |
| Finance dengan ap.submit = allow mencoba submit | Lolos pemeriksaan permission, tetap wajib lolos Project scope dan validasi AP |
| User non-Finance diberi override AP allow | Tetap ditolak |
| Superadmin tenant aktif tanpa override AP | Diizinkan dalam tenant aktif saja |
| Platform Owner mencoba tindakan AP tenant | Ditolak |
| User dengan scope Project A membaca AP Project A | Hanya data Project A |
| Manipulasi tenant_id/project_id pada payload | Tidak mengubah konteks otorisasi; ditolak |
| User authenticated mencoba akses tabel AP baru langsung melalui Data API | Ditolak |
| User authenticated mencoba membuat/mengubah/menghapus AP v2 atau ledger payment langsung | Ditolak |
| Data voucher lama versi 1 | Tetap tampil dan mengikuti hak akses legacy yang berlaku |
| RPC pembayaran legacy dipanggil pada AP v2 | Ditolak oleh pagar versi 1 |

**Catatan penting:** Stage A baru mengunci akses langsung Data API. Project scope untuk pembacaan AP harus diterapkan pada trusted server actions/RPC sebelum halaman AP dibuka untuk pengguna. Jangan menganggap RLS tenant-only sebagai pengganti Project scope.

## 5. Urutan penggunaan ketika database uji tersedia

1. Pastikan database tersebut benar-benar lingkungan uji, bukan production.
2. Terapkan migrasi Stage A hanya di database uji.
3. Jalankan `supabase/tests/ap_stage_a_security_assertions.sql`.
4. Jika muncul error `FAIL`, hentikan dan kirim pesan error lengkap untuk diperiksa.
5. Jika lulus, simpan hasil SQL dan lanjutkan pengujian integrasi setelah Stage B read actions tersedia.
6. Jangan menggabungkan atau menerapkan migrasi ke production hanya berdasarkan hasil assertion katalog; seluruh skenario manual dan review rollout tetap wajib.

## 6. Batas cakupan

Paket ini belum menguji:
- isolasi dua tenant melalui sesi JWT nyata;
- pembatasan Project scope pada server actions (belum ada jalur baca AP Stage B);
- transaksi pembayaran atomik, batas sisa tagihan, reversal, dan konsistensi ledger;
- upload/download bukti pembayaran dan validasi storage path.

Bagian tersebut harus diuji pada tahap implementasi terkait, bukan disimpulkan lulus dari pemeriksaan katalog Stage A.
