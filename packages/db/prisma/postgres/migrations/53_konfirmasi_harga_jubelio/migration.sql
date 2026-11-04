-- Konfirmasi harga Jubelio (keputusan pemilik 2026-11-02): ERP adalah sumber harga, dan harga jual
-- baru sampai ke Jubelio setelah dikonfirmasi DI ERP, di Jubelio -> Konfirmasi harga (izin
-- jubelio_prices:confirm, bawaannya hanya admin, bisa diberikan di Peran & izin). Apa pun dari
-- Jubelio tidak pernah mengubah harga jual barang yang sudah ada.
--
-- Lima kolom Item, semuanya boleh kosong, tanpa indeks, tanpa FOREIGN KEY (relationMode = prisma):
--   jubelioConfirmedPrice / jubelioConfirmedAt / jubelioConfirmedById: harga terakhir yang
--     dikonfirmasi untuk Jubelio, kapan, dan oleh siapa. Setiap kiriman produk ERP -> Jubelio
--     memakai harga ini, tidak pernah sellingPrice mentah; tanpa harga (atau 0) kirimannya dilewati
--     sebagai price_not_confirmed. ById kosong dengan harga terisi = harga tercatat dari Jubelio
--     (isian awal ini, barang yang dibuat impor katalog, atau barang lama yang dipetakan impor).
--   jubelioCreateRequestedAt / jubelioCreateRequestedById: pengajuan membuat barang ERP ini di
--     Jubelio, menunggu harganya dikonfirmasi.
-- Yang menunggu konfirmasi DITURUNKAN, tidak disimpan (apps/web/lib/jubelio/harga): barang jadi
-- yang sudah di Jubelio dengan harga jual berbeda dari harga terkonfirmasi (harga 0 atau kurang =
-- tidak ada harga di kedua sisi), atau barang jadi ERP yang belum di Jubelio dan sedang diajukan.
--
-- Isian awal: barang yang sudah di Jubelio dengan harga > 0 dikonfirmasi pada harga jualnya
-- sekarang, jadi tidak ada yang menunggu di hari pertama dan tidak ada yang mengirim 0. Barang di
-- Jubelio tanpa harga tetap tanpa konfirmasi; barang yang belum di Jubelio tidak diisi. Dijaga
-- kedua kolom konfirmasi masih kosong, jadi aman dijalankan ulang segera. JANGAN dijalankan ulang
-- dengan tangan belakangan: barang ERP yang dipetakan impor sesudahnya membawa harga ketikan yang
-- belum pernah diterima Jubelio, dan harga itu harus lewat konfirmasi.

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioConfirmedPrice" DECIMAL(14,2);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioConfirmedById" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioCreateRequestedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioCreateRequestedById" TEXT;

UPDATE "Item" i
SET "jubelioConfirmedPrice" = i."sellingPrice",
    "jubelioConfirmedAt" = (NOW() AT TIME ZONE 'UTC')
WHERE i."jubelioConfirmedAt" IS NULL
  AND i."jubelioConfirmedPrice" IS NULL
  AND i."sellingPrice" > 0
  AND EXISTS (SELECT 1 FROM "JubelioProductMapping" m WHERE m."itemId" = i."id");
