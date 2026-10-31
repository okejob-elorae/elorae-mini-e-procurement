-- Orang & atasan, Tahap 4.
--
-- ExpenseClaim: klaim biaya perjalanan salesman (bensin, parkir, tol, makan,
-- lainnya) dengan foto struk. DIAJUKAN → DISETUJUI / DITOLAK → DIBAYAR.
-- `idempotencyKey` untuk antrean luring.
--
-- Attendance: absensi harian — satu baris per orang per hari kalender WIB
-- (`dayKey` "YYYY-MM-DD"), masuk dengan swafoto + GPS, pulang dengan GPS.
-- Komisi tidak punya tabel: skemanya di SystemSetting dan angkanya dihitung
-- dari tagihan yang sudah terverifikasi.
CREATE TABLE "ExpenseClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "photoUrl" TEXT,
    "note" TEXT,
    "visitId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DIAJUKAN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpenseClaim_idempotencyKey_key" ON "ExpenseClaim"("idempotencyKey");
CREATE INDEX "ExpenseClaim_userId_spentAt_idx" ON "ExpenseClaim"("userId", "spentAt");
CREATE INDEX "ExpenseClaim_status_createdAt_idx" ON "ExpenseClaim"("status", "createdAt");

CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockInLat" DECIMAL(10,7),
    "clockInLng" DECIMAL(10,7),
    "clockInAccuracy" INTEGER,
    "selfieUrl" TEXT,
    "clockOutAt" TIMESTAMP(3),
    "clockOutLat" DECIMAL(10,7),
    "clockOutLng" DECIMAL(10,7),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Attendance_userId_dayKey_key" ON "Attendance"("userId", "dayKey");
CREATE INDEX "Attendance_dayKey_idx" ON "Attendance"("dayKey");
