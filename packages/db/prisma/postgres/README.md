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

## Kode aplikasi: sudah diport, satu basis kode untuk dua dialek

Aplikasi kini berjalan di MySQL **maupun** PostgreSQL tanpa flag build — yang
menentukan hanyalah skema di `DATABASE_URL`.

| Berkas | Perubahan |
|---|---|
| `src/adapter.ts` (baru) | `createDbAdapter()` memilih `PrismaPg` atau `PrismaMariaDb` dari skema URL. Satu-satunya tempat adapter dibuat; 12 pemanggil lama diarahkan ke sini. |
| `src/sql-dialect.ts` (baru) | `sqlId()` dan `nowMs()` — lihat di bawah. |
| `src/db-connection.ts` | URL Postgres mendapat `sslmode=require`; knob MySQL (`ssl=true`, `connectTimeout`) tidak lagi bocor ke URL Postgres. |
| `prisma.config.ts` | Memilih pasangan skema + riwayat migrasi berdasarkan `DATABASE_URL`. |
| `apps/web/next.config.ts` | `@prisma/adapter-pg` dan `pg` masuk `serverExternalPackages`. |
| 7 berkas dengan SQL mentah | Diperbaiki, rinciannya di bawah. |

### Kenapa SQL mentah perlu disentuh

Dua beda mekanis antara MySQL dan Postgres:

1. **Postgres melipat identifier tanpa kutip menjadi huruf kecil.** Prisma
   membuat semua tabel/kolom dalam camelCase, jadi `FROM SalesOrder` mencari
   `salesorder` dan gagal dengan `42P01`. Yang lebih licin: alias keluaran.
   `AS salesmanId` tanpa kutip kembali sebagai key `salesmanid`, sehingga kode
   pemanggil menerima `undefined` **tanpa error apa pun**.
2. **`NOW(3)` hanya ada di MySQL.**

`sqlId()` mengutip identifier sesuai dialek aktif dan `nowMs()` memilih
`NOW(3)` / `LOCALTIMESTAMP(3)`. Query tetap satu salinan, tidak dipecah jadi dua
versi yang lama-lama saling menyimpang.

| Berkas | Query | Peran |
|---|---|---|
| `src/reservation-writer.ts` | 3 | Guard atomik stok — reservasi, konsumsi, pengiriman |
| `apps/web/lib/docNumber.ts` | 2 | Penomoran dokumen (PO/GRN/WO/…) |
| `apps/web/lib/dashboard/queries.ts` | 1 | Ringkasan penjualan salesman |
| `apps/web/lib/finance/sales/sweep.ts` | 1 | Sapuan jurnal penjualan |
| `prisma/test-connection.ts` | 2 | Alias backtick MySQL diganti `AS ok` |
| `prisma/seed-production-login.ts` | 4 | **Tetap MySQL-only**, diberi pagar |
| `apps/web/scripts/reset-db-keep-auth.ts` | 4 | **Tetap MySQL-only**, diberi pagar |

Dua skrip terakhir bertumpu pada `SET FOREIGN_KEY_CHECKS`, `DATABASE()`, dan
kutip backtick — tidak ada padanannya di Postgres selain `TRUNCATE ... CASCADE`.
Karena keduanya destruktif dan tidak dibutuhkan aplikasi, keduanya sekarang
**berhenti dengan error jelas** kalau `DATABASE_URL` mengarah ke Postgres.
Truncate yang berhenti separuh jalan di Supabase jauh lebih buruk daripada
skrip yang menolak jalan.

### Bukti uji

Dijalankan sungguhan terhadap PostgreSQL lokal berisi `schema.sql`:

- `prisma generate` memilih `schema.postgres.prisma` sendiri dari `DATABASE_URL`
- Seed penuh tuntas — 2.800 warna Pantone, RBAC, master data, PO/GRN/WO/retur
- `pnpm --filter @elorae/db test` — **66 tes lulus**, termasuk spec
  reservation-writer yang mengeksekusi ketiga query mentah itu
- `pnpm --filter @elorae/web test` — **942 tes lulus**
- `tsc --noEmit` bersih di `packages/db` dan `apps/web`
- Login berhasil, dashboard dan halaman purchase-orders / inventory / items /
  work-orders render 200 tanpa error server
- Penomoran dokumen diuji langsung: `PO/2026/0006` → `PO/2026/0007` berurutan,
  membuktikan `UPDATE` atomiknya jalan di Postgres

### Satu hal yang mudah terlewat

Prisma Client hasil generate **terikat pada satu dialek**. Setiap kali
`DATABASE_URL` berpindah antara MySQL dan Postgres, jalankan ulang:

```bash
pnpm --filter @elorae/db generate
```

Tanpa itu, client lama akan bicara dialek yang salah ke database yang baru.
