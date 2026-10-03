-- Aplikasi salesman, lanjutan (2026-10-01).
--
-- `FieldSalesOrder.cancelledById/cancelledAt`: salesman membatalkan pesanannya
-- sendiri yang masih menunggu persetujuan. Statusnya tetap REJECTED (kueri
-- "pesanan hidup" di seluruh kode memakai status <> REJECTED); dua kolom ini
-- yang membedakan "dibatalkan salesman" dari "ditolak kantor".
-- `FieldSalesOrder.replacesOrderId`: pesanan pengganti saat salesman mengubah
-- pesanan — pesanan lama dibatalkan di transaksi yang sama.
-- `VisitSchedule`: jadwal kunjungan dari kantor, satu baris per sales x toko x hari WIB.
-- `Announcement` + `AnnouncementRead`: pengumuman kantor ke lapangan.
-- `LeaveRequest`: izin, sakit, cuti.
-- `SalesTarget`: target per kategori/barang per sales per bulan (target total
-- tetap di SystemSetting `salesman.target`).
-- `StoreNote`: catatan bebas per toko.
ALTER TABLE "FieldSalesOrder" ADD COLUMN "cancelledById" TEXT;
ALTER TABLE "FieldSalesOrder" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "FieldSalesOrder" ADD COLUMN "replacesOrderId" TEXT;
CREATE INDEX "FieldSalesOrder_replacesOrderId_idx" ON "FieldSalesOrder"("replacesOrderId");

CREATE TABLE "VisitSchedule" (
    "id" TEXT NOT NULL, "salesmanId" TEXT NOT NULL, "storeId" TEXT NOT NULL, "dayKey" TEXT NOT NULL,
    "note" TEXT, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitSchedule_salesmanId_storeId_dayKey_key" ON "VisitSchedule"("salesmanId", "storeId", "dayKey");
CREATE INDEX "VisitSchedule_dayKey_idx" ON "VisitSchedule"("dayKey");
CREATE INDEX "VisitSchedule_storeId_idx" ON "VisitSchedule"("storeId");

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'SEMUA', "requireAck" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false, "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3), "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_publishedAt_idx" ON "Announcement"("publishedAt");

CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL, "announcementId" TEXT NOT NULL, "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ackAt" TIMESTAMP(3),
    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
    "startDay" TEXT NOT NULL, "endDay" TEXT NOT NULL, "reason" TEXT NOT NULL, "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DIAJUKAN', "reviewedById" TEXT, "reviewedAt" TIMESTAMP(3), "reviewNote" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveRequest_idempotencyKey_key" ON "LeaveRequest"("idempotencyKey");
CREATE INDEX "LeaveRequest_userId_startDay_idx" ON "LeaveRequest"("userId", "startDay");
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL, "salesmanId" TEXT NOT NULL, "month" TEXT NOT NULL,
    "scope" TEXT NOT NULL, "refId" TEXT NOT NULL, "measure" TEXT NOT NULL DEFAULT 'NILAI',
    "value" DECIMAL(15,2) NOT NULL, "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesTarget_salesmanId_month_scope_refId_key" ON "SalesTarget"("salesmanId", "month", "scope", "refId");
CREATE INDEX "SalesTarget_month_idx" ON "SalesTarget"("month");

CREATE TABLE "StoreNote" (
    "id" TEXT NOT NULL, "storeId" TEXT NOT NULL, "authorId" TEXT NOT NULL, "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "StoreNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StoreNote_storeId_deletedAt_idx" ON "StoreNote"("storeId", "deletedAt");
