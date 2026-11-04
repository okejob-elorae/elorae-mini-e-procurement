-- SPG: promo paket, member, rincian potongan per promo (2026-10-20).
-- Rancangan: docs/superpowers/specs/2026-10-20-spg-promo-member-pelanggan-design.md
--
-- * CounterPromo.memberOnly: promo konter yang hanya berlaku untuk pembeli member.
-- * CounterPromoTarget.qty: jumlah per komponen promo PAKET (null untuk jenis lain).
-- * Member: member Elorae lintas toko, dikenali dari nomor WhatsApp.
-- * SpgSale.memberId/memberTier/memberDiscount: member, tingkat (dibekukan), potongan member di nota.
-- * SpgSalePromo: rincian potongan per nota × baris × promo — dasar laporan efektivitas promo.
-- Tanpa foreign key (relationMode = prisma).

ALTER TABLE "CounterPromo" ADD COLUMN IF NOT EXISTS "memberOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CounterPromoTarget" ADD COLUMN IF NOT EXISTS "qty" INTEGER;

ALTER TABLE "SpgSale" ADD COLUMN IF NOT EXISTS "memberId" TEXT,
    ADD COLUMN IF NOT EXISTS "memberTier" TEXT,
    ADD COLUMN IF NOT EXISTS "memberDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "SpgSale_memberId_idx" ON "SpgSale"("memberId");

CREATE TABLE IF NOT EXISTS "Member" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedStoreId" TEXT NOT NULL,
    "joinedById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Member_phone_key" ON "Member"("phone");
CREATE INDEX IF NOT EXISTS "Member_joinedStoreId_idx" ON "Member"("joinedStoreId");
CREATE INDEX IF NOT EXISTS "Member_isActive_idx" ON "Member"("isActive");

CREATE TABLE IF NOT EXISTS "SpgSalePromo" (
    "id" TEXT NOT NULL,
    "spgSaleId" TEXT NOT NULL,
    "spgSaleLineId" TEXT,
    "promoId" TEXT,
    "promoName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "discount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "storeDiscount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpgSalePromo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SpgSalePromo_spgSaleId_idx" ON "SpgSalePromo"("spgSaleId");
CREATE INDEX IF NOT EXISTS "SpgSalePromo_promoId_idx" ON "SpgSalePromo"("promoId");
