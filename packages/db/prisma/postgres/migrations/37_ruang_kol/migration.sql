-- Ruang KOL (2026-10-07), meniru alur program KOL Manager: setiap kerja sama
-- dengan seorang KOL (tabel KolBrief, di layar disebut "Kolaborasi") berjalan
-- lewat 13 tahap + 3 jalur keluar (KolTahap), menggantikan 7 status brief lama.
-- Campaign jadi baris sendiri (KolCampaign), sampel dikirim per pengiriman
-- (KolShipment + baris), konten KOL beserta angkanya (KolContent +
-- KolContentMetric, angka TIDAK PERNAH ditimpa: setiap pengisian baris baru),
-- penjualan afiliasi (KolSale), catatan manual (KolNote), agenda (KolAgenda),
-- dan riwayat pengikut (KolFollowerSnapshot). Item.kgPerRoll untuk rincian
-- roll di PO bahan. Tanpa foreign key (relationMode = prisma).
--
-- Migrasi data (di bawah, sesudah semua tabel ada, sebelum kolom lama dibuang):
--   * status lama -> tahap: DRAFT->DEAL, DIKIRIM->SAMPEL_DIKIRIM,
--     DISETUJUI->DRAF_DISETUJUI, KONTEN_DITERIMA->DRAF, TAYANG, SELESAI, BATAL
--     tetap; dealAt = createdAt; tahapAt = updatedAt (perubahan terakhir).
--   * payStatus = BELUM bila fee > 0, selain itu TIDAK_PERLU.
--   * teks campaign yang unik -> satu baris KolCampaign, brief ditautkan.
--   * brief lama yang stoknya sudah keluar (stockIssuedAt) -> satu
--     KolShipment + barisnya dari KolBriefItem (unitCost 0). TANPA gerakan
--     stok: stoknya sudah keluar dulu, saat brief dikirim.

-- CreateEnum
CREATE TYPE "KolTahap" AS ENUM ('PROSPEK', 'DIHUBUNGI', 'NEGO', 'DEAL', 'BRIEF_DIKIRIM', 'SAMPEL_DIKIRIM', 'SAMPEL_DITERIMA', 'DRAF', 'DRAF_DISETUJUI', 'TAYANG', 'ANGKA_MASUK', 'DIBAYAR', 'SELESAI', 'DITOLAK', 'GHOSTING', 'BATAL');

-- CreateEnum
CREATE TYPE "KolJenisKerjaSama" AS ENUM ('BARTER', 'BAYAR', 'CAMPURAN', 'KOMISI');

-- CreateEnum
CREATE TYPE "KolStatusBayar" AS ENUM ('TIDAK_PERLU', 'BELUM', 'SEBAGIAN', 'LUNAS');

-- CreateEnum
CREATE TYPE "KolStatusDraf" AS ENUM ('MENUNGGU', 'REVISI', 'DISETUJUI');

-- CreateEnum
CREATE TYPE "KolJenisAgenda" AS ENUM ('TUGAS', 'MEETING', 'DEADLINE', 'KIRIM', 'KONTEN', 'BAYAR', 'LAINNYA');

-- AlterEnum
ALTER TYPE "KolPlatform" ADD VALUE 'SHOPEE';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "kgPerRoll" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Kol" ADD COLUMN     "address" TEXT,
ADD COLUMN     "avgViews" INTEGER,
ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "engagementRate" DECIMAL(6,2),
ADD COLUMN     "label" TEXT,
ADD COLUMN     "lastContactAt" TIMESTAMP(3),
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "sizeProfile" TEXT,
ADD COLUMN     "waNormal" TEXT;

