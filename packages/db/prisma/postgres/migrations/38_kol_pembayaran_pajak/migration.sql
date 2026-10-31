-- Pembayaran KOL per termin + PPh + gross-up + data pajak terenkripsi (2026-10-07).
-- Pemilik: "ada opsi untuk di gross up karena beberapa KOL atau affiliate tidak
-- mau di potong, kemudian bisa connect juga dengan modul finance".
--
-- * Kol: subjek pajak (jenisPajak, alasanTidakDipotong, adaNpwp), gross-up
--   bawaan, dan rekening/NIK/NPWP TERENKRIPSI (AES-256-GCM, kunci server) +
--   empat digit terakhir untuk tampilan tersamar.
-- * KolBrief: modePajak (DIPOTONG/GROSS_UP) dan jurnalOtomatis.
-- * KolPaymentTerm: termin pembayaran (bruto, DPP, PPh, neto per termin).
--   KolBrief.payStatus/paidAmount/paidAt kini DITURUNKAN dari termin.
--
-- Isi awal (tanpa PPh — tarif tidak bisa dihitung dengan SQL; termin yang
-- belum dibayar dihitung ulang oleh aplikasi saat pertama disentuh, ditandai
-- tarifInfo NULL):
--   * setiap kolaborasi ber-fee mendapat satu termin "Pelunasan" pemicu
--     TAYANG + 14 hari (bawaan ambang jatuh tempo);
--   * LUNAS  -> termin itu DIBAYAR (tanggal = paidAt);
--   * SEBAGIAN -> termin "Dibayar sebelumnya" DIBAYAR sebesar paidAmount +
--     "Pelunasan" BELUM sebesar sisanya;
--   * termin dibayar hasil isi awal ber-bayarKe 0 = dibayar di luar buku
--     besar: TIDAK pernah dijurnal.
--   * jurnalOtomatis = false untuk kolaborasi yang uangnya sudah bergerak atau
--     feenya sudah diakui (tayang ke atas) sebelum modul ini — buku besar tidak
--     memposting ulang riwayat yang dicatat di luar buku.
-- Tanpa foreign key (relationMode = prisma).

-- CreateEnum
CREATE TYPE "KolJenisPajak" AS ENUM ('ORANG_PRIBADI', 'BADAN', 'TIDAK_DIPOTONG');

-- CreateEnum
CREATE TYPE "KolModePajak" AS ENUM ('DIPOTONG', 'GROSS_UP');

-- CreateEnum
CREATE TYPE "KolPemicuTermin" AS ENUM ('DEAL', 'TAYANG', 'TANGGAL');

-- CreateEnum
CREATE TYPE "KolStatusTermin" AS ENUM ('BELUM', 'DIBAYAR', 'BATAL');

-- AlterTable
ALTER TABLE "Kol" ADD COLUMN     "jenisPajak" "KolJenisPajak" NOT NULL DEFAULT 'ORANG_PRIBADI',
ADD COLUMN     "alasanTidakDipotong" TEXT,
ADD COLUMN     "adaNpwp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "grossUpBawaan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bankNameEnc" TEXT,
ADD COLUMN     "bankAccountEnc" TEXT,
ADD COLUMN     "bankHolderEnc" TEXT,
ADD COLUMN     "nikEnc" TEXT,
ADD COLUMN     "npwpEnc" TEXT,
ADD COLUMN     "bankLast4" TEXT,
ADD COLUMN     "nikLast4" TEXT,
ADD COLUMN     "dataPajakLengkap" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KolBrief" ADD COLUMN     "modePajak" "KolModePajak" NOT NULL DEFAULT 'DIPOTONG',
ADD COLUMN     "jurnalOtomatis" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KolPaymentTerm" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "urutan" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT NOT NULL,
    "persen" DECIMAL(5,2),
    "neto" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bruto" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "pph" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "dpp" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "jenisPajak" "KolJenisPajak" NOT NULL DEFAULT 'ORANG_PRIBADI',
    "grossUp" BOOLEAN NOT NULL DEFAULT false,
    "tarifInfo" TEXT,
    "pemicu" "KolPemicuTermin" NOT NULL DEFAULT 'TAYANG',
    "hariSesudah" INTEGER NOT NULL DEFAULT 0,
    "jatuhTempo" TIMESTAMP(3),
    "status" "KolStatusTermin" NOT NULL DEFAULT 'BELUM',
    "bayarKe" INTEGER NOT NULL DEFAULT 0,
    "dibayarAt" TIMESTAMP(3),
    "dibayarOlehId" TEXT,
    "buktiTransferUrl" TEXT,
    "nomorBuktiPotong" TEXT,
    "buktiPotongAt" TIMESTAMP(3),
    "setorAt" TIMESTAMP(3),
    "ntpn" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolPaymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KolPaymentTerm_collabId_idx" ON "KolPaymentTerm"("collabId");

