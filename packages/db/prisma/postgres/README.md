# Elorae — skema database PostgreSQL (Supabase)

Isi folder ini adalah hasil konversi skema Prisma MySQL/MariaDB milik repo ini ke
PostgreSQL, untuk dipakai di Supabase.

| File | Isi |
|---|---|
| `schema.sql` | DDL lengkap: 46 enum, 102 tabel, 296 index. Jalankan sekali di database kosong. |
| `migrations/0_init/migration.sql` | Isi identik `schema.sql`, dibungkus sebagai baseline migration Prisma. |
| `migrations/migration_lock.toml` | Penanda provider `postgresql` untuk Prisma Migrate. |
| `supabase-lockdown.sql` | **Wajib dijalankan setelah `schema.sql`.** Menutup 102 tabel dari REST API Supabase. |
| `../schema.postgres.prisma` | Skema Prisma versi PostgreSQL — sumber kebenaran dari mana `schema.sql` dibuat. |

Sudah diuji: `schema.sql` dieksekusi utuh di PostgreSQL 18.4 asli, hasilnya
102 tabel, 46 tipe enum, 397 index (296 index eksplisit + 101 index primary key).
DDL-nya tidak memakai fitur khusus versi, jadi aman di PostgreSQL 15/17 yang
dipakai Supabase.

## Cara pakai di Supabase

**Opsi A — SQL Editor (paling cepat)**

1. Buka project Supabase → SQL Editor → New query.
2. Paste seluruh isi `schema.sql`, Run.
3. Cek di Table Editor: harus muncul 102 tabel di schema `public`.
4. **Jalankan `supabase-lockdown.sql`** di query baru (lihat bagian Keamanan).

**Opsi B — psql**

```bash
psql "postgresql://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres" -f schema.sql
```

**Opsi C — Prisma Migrate** (kalau mau riwayat migrasi jalan dari sini)

```bash
# DATABASE_URL menunjuk ke Supabase
pnpm --filter @elorae/db exec prisma migrate deploy \
  --schema prisma/schema.postgres.prisma
```

Pakai **connection string mode Session (port 5432)** untuk migrasi/DDL. Untuk
runtime di Vercel (serverless), pakai **Transaction pooler port 6543** dan
tambahkan `?pgbouncer=true&connection_limit=1`.

## Cara regenerasi

Kalau `prisma/schema.prisma` (versi MySQL) berubah, buat ulang versi Postgres-nya:

```bash
cd packages/db
sed -e 's/provider     = "mysql"/provider     = "postgresql"/' \
    -e 's/@db\.MediumText/@db.Text/g' \
    prisma/schema.prisma > prisma/schema.postgres.prisma
sed -i '' -e 's/onDelete: NoAction/onDelete: Restrict/g' \
          -e 's/onUpdate: NoAction/onUpdate: Restrict/g' prisma/schema.postgres.prisma
pnpm exec prisma migrate diff --from-empty \
  --to-schema prisma/schema.postgres.prisma --script -o prisma/postgres/schema.sql
```

## Keamanan — jangan lewatkan `supabase-lockdown.sql`

Supabase menerbitkan **setiap tabel di schema `public` sebagai REST API**
(PostgREST) secara otomatis. `schema.sql` membuat 102 tabel tanpa Row Level
Security, artinya begitu skema diterapkan, siapa pun yang memegang **anon key**
— dan anon key memang dirancang untuk ditempel di browser, jadi anggap saja
publik — bisa membaca dan menulis seluruh data ERP lewat HTTPS: harga, supplier,
pesanan, jurnal keuangan, akun user.

`supabase-lockdown.sql` menutup itu: menyalakan RLS di semua tabel tanpa
membuat satu pun policy (RLS aktif tanpa policy = tolak semua), lalu mencabut
GRANT yang Supabase berikan ke role `anon` dan `authenticated`.

Diuji di PostgreSQL asli dengan role `anon`/`authenticated` tiruan Supabase:

| | sebelum | sesudah |
|---|---|---|
| Tabel tanpa RLS | 102 | 0 |
| Hak akses tabel untuk `anon` | 714 | 0 |
| `anon` membaca tabel `User` | bisa | ditolak — `permission denied` |
| Prisma (role `postgres`) tulis + baca | bisa | **tetap bisa** |