-- AlterTable
ALTER TABLE "KolAccount" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "KolBrief" ADD COLUMN     "boostCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "commissionPct" DECIMAL(5,2),
ADD COLUMN     "dealAt" TIMESTAMP(3),
ADD COLUMN     "jenis" "KolJenisKerjaSama" NOT NULL DEFAULT 'BARTER',
ADD COLUMN     "lastContactAt" TIMESTAMP(3),
ADD COLUMN     "outreachAt" TIMESTAMP(3),
ADD COLUMN     "paidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "payNote" TEXT,
ADD COLUMN     "payStatus" "KolStatusBayar" NOT NULL DEFAULT 'TIDAK_PERLU',
ADD COLUMN     "picId" TEXT,
ADD COLUMN     "plannedLiveAt" TIMESTAMP(3),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "tahap" "KolTahap" NOT NULL DEFAULT 'PROSPEK',
ADD COLUMN     "tahapAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "KolFollowerSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "KolFollowerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "product" TEXT,
    "objective" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DECIMAL(15,2),
    "targetKol" INTEGER,
    "targetContent" INTEGER,
    "brief" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolShipment" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "courier" TEXT,
    "trackingNo" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "shippingCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "stockIssuedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "variantSku" TEXT,
    "qty" INTEGER NOT NULL,
    "unitCost" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "KolShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolContent" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "platform" "KolPlatform" NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "link" TEXT,
    "liveAt" TIMESTAMP(3),
    "plannedAt" TIMESTAMP(3),
    "draftLink" TEXT,
    "draftStatus" "KolStatusDraf",
    "draftNote" TEXT,
    "draftAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "adCode" TEXT,
    "adCodeUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolContentMetric" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "note" TEXT,
    "createdById" TEXT,

    CONSTRAINT "KolContentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolSale" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "gmv" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "source" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KolSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolNote" (
    "id" TEXT NOT NULL,
    "kolId" TEXT,
    "collabId" TEXT,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KolNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KolAgenda" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT,
    "kind" "KolJenisAgenda" NOT NULL DEFAULT 'TUGAS',
    "checklist" TEXT,
    "note" TEXT,
    "campaignId" TEXT,
    "kolId" TEXT,
    "collabId" TEXT,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolAgenda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KolFollowerSnapshot_accountId_idx" ON "KolFollowerSnapshot"("accountId");

-- CreateIndex
CREATE INDEX "KolFollowerSnapshot_recordedAt_idx" ON "KolFollowerSnapshot"("recordedAt");

-- CreateIndex
CREATE INDEX "KolCampaign_archivedAt_idx" ON "KolCampaign"("archivedAt");

-- CreateIndex
CREATE INDEX "KolCampaign_name_idx" ON "KolCampaign"("name");

-- CreateIndex
CREATE INDEX "KolCampaign_createdById_idx" ON "KolCampaign"("createdById");

-- CreateIndex
CREATE INDEX "KolShipment_collabId_idx" ON "KolShipment"("collabId");

-- CreateIndex
CREATE INDEX "KolShipment_trackingNo_idx" ON "KolShipment"("trackingNo");

-- CreateIndex
CREATE INDEX "KolShipmentLine_shipmentId_idx" ON "KolShipmentLine"("shipmentId");

-- CreateIndex
CREATE INDEX "KolShipmentLine_itemId_idx" ON "KolShipmentLine"("itemId");

-- CreateIndex
CREATE INDEX "KolContent_collabId_idx" ON "KolContent"("collabId");

-- CreateIndex
CREATE INDEX "KolContent_liveAt_idx" ON "KolContent"("liveAt");

-- CreateIndex
CREATE INDEX "KolContent_plannedAt_idx" ON "KolContent"("plannedAt");

-- CreateIndex
CREATE INDEX "KolContent_approvedById_idx" ON "KolContent"("approvedById");

-- CreateIndex
CREATE INDEX "KolContentMetric_contentId_idx" ON "KolContentMetric"("contentId");

-- CreateIndex
CREATE INDEX "KolContentMetric_recordedAt_idx" ON "KolContentMetric"("recordedAt");

-- CreateIndex
CREATE INDEX "KolSale_collabId_idx" ON "KolSale"("collabId");

-- CreateIndex
CREATE INDEX "KolSale_date_idx" ON "KolSale"("date");

-- CreateIndex
CREATE INDEX "KolNote_kolId_idx" ON "KolNote"("kolId");

-- CreateIndex
CREATE INDEX "KolNote_collabId_idx" ON "KolNote"("collabId");

-- CreateIndex
CREATE INDEX "KolNote_createdById_idx" ON "KolNote"("createdById");

-- CreateIndex
CREATE INDEX "KolAgenda_date_idx" ON "KolAgenda"("date");

-- CreateIndex
CREATE INDEX "KolAgenda_ownerId_idx" ON "KolAgenda"("ownerId");

