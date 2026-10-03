-- Menjual lebih banyak, Tahap 3.
--
-- Promo BONUS ("beli X gratis Y"): `bonusBuyQty` setiap kelipatan dibeli,
-- `bonusFreeQty` diberikan gratis — dari barang yang sama, atau `bonusItemId`
-- kalau hadiahnya barang lain. Barang gratis menjadi BARIS pesanan sendiri
-- (`isBonus`, harga 0, `bonusPromoId`), supaya ikut dipesan stoknya, dikirim,
-- dan tercatat keluar — bukan potongan harga yang tak terlihat di gudang.
--
-- `Store.storeClass` (A/B/C): kelas toko untuk jarak kunjungan per kelas.
--
-- `StoreStockTarget`: stok minimum & maksimum per toko per barang/ukuran, untuk
-- toko konsinyasi dan toko ber-SPG. Di bawah minimum → saran isi ulang sampai
-- maksimum. Kunci varian "" untuk barang tanpa varian (sama dengan buku stok toko).
ALTER TYPE "PromoType" ADD VALUE 'BONUS';
ALTER TABLE "Promo" ADD COLUMN "bonusBuyQty" INTEGER;
ALTER TABLE "Promo" ADD COLUMN "bonusFreeQty" INTEGER;
ALTER TABLE "Promo" ADD COLUMN "bonusItemId" TEXT;
ALTER TABLE "FieldSalesOrderLine" ADD COLUMN "isBonus" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FieldSalesOrderLine" ADD COLUMN "bonusPromoId" TEXT;
ALTER TABLE "Store" ADD COLUMN "storeClass" TEXT;

CREATE TABLE "StoreStockTarget" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL DEFAULT '',
    "minQty" INTEGER NOT NULL,
    "maxQty" INTEGER NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreStockTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreStockTarget_storeId_itemId_variantSku_key" ON "StoreStockTarget"("storeId", "itemId", "variantSku");
CREATE INDEX "StoreStockTarget_storeId_idx" ON "StoreStockTarget"("storeId");
