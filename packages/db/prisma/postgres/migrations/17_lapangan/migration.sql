-- Pekerjaan lapangan salesman, Tahap 2.
--
-- StoreVisit: hasil kunjungan (`outcome` kode alasan, `outcomeNote`) — kunjungan
-- yang tidak menghasilkan transaksi wajib punya alasan; dan tanda check-in
-- (`checkinAccuracyMeters` dari GPS HP, `checkinFlags` daftar kode kejanggalan
-- seperti akurasi buruk atau lompatan jarak mustahil). Aplikasi web tidak bisa
-- mendeteksi aplikasi pemalsu GPS; yang bisa dicatat hanyalah kejanggalannya.
--
-- FieldSalesOrder.remoteChannel: pesanan jarak jauh (WA/telepon) yang diambil
-- tanpa check-in. Kosong = diambil saat kunjungan.
--
-- CollectionNote (kontrabon/tukar faktur) kini boleh dicatat salesman di
-- lapangan (`source` = FIELD). Ia langsung berlaku untuk penagihan, tetapi
-- kantor mengonfirmasinya (`confirmedAt/By`). `idempotencyKey` untuk antrean luring.
--
-- PaymentClaim: data giro. Giro tetap belum lunas sampai cair — `giroStatus`
-- MENUNGGU → CAIR / DITOLAK, bukan status klaim.
--
-- StoreProposal: calon toko baru yang didaftarkan salesman, menunggu admin.
ALTER TABLE "StoreVisit" ADD COLUMN "checkinAccuracyMeters" INTEGER;
ALTER TABLE "StoreVisit" ADD COLUMN "checkinFlags" JSONB;
ALTER TABLE "StoreVisit" ADD COLUMN "outcome" TEXT;
ALTER TABLE "StoreVisit" ADD COLUMN "outcomeNote" TEXT;

ALTER TABLE "FieldSalesOrder" ADD COLUMN "remoteChannel" TEXT;

ALTER TABLE "CollectionNote" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'OFFICE';
ALTER TABLE "CollectionNote" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "CollectionNote" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "CollectionNote" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "CollectionNote_idempotencyKey_key" ON "CollectionNote"("idempotencyKey");

ALTER TABLE "PaymentClaim" ADD COLUMN "giroNo" TEXT;
ALTER TABLE "PaymentClaim" ADD COLUMN "giroBank" TEXT;
ALTER TABLE "PaymentClaim" ADD COLUMN "giroIssueDate" TIMESTAMP(3);
ALTER TABLE "PaymentClaim" ADD COLUMN "giroEffectiveDate" TIMESTAMP(3);
ALTER TABLE "PaymentClaim" ADD COLUMN "giroStatus" TEXT;
ALTER TABLE "PaymentClaim" ADD COLUMN "giroSettledAt" TIMESTAMP(3);
CREATE INDEX "PaymentClaim_giroStatus_giroEffectiveDate_idx" ON "PaymentClaim"("giroStatus", "giroEffectiveDate");

CREATE TABLE "StoreProposal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "contactName" TEXT,
    "termsType" "StoreTermsType",
    "groupId" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "photoUrl" TEXT,
    "note" TEXT,
    "proposedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "storeId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreProposal_idempotencyKey_key" ON "StoreProposal"("idempotencyKey");
CREATE INDEX "StoreProposal_status_createdAt_idx" ON "StoreProposal"("status", "createdAt");
CREATE INDEX "StoreProposal_proposedById_idx" ON "StoreProposal"("proposedById");