-- CreateIndex
CREATE INDEX "KolAgenda_campaignId_idx" ON "KolAgenda"("campaignId");

-- CreateIndex
CREATE INDEX "KolAgenda_kolId_idx" ON "KolAgenda"("kolId");

-- CreateIndex
CREATE INDEX "KolAgenda_collabId_idx" ON "KolAgenda"("collabId");

-- CreateIndex
CREATE INDEX "Kol_waNormal_idx" ON "Kol"("waNormal");

-- CreateIndex
CREATE INDEX "KolBrief_tahap_idx" ON "KolBrief"("tahap");

-- CreateIndex
CREATE INDEX "KolBrief_campaignId_idx" ON "KolBrief"("campaignId");

-- CreateIndex
CREATE INDEX "KolBrief_picId_idx" ON "KolBrief"("picId");

-- ─────────────────────────── Migrasi data ───────────────────────────

-- Status lama -> tahap.
UPDATE "KolBrief" SET
    "tahap" = (CASE "status"::text
        WHEN 'DRAFT' THEN 'DEAL'
        WHEN 'DIKIRIM' THEN 'SAMPEL_DIKIRIM'
        WHEN 'DISETUJUI' THEN 'DRAF_DISETUJUI'
        WHEN 'KONTEN_DITERIMA' THEN 'DRAF'
        WHEN 'TAYANG' THEN 'TAYANG'
        WHEN 'SELESAI' THEN 'SELESAI'
        WHEN 'BATAL' THEN 'BATAL'
        ELSE 'PROSPEK'
    END)::"KolTahap",
    "tahapAt" = "updatedAt",
    "dealAt" = "createdAt",
    "payStatus" = (CASE WHEN "fee" > 0 THEN 'BELUM' ELSE 'TIDAK_PERLU' END)::"KolStatusBayar";

-- Teks campaign unik -> KolCampaign. Id diturunkan dari namanya supaya
-- deterministik; tautan ke brief lewat nama, bukan lewat id.
INSERT INTO "KolCampaign" ("id", "name", "startDate", "endDate", "createdById", "createdAt", "updatedAt")
SELECT
    'kcm' || substr(md5(trim("campaign")), 1, 22),
    trim("campaign"),
    min("startDate"),
    max("dueDate"),
    min("createdById"),
    min("createdAt"),
    CURRENT_TIMESTAMP
FROM "KolBrief"
WHERE trim("campaign") <> ''
GROUP BY trim("campaign");

UPDATE "KolBrief" AS b
SET "campaignId" = c."id"
FROM "KolCampaign" AS c
WHERE c."name" = trim(b."campaign");

-- Brief lama yang barangnya sudah berangkat -> satu pengiriman tercatat.
-- Stok TIDAK digerakkan lagi: StockAdjustment KOL_SEEDING-nya sudah ada.
INSERT INTO "KolShipment" ("id", "collabId", "sentAt", "stockIssuedAt", "note", "createdById", "createdAt", "updatedAt")
SELECT
    'ksm' || substr(md5("id"), 1, 22),
    "id",
    "stockIssuedAt",
    "stockIssuedAt",
    'dipindahkan dari brief lama',
    "createdById",
    "stockIssuedAt",
    "stockIssuedAt"
FROM "KolBrief"
WHERE "stockIssuedAt" IS NOT NULL;

INSERT INTO "KolShipmentLine" ("id", "shipmentId", "itemId", "itemName", "variantSku", "qty", "unitCost")
SELECT
    'ksl' || substr(md5(i."id"), 1, 22),
    'ksm' || substr(md5(b."id"), 1, 22),
    i."itemId",
    i."itemName",
    i."variantSku",
    i."qty",
    0
FROM "KolBriefItem" AS i
JOIN "KolBrief" AS b ON b."id" = i."briefId"
WHERE b."stockIssuedAt" IS NOT NULL;

-- ───────────────────── Buang kolom dan enum lama ─────────────────────

-- DropIndex
DROP INDEX "KolBrief_status_idx";

-- AlterTable
ALTER TABLE "KolBrief" DROP COLUMN "campaign",
DROP COLUMN "status";

-- DropEnum
DROP TYPE "KolBriefStatus";
