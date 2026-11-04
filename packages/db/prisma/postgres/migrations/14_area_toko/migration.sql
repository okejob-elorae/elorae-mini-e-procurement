-- Area toko (JGU, JTT, …) dan sales penanggung jawab per toko.
--
-- Toko dibagi per sales, dan sales sering dirotasi. Penanggung jawab menempel
-- di master toko — satu orang per toko — supaya rotasi cukup mengubah satu
-- kolom, per toko atau massal per area. Siapa yang MENJUAL tetap tercatat di
-- tiap faktur/pesanan; kolom ini hanya menyatakan siapa yang memegang toko
-- SEKARANG (dan karena itu siapa yang menagih piutangnya).
--
-- Keduanya nullable: toko lama belum punya area maupun penanggung jawab, dan
-- aplikasi memperlakukan "belum diatur" dengan sengaja, bukan sebagai galat.
CREATE TABLE IF NOT EXISTS "StoreGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoreGroup_code_key" ON "StoreGroup"("code");

ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "salesmanId" TEXT;
CREATE INDEX IF NOT EXISTS "Store_groupId_idx" ON "Store"("groupId");
CREATE INDEX IF NOT EXISTS "Store_salesmanId_idx" ON "Store"("salesmanId");
