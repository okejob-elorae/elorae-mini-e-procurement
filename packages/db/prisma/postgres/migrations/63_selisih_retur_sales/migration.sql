-- Selisih retur toko: cek sales pemegang, hitungan barang susulan, dan potongan dari komisinya
-- (jawaban pemilik 2026-11-02: P22 sales menanyakan ke toko DAN SPG-nya, tidak ketemu → ditanggung
-- sales; P22a barang yang ketemu langsung dikirim balik; P84 toko boleh menanggung (tetap terbuka di
-- nota asal, keputusan 1 2026-10-29) dan perlu pilihan "ditanggung perusahaan"; P85 pemegang SEKARANG
-- yang menanyakan, kantor memilih orangnya saat memutuskan; P86 beban sales = nilai di nota retur;
-- P87 bawaan tercatat: sesudah ada yang dipotong dari penanggungnya, barang yang ketemu tidak dicatat
-- sebagai susulan nota itu). Penulis: apps/web/lib/receivables/return-writer.ts dan
-- apps/web/lib/receivables/potong-beban-retur.ts.
--
-- WarehouseReturn.followUpOfStoreReturnId: hitungan SUSULAN atas barang yang ketemu sesudah
--   selisihnya tercatat. storeReturnId tetap NULL (hitungan asli 1:1 memegang kunci uniknya), jadi
--   susulan tidak pernah yatim. Nilai fisik nota = hitungan asli FINAL + susulan FINAL
--   (`nilaiFisikNota` di apps/web/lib/receivables/deductions.ts).
-- ReturnCharge.checkStatus / checkNote / checkedById / checkedAt: laporan pemegang toko sekarang
--   (DITANYAKAN = belum, DITEMUKAN, TIDAK_DITEMUKAN dengan jawaban toko dan SPG).
-- ReturnCharge.settledAmount: yang sudah dipotong dari komisi penanggung (atau dilunasi), jadi
--   potongan bulanan boleh sebagian. Beban yang sudah diputuskan dan barangnya kembali semua tetap
--   barisnya dengan amount 0 — sengaja TIDAK ada nilai ReturnChargeStatus baru (lihat rollback).
-- ReturnChargeDeduction: satu baris per potongan (positif) atau pengembalian (negatif) per beban;
--   refType 'KomisiSalesman', refId '<sales>:<bulan>:<kunci layar>' (pengembalian berawalan 'kembali:').
--
-- Isian ulang: beban LUNAS dari "Tandai lunas" lama terbaca sudah lunas penuh. Produksi tidak punya
--   baris ReturnCharge (modul ini belum pernah jalan di sana); basis data dev mungkin punya.
--
-- Aman selama image lama berjalan: semua kolom NULL atau berisian bawaan, tabelnya baru, tanpa
-- FOREIGN KEY (relationMode = "prisma"); nama relasi di skema hanya milik Prisma.
--
-- ROLLBACK image web sesudah migrasi ini TIDAK aman begitu saja:
--   (a) image lama membaca beban ditanggung TOKO sebagai sudah dilepas dan mengkredit toko penuh:
--       SELECT COUNT(*) FROM "ReturnCharge" WHERE "bearer" = 'TOKO' AND "status" <> 'TERBUKA';
--   (b) image lama membaca hitungan susulan sebagai hitungan YATIM: daftarnya menawarkan "Jodohkan"
--       dan jodohkanRetur lama hanya memeriksa storeReturnId, jadi barang yang sama bisa dipasangkan
--       ke nota kedua yang belum dihitung dan dikreditkan dua kali. Sebelum rollback ini harus 0 (atau
--       semua susulan dilepas dulu): SELECT COUNT(*) FROM "WarehouseReturn" WHERE "followUpOfStoreReturnId" IS NOT NULL;
-- Aman dijalankan ulang.

DO $$ BEGIN
  CREATE TYPE "ReturnShortfallCheck" AS ENUM ('DITANYAKAN', 'DITEMUKAN', 'TIDAK_DITEMUKAN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "WarehouseReturn" ADD COLUMN IF NOT EXISTS "followUpOfStoreReturnId" TEXT;

CREATE INDEX IF NOT EXISTS "WarehouseReturn_followUpOfStoreReturnId_idx" ON "WarehouseReturn"("followUpOfStoreReturnId");

ALTER TABLE "ReturnCharge" ADD COLUMN IF NOT EXISTS "checkStatus" "ReturnShortfallCheck" NOT NULL DEFAULT 'DITANYAKAN';
ALTER TABLE "ReturnCharge" ADD COLUMN IF NOT EXISTS "checkNote" TEXT;
ALTER TABLE "ReturnCharge" ADD COLUMN IF NOT EXISTS "checkedById" TEXT;
ALTER TABLE "ReturnCharge" ADD COLUMN IF NOT EXISTS "checkedAt" TIMESTAMP(3);
ALTER TABLE "ReturnCharge" ADD COLUMN IF NOT EXISTS "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ReturnChargeDeduction" (
  "id" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "refType" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnChargeDeduction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReturnChargeDeduction_chargeId_idx" ON "ReturnChargeDeduction"("chargeId");
CREATE INDEX IF NOT EXISTS "ReturnChargeDeduction_refType_refId_idx" ON "ReturnChargeDeduction"("refType", "refId");

UPDATE "ReturnCharge" SET "settledAmount" = "amount" WHERE "status" = 'LUNAS' AND "settledAmount" = 0;