-- CreateIndex
CREATE INDEX "KolPaymentTerm_status_idx" ON "KolPaymentTerm"("status");

-- CreateIndex
CREATE INDEX "KolPaymentTerm_dibayarAt_idx" ON "KolPaymentTerm"("dibayarAt");

-- ───────────────────── Isi awal ─────────────────────

-- Kolaborasi yang uangnya sudah bergerak atau feenya sudah diakui sebelum
-- modul ini: riwayatnya di luar buku besar, jangan dijurnal ulang.
UPDATE "KolBrief" SET "jurnalOtomatis" = false
WHERE "fee" > 0
  AND ("tahap" IN ('TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI') OR "payStatus" IN ('SEBAGIAN', 'LUNAS'));

-- Lunas: satu termin dibayar.
INSERT INTO "KolPaymentTerm" ("id", "collabId", "urutan", "label", "persen", "neto", "bruto", "pemicu", "hariSesudah", "jatuhTempo", "status", "bayarKe", "dibayarAt", "catatan", "createdAt", "updatedAt")
SELECT
    'ktm' || substr(md5("id" || '-1'), 1, 22),
    "id",
    1,
    'Pelunasan',
    100,
    "fee",
    "fee",
    'TAYANG',
    14,
    CASE WHEN "liveAt" IS NULL THEN NULL ELSE "liveAt" + INTERVAL '14 days' END,
    'DIBAYAR',
    0,
    COALESCE("paidAt", "updatedAt"),
    'Dibayar sebelum modul pajak — PPh tidak dihitung.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KolBrief"
WHERE "fee" > 0 AND "payStatus" = 'LUNAS';

-- Sebagian: yang sudah dibayar jadi termin tersendiri, sisanya termin Pelunasan.
INSERT INTO "KolPaymentTerm" ("id", "collabId", "urutan", "label", "persen", "neto", "bruto", "pemicu", "hariSesudah", "jatuhTempo", "status", "bayarKe", "dibayarAt", "catatan", "createdAt", "updatedAt")
SELECT
    'ktm' || substr(md5("id" || '-1'), 1, 22),
    "id",
    1,
    'Dibayar sebelumnya',
    NULL,
    LEAST("paidAmount", "fee"),
    LEAST("paidAmount", "fee"),
    'DEAL',
    0,
    NULL,
    'DIBAYAR',
    0,
    COALESCE("paidAt", "updatedAt"),
    'Dibayar sebelum modul pajak — PPh tidak dihitung.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KolBrief"
WHERE "fee" > 0 AND "payStatus" = 'SEBAGIAN' AND "paidAmount" > 0;

INSERT INTO "KolPaymentTerm" ("id", "collabId", "urutan", "label", "persen", "neto", "bruto", "pemicu", "hariSesudah", "jatuhTempo", "status", "bayarKe", "createdAt", "updatedAt")
SELECT
    'ktm' || substr(md5("id" || '-2'), 1, 22),
    "id",
    2,
    'Pelunasan',
    NULL,
    "fee" - LEAST("paidAmount", "fee"),
    "fee" - LEAST("paidAmount", "fee"),
    'TAYANG',
    14,
    CASE WHEN "liveAt" IS NULL THEN NULL ELSE "liveAt" + INTERVAL '14 days' END,
    'BELUM',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KolBrief"
WHERE "fee" > 0 AND "payStatus" = 'SEBAGIAN' AND "paidAmount" > 0 AND "paidAmount" < "fee";

-- Belum dibayar (termasuk fee > 0 yang masih tercatat TIDAK_PERLU, dan
-- SEBAGIAN tanpa jumlah): satu termin Pelunasan.
INSERT INTO "KolPaymentTerm" ("id", "collabId", "urutan", "label", "persen", "neto", "bruto", "pemicu", "hariSesudah", "jatuhTempo", "status", "bayarKe", "createdAt", "updatedAt")
SELECT
    'ktm' || substr(md5("id" || '-1'), 1, 22),
    "id",
    1,
    'Pelunasan',
    100,
    "fee",
    "fee",
    'TAYANG',
    14,
    CASE WHEN "liveAt" IS NULL THEN NULL ELSE "liveAt" + INTERVAL '14 days' END,
    'BELUM',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KolBrief"
WHERE "fee" > 0 AND ("payStatus" IN ('BELUM', 'TIDAK_PERLU') OR ("payStatus" = 'SEBAGIAN' AND "paidAmount" <= 0));

-- payStatus yang basi (fee > 0 tapi TIDAK_PERLU) diselaraskan dengan terminnya.
UPDATE "KolBrief" SET "payStatus" = 'BELUM'
WHERE "fee" > 0 AND "payStatus" = 'TIDAK_PERLU';
