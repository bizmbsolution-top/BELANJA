# Belanja — Review Desain Penyimpanan Scope & Permission Pengguna

Status: **MIGRATION SUDAH DITERAPKAN DAN DIVERIFIKASI — integrasi Owner Scope/Permission sedang dikerjakan di preview**  
Target implementasi: branch `ui-user-access-preview`  
Supabase project: `zguzjoqmghmmviyixecz`

## 1. Kondisi database saat diperiksa

Pemeriksaan read-only pada 23 November 2026:

- Tabel terkait akses yang ditemukan: `public.user_access_profiles`.
- Kolom yang sudah ada: `user_id`, `roles`, `is_active`, `created_at`, `created_by`, `updated_at`, `updated_by`.
- RLS pada `user_access_profiles` aktif.
- Tidak ditemukan policy RLS pada tabel tersebut.
- Hak tabel eksplisit yang terlihat hanya untuk `postgres` dan `service_role`; tidak ada grant untuk `anon` atau `authenticated`.
- Migration yang tercatat: `20261120120010_create_user_access_profiles`.
- Belum ditemukan tabel master Project, Department, atau Warehouse pada schema `public`.

Aksi pengelolaan akun yang ada saat ini menggunakan `requireOwner()` lalu `createAdminClient()`. Desain baru mengikuti pola tersebut: pemeriksaan Owner di server action, lalu operasi database menggunakan admin client server-side. Secret/service key tidak boleh masuk ke browser.

## 2. Keputusan desain yang diusulkan

Gunakan dua tabel baru. Tidak mengubah atau mengganti `user_access_profiles`.

### A. `public.user_work_scopes`

Satu baris untuk setiap kombinasi pengguna dan dimensi scope.

| Kolom | Fungsi |
|---|---|
| `user_id` | Pengguna yang diberi scope; FK ke `auth.users(id)` |
| `dimension` | `project`, `department`, atau `warehouse` |
| `scope_mode` | `all` atau `selected` |
| `resource_ids` | Daftar ID resource yang dipilih; kosong jika `all` |
| `created_at/by`, `updated_at/by` | Jejak waktu dan pengguna yang membuat/mengubah |

Aturan:
- Maksimal satu baris per pengguna per dimensi.
- `all` berarti seluruh data pada dimensi itu, termasuk resource baru di masa depan.
- `selected` berarti hanya ID yang tercantum.
- `selected` dengan daftar kosong ditolak oleh constraint.
- Tidak adanya baris scope berarti **tidak ada akses** untuk dimensi itu (fail-closed).
- `resource_ids` menggunakan `text[]` sementara karena tabel master resource belum tersedia. Foreign key ke master Project/Department/Warehouse belum dapat dibuat dengan aman sebelum struktur tabel master dan tipe ID-nya dipastikan.

### B. `public.user_permission_overrides`

Satu baris untuk setiap permission individual milik pengguna.

| Kolom | Fungsi |
|---|---|
| `user_id` | Pengguna penerima permission; FK ke `auth.users(id)` |
| `permission_key` | Kode permission yang diatur |
| `effect` | `allow` atau `deny` |
| `created_at/by`, `updated_at/by` | Jejak waktu dan pengguna yang membuat/mengubah |

Permission sensitif yang diizinkan pada tahap awal:
- `transaction.post_recognition`
- `fund_utilization.post_recognition`
- `payment.post`
- `payment.allocate`

Aturan:
- Kombinasi `user_id + permission_key` unik.
- Permission sensitif hanya diberikan melalui override individual, bukan Role.
- `deny` individual mengalahkan grant dari Role.
- Tidak adanya baris override berarti tidak ada grant individual.
- Menghapus override bukan berarti menghapus catatan aktivitas; audit perubahan tetap perlu dicatat oleh mekanisme aktivitas yang akan dirancang terpisah.

## 3. Rancangan keamanan RLS dan akses

Kedua tabel baru:
- RLS wajib aktif.
- Tidak membuat policy untuk `anon` atau `authenticated`.
- Tidak memberi grant tabel kepada `anon` atau `authenticated`.
- Grant DML hanya kepada `service_role` (selain owner database).
- Semua baca/tulis melalui server action yang memanggil `requireOwner()` dan `createAdminClient()`.
- Validasi ulang user ID, dimensi, mode, daftar resource, permission key, dan effect di server action. Jangan percaya payload browser.
- `service_role` melewati RLS, sehingga pemeriksaan Owner di server action tetap wajib dan tidak boleh dilewati.

Dengan desain ini, pengguna biasa tidak dapat membaca atau mengubah tabel otorisasi langsung melalui Supabase Data API. RLS menjadi lapisan perlindungan tambahan, bukan pengganti otorisasi server.

## 4. Migration Supabase — SUDAH DITERAPKAN

