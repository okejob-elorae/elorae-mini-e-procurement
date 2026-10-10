-- KOL Manager lengkap (2026-10-10). Rancangan: docs/superpowers/specs/2026-10-10-kol-manager-lengkap-design.md
--
-- * KolBrandCollab: riwayat KOL menandai brand (termasuk kompetitor dan Elorae sendiri), satu baris per
--   posting × brand; `kunci` = PLATFORM:postId:brand (isian manual: MANUAL:<id>).
-- * KolCalendarFeed: tautan langganan kalender (iCal) per orang; hanya sha256 tokennya disimpan.
-- * KolCampaign.status (DRAFT/BERJALAN/SELESAI/BATAL) + targetViews. Campaign yang sudah diarsip → SELESAI.
-- * Kol.rateFormat: tarif per format konten (JSON teks).
-- Tanpa foreign key (relationMode = prisma).

CREATE TYPE "KolJenisBrand" AS ENUM ('BERBAYAR', 'KOLABORASI', 'TAG');
CREATE TYPE "KolStatusCampaign" AS ENUM ('DRAFT', 'BERJALAN', 'SELESAI', 'BATAL');

ALTER TABLE "KolCampaign" ADD COLUMN "targetViews" INTEGER,
    ADD COLUMN "status" "KolStatusCampaign" NOT NULL DEFAULT 'BERJALAN';
UPDATE "KolCampaign" SET "status" = 'SELESAI' WHERE "archivedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "KolCampaign_status_idx" ON "KolCampaign"("status");

ALTER TABLE "Kol" ADD COLUMN "rateFormat" TEXT;

CREATE TABLE IF NOT EXISTS "KolBrandCollab" (
    "id" TEXT NOT NULL,
    "kunci" TEXT NOT NULL,
    "kolId" TEXT NOT NULL,
    "accountId" TEXT,
    "platform" "KolPlatform" NOT NULL,
    "brandHandle" TEXT NOT NULL,
    "brandName" TEXT,
    "jenis" "KolJenisBrand" NOT NULL,
    "postId" TEXT,
    "postUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "caption" TEXT,
    "views" INTEGER,
    "sumber" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolBrandCollab_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KolBrandCollab_kunci_key" ON "KolBrandCollab"("kunci");
CREATE INDEX IF NOT EXISTS "KolBrandCollab_kolId_postedAt_idx" ON "KolBrandCollab"("kolId", "postedAt");
CREATE INDEX IF NOT EXISTS "KolBrandCollab_brandHandle_idx" ON "KolBrandCollab"("brandHandle");
CREATE INDEX IF NOT EXISTS "KolBrandCollab_accountId_idx" ON "KolBrandCollab"("accountId");

CREATE TABLE IF NOT EXISTS "KolCalendarFeed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KolCalendarFeed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KolCalendarFeed_tokenHash_key" ON "KolCalendarFeed"("tokenHash");
CREATE INDEX IF NOT EXISTS "KolCalendarFeed_userId_idx" ON "KolCalendarFeed"("userId");
