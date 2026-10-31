-- Laporan lapangan (pelunasan/BKM dan nota retur) bisa dikirim dari antrean
-- offline di HP sales.
--
-- Antrean mengirim ulang sampai servernya menjawab. Kalau laporan sebenarnya
-- sudah tersimpan tapi jawabannya hilang di jalan (sinyal putus tepat setelah
-- kirim), kiriman berikutnya akan mencatatnya DUA KALI — dua BKM untuk satu
-- transfer. Kunci ini dibuat HP sekali per laporan; penulis mengembalikan baris
-- yang sudah ada bila kuncinya sudah tercatat. Unik di basis data, bukan hanya
-- di kode: dua kiriman yang tiba bersamaan tetap hanya satu yang menang.
--
-- Nullable: laporan dari kantor dan semua baris lama tidak punya kunci, dan
-- NULL tidak saling bertabrakan di indeks unik.
ALTER TABLE "PaymentClaim" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentClaim_idempotencyKey_key" ON "PaymentClaim"("idempotencyKey");

ALTER TABLE "StoreReturn" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "StoreReturn_idempotencyKey_key" ON "StoreReturn"("idempotencyKey");
