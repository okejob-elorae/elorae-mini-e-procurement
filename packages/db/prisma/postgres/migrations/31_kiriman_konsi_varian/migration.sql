-- Varian pada baris kiriman titipan konsinyasi (2026-10-05).
--
-- Toko konsinyasi kini diperlakukan sebagai gudang lain: kiriman memotong stok
-- gudang utama per (barang, varian). Stok gudang barang bervarian disimpan per
-- varian, jadi baris kiriman perlu tahu variannya — tanpa itu barang bervarian
-- tidak bisa dipotong dari baris yang benar. Kosong = barang tanpa varian atau
-- kiriman lama (sebelum kolom ini ada).
ALTER TABLE "ConsignmentShipmentItem" ADD COLUMN "variantSku" TEXT;
