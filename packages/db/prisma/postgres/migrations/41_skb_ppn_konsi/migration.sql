-- SKB pemasok + PPN tagihan konsinyasi per toko (2026-10-08).
--
-- * Supplier.skbNumber / skbValidUntil / skbPhotoUrl: Surat Keterangan Bebas
--   pemotongan PPh milik penjahit yang bukan badan usaha. Pembayaran bertanggal
--   (hari WIB) <= skbValidUntil ke pemasok ber-SKB tidak dipotong PPh apa pun;
--   aturannya di apps/web/lib/finance/pajak/pemotongan.ts (tentukanPotongPemasok).
--   Foto SKB disimpan lewat /api/foto (opsional).
-- * Store.consignmentVat: tagihan konsinyasi toko ini memakai PPN. Bawaan FALSE
--   (pemilik: "kalau Elorae mengirim dengan harga PPN maka dicatat dengan PPN,
--   kalau belum ya tidak, dan tergantung tokonya").
-- * ConsignmentCycle.vatApplied: nilai Store.consignmentVat yang DIBEKUKAN saat
--   angka siklus dikunci (seperti promoBorneByElorae), dikosongkan saat kunci
--   dibuka. Jurnal kunci siklus dan tahap faktur pajak membacanya, jadi sakelar
--   toko yang diubah tidak mengubah siklus yang sudah dikunci diam-diam.
--   Siklus yang SUDAH dikunci sebelum migrasi ini diisi TRUE: perilaku lama
--   (tagihan konsinyasi selalu termasuk PPN, faktur pajak wajib) dipertahankan.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "skbNumber" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "skbValidUntil" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "skbPhotoUrl" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "consignmentVat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConsignmentCycle" ADD COLUMN IF NOT EXISTS "vatApplied" BOOLEAN;
UPDATE "ConsignmentCycle" SET "vatApplied" = true WHERE "lockedAt" IS NOT NULL AND "vatApplied" IS NULL;
