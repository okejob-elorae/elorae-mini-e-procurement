# Penggabungan cabang `timotiusmax` ke `master`

Panduan untuk developer yang melanjutkan penggabungan versi Max ke versi tim. Ikuti
berurutan; jangan lompat ke bagian 3 sebelum bagian 1 dan 2 lolos.

## Status (diperbarui 2026-11-04)

- Cabang `timotiusmax` dimulai dari `master` 82205090 (28 Okt). `master` belum bergerak sejak
  itu, jadi cabang ini berisi seluruh master + fitur versi Max. Tidak ada konflik dengan master.
- 12 fitur dobel sudah diputuskan pemilik; catatannya di `docs/superpowers/specs/` (lokal,
  tidak ikut repo). Halaman lama tim `/backoffice/finance/piutang`, `/payments`, `/pelunasan`
  disembunyikan dari menu, belum dihapus.
- Basis data: **15 migrasi MariaDB baru** dan **8 seed izin baru** (daftar di bawah). Semuanya
  BELUM pernah dijalankan di MariaDB mana pun selain uji bagian 1.
- Sudah dicek: 141 halaman menu terbuka tanpa galat di server lokal (PostgreSQL).
- Belum: uji MariaDB (bagian 1), gladi resik di salinan produksi (bagian 2), merge (bagian 3).

### 15 migrasi baru (`packages/db/prisma/migrations/`)

| Migrasi | Isi |
|---|---|
| `20261031100000_merge_max_features` | 113 tabel baru fitur Max + 31 ALTER tabel lama |
| `20261101140000_store_no_credit_limit` | batas kredit toko boleh kosong |
| `20261102110000_spg_commission_payout` | tabel `SpgSalesCheck` |
| `20261102120000_konsi_old_order_arrival` | kolom kedatangan pesanan konsi + 1 `SystemSetting` |
| `20261102130000_residual_fixes` | data saja: samakan `User.role` dengan `RoleDefinition`; isi `Receivable.salesmanId` lama |
| `20261102140000_jubelio_price_confirmation` | kolom konfirmasi harga Jubelio di `Item` (+ isi data barang) |
| `20261102150000_spg_commission_correction` | tabel `SpgCommissionCorrection` |
| `20261102160000_spg_return_approval` | kolom persetujuan retur pembeli SPG |
| `20261102170000_shipment_gudang_toko` | 10 ALTER pengiriman gudang→toko |
| `20261102190000_supplier_invoice_receipts` | 4 tabel permintaan/koreksi invoice pemasok |
| `20261102200000_konsi_receivables` | aturan CHECK `Receivable` diperbarui; `DROP TABLE ConsignmentPayment` (dibuat migrasi pertama di atas, tidak pernah ada di produksi) |
| `20261102210000_spg_pay_schedule` | 8 tabel gaji SPG |
| `20261102220000_sales_channel` | kolom saluran jual barang |
| `20261102230000_spg_return_refund` | tabel `SpgCharge`, `SpgChargeDeduction` |
| `20261102233000_return_shortfall_salesman` | tabel `ReturnChargeDeduction` |

Tidak ada data produksi yang dihapus. Yang **mengubah data yang sudah ada**: `residual_fixes`
(`User.role`, `Receivable.salesmanId`), `jubelio_price_confirmation` (`Item`), dan isian kolom
baru di `Receivable`, `StoreTransfer`, `KonsiTransfer`, `SpgSaleLine`, `ReturnCharge`.

Risiko utama: aturan `CHECK` baru pada `Receivable` (migrasi pertama dan `konsi_receivables`)
bisa menolak baris produksi lama. MariaDB tidak membatalkan DDL yang sudah jalan, jadi migrasi
yang gagal di tengah meninggalkan keadaan setengah jadi. Itu sebabnya bagian 2 wajib.

### 8 seed izin baru (`packages/db/prisma/seed-*.sql`, dijalankan otomatis oleh deploy, sekali)

