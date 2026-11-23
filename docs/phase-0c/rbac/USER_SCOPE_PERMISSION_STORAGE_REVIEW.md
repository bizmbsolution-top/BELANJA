# Belanja — Review Desain Penyimpanan Scope & Permission Pengguna

Status: **DRAFT — menunggu persetujuan Owner; belum diterapkan ke Supabase**  
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

## 4. Draft SQL migration — BELUM DIJALANKAN

SQL berikut hanya rancangan untuk ditinjau. Belum ada perubahan pada Supabase.

```sql
create table if not exists public.user_work_scopes (
  user_id uuid not null references auth.users(id) on delete cascade,
  dimension text not null
    check (dimension in ('project', 'department', 'warehouse')),
  scope_mode text not null
    check (scope_mode in ('all', 'selected')),
  resource_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (user_id, dimension),
  constraint user_work_scopes_mode_ids_check check (
    (scope_mode = 'all' and cardinality(resource_ids) = 0)
    or
    (scope_mode = 'selected' and cardinality(resource_ids) > 0)
  )
);

create table if not exists public.user_permission_overrides (
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
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  primary key (user_id, permission_key)
);

alter table public.user_work_scopes enable row level security;
alter table public.user_permission_overrides enable row level security;

revoke all on table public.user_work_scopes
  from anon, authenticated;
revoke all on table public.user_permission_overrides
  from anon, authenticated;

grant select, insert, update, delete on table public.user_work_scopes
  to service_role;
grant select, insert, update, delete on table public.user_permission_overrides
  to service_role;
```

Catatan:
- `ON DELETE CASCADE` membersihkan konfigurasi akses saat akun Auth benar-benar dihapus. Status Nonaktif tetap menggunakan soft-disable pada `user_access_profiles`, bukan penghapusan akun.
- Tidak ada policy `service_role` yang diperlukan karena role tersebut memiliki bypass RLS.
- SQL final perlu disesuaikan bila pemeriksaan ulang menemukan grant default atau kebijakan organisasi tambahan.

## 5. Integrasi aplikasi yang diperlukan setelah migration disetujui

1. Server actions Owner untuk membaca, menyimpan, dan menghapus pilihan Scope.
2. Server actions Owner untuk mengatur `allow/deny` per permission.
3. UI Owner dengan pilihan All / Selected dan daftar resource yang benar-benar tersedia dari tabel master.
4. Adapter data database ke `evaluateScopeAccess()` dan `evaluatePermissionAccess()` di `lib/auth/access-policy.ts`.
5. Pemeriksaan Scope pada query/operasi data server-side. Menyembunyikan menu saja tidak cukup.
6. Pemeriksaan Permission tepat di server action/API yang melakukan posting atau alokasi.
7. Audit perubahan: siapa, kapan, pengguna target, dimensi/permission, nilai sebelum dan sesudah.
8. Uji negatif: pengguna tanpa scope, scope kosong, permission tidak diberikan, explicit deny, dan akses langsung ke API.

## 6. Hal yang belum termasuk

- Belum membuat atau mengubah tabel master Project, Department, Warehouse.
- Belum membuat Role-Permission matrix umum.
- Belum membuat sistem Riwayat Aktivitas lengkap.
- Belum mengubah data pengguna yang sudah ada.
- Belum menerapkan SQL ke Supabase.
- Belum mengubah branch `main` atau deployment production.

## 7. Persetujuan Owner yang diperlukan

Mohon tinjau tiga keputusan berikut sebelum migration dijalankan:

1. Setuju dua tabel terpisah seperti rancangan ini?
2. Setuju scope `All` dan `Selected`, dengan scope yang tidak disetel berarti tidak ada akses?
3. Setuju akses langsung dari browser ke kedua tabel ditutup, dan pengelolaan hanya melalui server action Owner?

Setelah disetujui, migration akan diterapkan ke Supabase, lalu integrasi server actions dan UI dikerjakan di branch preview terlebih dahulu.
