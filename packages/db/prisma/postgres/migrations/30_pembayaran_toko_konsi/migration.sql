-- Pembayaran toko per siklus konsinyasi (2026-10-05).
--
-- Toko konsinyasi sengaja tidak pernah muncul di piutang, jadi tagihan siklus
-- konsinyasi selama ini tidak pernah dipantau pelunasannya. Satu baris = satu
-- pembayaran (boleh dicicil). Sisa tagihan TIDAK disimpan: dihitung dari total
-- tagihan yang dibekukan saat mengunci dikurangi pembayaran yang tidak
-- dibatalkan. Pembayaran yang salah catat dibatalkan dengan alasan, tidak
-- pernah dihapus; selama ada pembayaran hidup, kunci siklus tidak bisa dibuka.
CREATE TABLE IF NOT EXISTS "ConsignmentPayment" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'transfer',
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsignmentPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConsignmentPayment_cycleId_idx" ON "ConsignmentPayment"("cycleId");
