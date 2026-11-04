-- Batas kredit toko dan penanda kredit pada pesanan lapangan.
--
-- `creditLimit`/`maxOpenInvoices` di toko menimpa batas bawaan dari
-- SystemSetting `salesman.kredit`; kosong = pakai bawaan. Penilaiannya murni di
-- `apps/web/lib/salesman/kredit.ts`.
--
-- `kreditDitahan` dicap saat pesanan dibuat kalau aturan kredit berkata TAHAN:
-- penyetuju harus menyatakan sudah memeriksa tagihannya. `kreditCatatan`
-- menyimpan keadaan tagihan SAAT pesanan dibuat — keadaan hari ini bisa sudah
-- berubah ketika pesanan dibaca.
ALTER TABLE "Store" ADD COLUMN "creditLimit" DECIMAL(15,2);
ALTER TABLE "Store" ADD COLUMN "maxOpenInvoices" INTEGER;
ALTER TABLE "FieldSalesOrder" ADD COLUMN "kreditDitahan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FieldSalesOrder" ADD COLUMN "kreditCatatan" TEXT;
