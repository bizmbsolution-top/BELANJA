# BELANJA — Panduan Uji Awal AP Stage A (Read-only)

Status: Aman dijalankan; hanya membaca database  
Branch: `ui-user-access-preview`  
Tujuan: Memeriksa kondisi database sebelum migrasi AP dipertimbangkan.

## Penting

- Skrip pada panduan ini **tidak mengubah database**.
- Jangan menjalankan file migrasi `20261127180000_ap_foundation_v1.sql` pada tahap ini.
- Jangan menekan tombol apa pun yang menjalankan perubahan schema.
- Jalankan hanya pada project Supabase BELANJA yang benar, lalu kirim hasilnya untuk ditinjau.

## Langkah 1 — Buka SQL Editor

1. Masuk ke Supabase Dashboard.
2. Pilih project **BELANJA**.
3. Buka menu **SQL Editor**.
4. Buat query baru.

## Langkah 2 — Jalankan pemeriksaan awal

1. Buka file `docs/finance/AP_STAGE_A_PREFLIGHT.sql` di GitHub branch `ui-user-access-preview`.
2. Salin seluruh isi file tersebut.
3. Tempel ke SQL Editor Supabase.
4. Klik **Run** satu kali.
5. Simpan screenshot atau salin hasil seluruh query.

## Langkah 3 — Periksa hasil

Pada hasil query pertama, lima kolom berikut harus bernilai **0**:

- `expense_category_tenant_mismatch`
- `expense_project_tenant_mismatch`
- `expense_ba_tenant_mismatch`
- `ledger_project_tenant_mismatch`
- `ledger_expense_tenant_mismatch`

Query berikutnya menampilkan:
- jumlah data per status Pengeluaran;
- jumlah baris yang memiliki `paid_amount`;
- default status Pengeluaran;
- definisi constraint status dan pembayaran;
- definisi constraint sumber transaksi Kasir.

Jangan mengubah hasil atau memperbaiki data sendiri. Jika ada angka selain nol, hasil error, atau query gagal, kirimkan apa adanya agar bisa saya analisis.

## Langkah 4 — Kirim hasil kepada saya

Kirim screenshot atau salin hasil dari semua bagian query. Jika SQL Editor menampilkan beberapa tab hasil, kirim semuanya.

## Batas tindakan pada tahap ini

**Jangan jalankan migrasi Stage A dahulu.** Setelah hasil preflight saya tinjau, saya akan memeriksa apakah draft migrasi cocok dengan struktur database aktual dan menentukan langkah uji berikutnya.

Migrasi baru boleh dipertimbangkan setelah:
1. semua hasil preflight ditinjau;
2. definisi constraint dan fungsi lama dicocokkan;
3. risiko kompatibilitas Pengeluaran lama dinyatakan aman;
4. ada rencana pemulihan yang jelas.

Tidak ada perubahan schema atau data yang dilakukan oleh panduan ini.