`seed-consignment-permissions.sql`, `seed-creative-permissions.sql`,
`seed-max-features-permissions.sql`, `seed-office-roles-permissions.sql`,
`seed-owner-2026-11-02-permissions.sql`, `seed-owner-2026-11-02b-permissions.sql`,
`seed-production-palette-permissions.sql`, `seed-receivables-permissions.sql`.

## 1. Uji di MariaDB kosong (GitHub Actions) — sudah dijalankan

`.github/workflows/ci.yml` di cabang ini sementara juga berjalan saat `timotiusmax` di-push
(baris bertanda SEMENTARA). Job `DB specs on a fresh MariaDB` menerapkan semua migrasi lewat
klien `mariadb`, sama seperti deploy, lalu seed dan menjalankan semua spec; job `Type-check,
lint, api unit tests` memeriksa tipe web dan api.

Hasil: https://github.com/okejob-elorae/elorae-mini-e-procurement/actions?query=branch%3Atimotiusmax

Semua job harus hijau sebelum lanjut ke bagian 2. Kalau merah, perbaiki di cabang ini dan push
lagi; jangan lanjut.

## 2. Gladi resik di salinan basis data produksi (di VPS)

Tujuannya menjalankan ke-15 migrasi dan 8 seed persis seperti deploy, tetapi ke basis data
**salinan** `elorae_uji` yang dipulihkan dari cadangan semalam, bukan ke `elorae`. Sekaligus ini
uji pemulihan cadangan pertama (README §Database backups → Restore).

Kerjakan di jam sepi: memulihkan dump membebani server DB yang sama. Cek ruang disk dulu
(`df -h`). Dump yang sudah didekripsi berisi data pelanggan — kerjakan di direktori sementara,
jangan di `/srv/elorae`, dan hapus sesudahnya.

```bash
ssh elorae@api.elorae.cloud
set -euo pipefail
DB='docker compose -f /srv/elorae/docker-compose.prod.yml exec -T db sh -c'

# 2a. Pulihkan cadangan terbaru ke elorae_uji (langkah README §Restore, nama DB diganti).
set -a; . ~/.elorae-backup/env; set +a
umask 077
WORK=$(mktemp -d); cd "$WORK"
aws s3 ls "s3://$R2_BACKUP_BUCKET/daily/" \
  --endpoint-url "${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}" | tail -3
aws s3 cp "s3://$R2_BACKUP_BUCKET/daily/<file-terbaru>" . \
  --endpoint-url "${R2_ENDPOINT:-https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com}"
gpg --batch --decrypt --passphrase-file ~/.elorae-backup/passphrase <file-terbaru> | gunzip > restore.sql
tail -c 200 restore.sql        # wajib ada "Dump completed on"
$DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root -e "CREATE DATABASE elorae_uji"'
$DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root elorae_uji' < restore.sql

# 2b. Ambil SQL dari cabang timotiusmax tanpa mengubah working tree /srv/elorae.
git -C /srv/elorae fetch origin timotiusmax
mkdir sql && git -C /srv/elorae archive origin/timotiusmax packages/db/prisma | tar -x -C sql
P="$WORK/sql/packages/db/prisma"

# Hitungan pembanding sebelum migrasi.
Q='SELECT (SELECT COUNT(*) FROM `User`), (SELECT COUNT(*) FROM `Item`), (SELECT COUNT(*) FROM `SalesOrder`), (SELECT COUNT(*) FROM `Receivable`)'
$DB "MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb --skip-ssl -u root -N -B elorae_uji -e '$Q'"

# 2c. Migrasi — loop yang sama dengan deploy.yml (job migrate), DB = elorae_uji.
APPLIED=$($DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root -N -B elorae_uji -e "SELECT migration_name FROM _prisma_migrations"')
cd "$P/migrations"
for m in $(ls -d */ | sort); do
  NAME=$(basename "$m")
  if ! grep -qx "$NAME" <<< "$APPLIED"; then
    echo ">>> Applying $NAME"
    $DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root elorae_uji' < "${m}migration.sql"
    CHECKSUM=$(sha256sum "${m}migration.sql" | cut -d' ' -f1); UUID=$(cat /proc/sys/kernel/random/uuid)
    $DB "MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb --skip-ssl -u root elorae_uji -e \"INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('$UUID', '$CHECKSUM', NOW(3), '$NAME', NOW(3), 1);\""
  fi
done

# 2d. Seed izin — loop yang sama dengan deploy.yml, DB = elorae_uji.
SEEDED=$($DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root -N -B elorae_uji -e "SELECT name FROM _seed_runs"')
cd "$P"
for s in $(ls seed-*.sql 2>/dev/null | sort); do
  if ! grep -qx "$s" <<< "$SEEDED"; then
    echo ">>> Seeding $s"
    $DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root elorae_uji' < "$s"
    CHECKSUM=$(sha256sum "$s" | cut -d' ' -f1)
    $DB "MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb --skip-ssl -u root elorae_uji -e \"INSERT INTO _seed_runs (name, checksum) VALUES ('$s', '$CHECKSUM');\""
  fi
done

# 2e. Periksa: hitungan pembanding harus sama dengan sebelum migrasi.
$DB "MYSQL_PWD=\"\$MARIADB_ROOT_PASSWORD\" mariadb --skip-ssl -u root -N -B elorae_uji -e '$Q'"

# 2f. Bersihkan.
$DB 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --skip-ssl -u root -e "DROP DATABASE elorae_uji"'
cd / && rm -rf "$WORK"
```