Owner menyetujui ketiga keputusan pada 23 November 2026. Migration `20261123022117_create_user_work_scopes_and_permission_overrides` berhasil diterapkan pada project Supabase `zguzjoqmghmmviyixecz`.

SQL aktual yang diterapkan:

```sql
create table public.user_work_scopes (
  user_id uuid not null references auth.users(id) on delete cascade,
  dimension text not null
    check (dimension in ('project', 'department', 'warehouse')),
  scope_mode text not null
    check (scope_mode in ('all', 'selected')),
  resource_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, dimension),
  constraint user_work_scopes_mode_ids_check check (
    (scope_mode = 'all' and cardinality(resource_ids) = 0)
    or
    (scope_mode = 'selected' and cardinality(resource_ids) > 0
      and array_position(resource_ids, null) is null
      and array_position(resource_ids, '') is null)
  )
);

create table public.user_permission_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null check (
    permission_key in (
      'transaction.post_recognition',
      'fund_utilization.post_recognition',
      'payment.post',
      'payment.allocate'
    )
  ),
  effect text not null check (effect in ('allow', 'deny')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, permission_key)
);

alter table public.user_work_scopes enable row level security;
alter table public.user_permission_overrides enable row level security;

revoke all on table public.user_work_scopes
  from public, anon, authenticated;
revoke all on table public.user_permission_overrides
  from public, anon, authenticated;

grant select, insert, update, delete on table public.user_work_scopes
  to service_role;
grant select, insert, update, delete on table public.user_permission_overrides
  to service_role;
```

Catatan:
- `user_id` menggunakan `ON DELETE CASCADE`; penghapusan akun Auth membersihkan konfigurasi aksesnya. Kolom audit `created_by` dan `updated_by` nullable dengan `ON DELETE SET NULL` agar penghapusan akun pembuat tidak menghalangi proses.
- Hak akses tabel untuk `public`, `anon`, dan `authenticated` dicabut; DML hanya diberikan kepada `service_role`. Tidak ada policy `service_role` karena role tersebut melewati RLS.
- Verifikasi pascamigration: kedua tabel memiliki RLS aktif, tidak memiliki policy, tidak memberi hak SELECT kepada `anon`/`authenticated`, dan memberi hak DML kepada `service_role`.
- Advisor masih menampilkan temuan INFO `RLS Enabled No Policy` pada tabel baru (sesuai desain tertutup ini) serta satu temuan lama pada `user_access_profiles`. Advisor juga melaporkan fungsi `public.rls_auto_enable()` sebagai SECURITY DEFINER yang dapat dipanggil `anon` dan `authenticated`; temuan ini sudah ada di luar migration ini dan perlu ditinjau terpisah.

## 5. Status integrasi aplikasi

Sudah dikerjakan pada branch preview:
- Server actions Owner membaca dan menyimpan Scope serta Permission melalui admin client server-side.
- UI Owner menyimpan Scope `All` / tanpa akses per dimensi.
- UI Owner mengatur Permission individual `allow` / `deny` / belum diatur.
- Adapter `normalizeStoredScopeAssignment()` mengubah bentuk row database menjadi bentuk yang dipakai policy, dan menolak data malformed.
- Pilihan Scope `Selected` ditampilkan nonaktif sampai tabel master tersedia; row Selected yang sudah ada tidak akan dihapus saat form disimpan.

Belum dikerjakan:
- Pemeriksaan Scope pada query/operasi data server-side. Menyembunyikan menu saja tidak cukup.
- Pemeriksaan Permission tepat di server action/API yang melakukan posting atau alokasi.
- Audit riwayat perubahan sebelum/sesudah; kolom created/updated saat ini hanya menyimpan metadata terakhir, bukan histori lengkap.
- Uji negatif end-to-end untuk pengguna tanpa Scope, explicit deny, dan akses langsung ke API.
## 6. Hal yang belum termasuk

- Belum membuat atau mengubah tabel master Project, Department, Warehouse.
- Belum membuat Role-Permission matrix umum.
- Belum membuat sistem Riwayat Aktivitas lengkap.
- Belum mengubah data pengguna yang sudah ada.
- Belum mengubah branch `main` atau deployment production.

## 7. Persetujuan Owner

Disetujui pada 23 November 2026:

1. Dua tabel terpisah.
2. Scope `All` dan `Selected`; scope yang tidak disetel berarti tidak ada akses.
3. Akses langsung dari browser ditutup; pengelolaan melalui server action Owner.

Scope `All` dan Permission individual kini dapat diatur melalui UI Owner di branch `ui-user-access-preview`. Pilihan `Selected` tetap nonaktif sampai master Project/Department/Warehouse tersedia. Pemeriksaan Scope/Permission pada setiap operasi data masih menjadi tahap implementasi terpisah.