Aplikasi tidak terganggu karena Elorae tidak memakai PostgREST sama sekali —
ia connect langsung ke Postgres lewat Prisma sebagai role `postgres`, pemilik
tabel, yang otomatis melewati RLS.

> Catatan: kalau suatu saat Prisma disambungkan memakai role selain `postgres`
> (atau tabelnya di-`FORCE ROW LEVEL SECURITY`), RLS akan ikut memblokir
> aplikasi. Tetap pakai role `postgres` di `DATABASE_URL`.

Anon key **tidak dipakai di mana pun** dalam kode ini — tidak ada `supabase-js`.
Yang dibutuhkan aplikasi hanyalah connection string Postgres biasa.

## Perbedaan terhadap skema MySQL

Tiga hal saja yang diubah — sisanya identik:

1. `datasource.provider`: `mysql` → `postgresql`.
2. `@db.MediumText` (2 kolom) → `@db.Text`. Tipe MySQL-only; di Postgres `TEXT`
   tidak berbatas panjang jadi tidak ada data yang hilang. Sisa native type
   (`@db.Text`, `@db.VarChar`, `@db.Decimal`) valid apa adanya di Postgres.
3. `onDelete/onUpdate: NoAction` (63 relasi) → `Restrict`. Prisma menolak
   `NoAction` di Postgres saat `relationMode = "prisma"`.
   **Tidak mengubah `schema.sql` sama sekali** — karena `relationMode = "prisma"`
   tidak menerbitkan foreign key, aksi referensial tidak pernah masuk DDL.
   Yang berubah hanya perilaku Prisma Client saat runtime: menghapus baris induk
   yang masih punya anak akan **ditolak** (`Restrict`), sedangkan di MySQL
   sekarang dibiarkan lewat (`NoAction`). Kalau ada alur delete di ERP yang
   mengandalkan perilaku lama, ganti relasi terkait ke `NoAction` di skema MySQL
   ATAU sesuaikan kode penghapusannya.

Catatan: `relationMode = "prisma"` sengaja dipertahankan agar sama persis dengan
produksi — **tidak ada foreign key constraint** di database, integritas relasi
dijaga di layer Prisma. Efek sampingnya: impor data ke Supabase tidak peduli
urutan tabel. Kalau nanti ingin FK asli ditegakkan Postgres, hapus baris
`relationMode` di `schema.postgres.prisma` lalu regenerasi — DDL-nya akan ikut
membawa `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`.

## Yang MASIH kurang agar aplikasi benar-benar jalan di Supabase

`schema.sql` hanya membangun databasenya. Kode aplikasi masih bicara MariaDB:

1. **Adapter Prisma** — `packages/db/src/index.ts` dan `prisma/seed.ts` memakai
   `PrismaMariaDb` dari `@prisma/adapter-mariadb`. Perlu diganti ke
   `@prisma/adapter-pg` (`PrismaPg`), dan dependensinya ditukar di
   `packages/db/package.json`.
2. **`prisma/schema.prisma`** — generator client masih provider `mysql`. Client
   yang dipakai aplikasi harus di-generate dari skema Postgres.
3. **3 query SQL mentah** di `packages/db/src/reservation-writer.ts`
   (baris ~282, ~315, ~470). Dua masalah: identifier tanpa kutip
   (`UPDATE StockReservation` → Postgres melipat ke huruf kecil, tabelnya
   bernama `"StockReservation"`), dan `NOW(3)` yang bukan sintaks Postgres
   (padanannya `CURRENT_TIMESTAMP(3)`).
4. **`packages/db/src/db-connection.ts`** — normalisasi URL-nya khusus MySQL
   (`mysql://`, `ssl=true`, `connectTimeout`). Untuk Supabase perlu
   `postgresql://` + parameter pooler.

Selama keempat hal itu belum dikerjakan, `schema.sql` tetap sah dipakai untuk
menyiapkan database Supabase-nya, tapi aplikasinya belum bisa connect ke sana.