Yang diharapkan: tepat 15 baris `>>> Applying` (nama sama dengan tabel di atas) dan 8 baris
`>>> Seeding`, tanpa galat, dan hitungan pembanding tidak berubah. Kalau tabel `_seed_runs`
belum ada di salinan, buat dulu dengan blok `CREATE TABLE IF NOT EXISTS _seed_runs` dari
`deploy.yml` (DB = `elorae_uji`).

Kalau ada migrasi yang gagal: catat nama migrasi dan pesan galatnya, hapus `elorae_uji`
(langkah 2f), dan kabari. Perbaikannya di cabang ini, lalu ulangi bagian 1 dan 2 dari awal
dengan salinan baru — salinan yang sudah setengah termigrasi tidak bisa dipakai ulang.

## 3. Merge ke master

1. Hapus baris SEMENTARA `timotiusmax` di `.github/workflows/ci.yml`.
2. Buka pull request `timotiusmax` → `master`. CI berjalan lagi di PR; tunggu hijau.
3. Pastikan cadangan malam sebelumnya ada (README §Database backups; `~/backup.log` di VPS).
4. Merge di jam sepi. Deploy berjalan sendiri: build image → `migrate` (15 migrasi + 8 seed
   di `elorae`) → deploy api → deploy web. Pantau Actions; pastikan job `Deploy api` dan
   `Deploy web` benar-benar jalan, bukan skipped (README: run hijau belum bukti).
5. Sesudah deploy: buka beberapa halaman utama (Beranda, Pesanan marketplace, Inventori,
   Piutang, Komisi SPG); cek `SELECT COUNT(*) FROM _prisma_migrations` bertambah 15.
6. Kalau program bermasalah: pasang image lama lewat Actions → Deploy to VPS → Run workflow
   dengan `image_tag` = `82205090` (master sebelum merge). Skema baru hanya menambah tabel dan
   kolom, jadi image lama tetap bisa jalan di atasnya. Kalau DATA yang bermasalah: pulihkan
   cadangan ke DB terpisah dulu dan bandingkan — jangan memulihkan langsung di atas `elorae`.

## Sesudah merge

Sisa pekerjaan (kelompok 1: verifikasi pembayaran sebagian, rekap komisi salesman dengan
potongan, persetujuan gaji SPG, pengingat stok minimum, foto ke R2, hapus `kirimTitipan`,
dan penerapan jawaban pemilik P90–P110) dikerjakan sebagai PR kecil langsung di `master`.
Penghapusan halaman lama tim menunggu kueri bukti data produksi.
