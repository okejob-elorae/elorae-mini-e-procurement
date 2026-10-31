-- Laporan pengganti (2026-10-01).
--
-- BKM atau nota retur yang ditarik/dibatalkan karena salah toko dilaporkan
-- ulang dari salinannya. Kolom ini menautkan laporan baru ke yang digantikan,
-- dan UNIK: satu laporan lama hanya bisa punya SATU pengganti — melaporkan
-- uang atau barang yang sama dua kali ditolak oleh basis data, bukan oleh
-- ingatan orang.
ALTER TABLE "PaymentClaim" ADD COLUMN "replacesClaimId" TEXT;
CREATE UNIQUE INDEX "PaymentClaim_replacesClaimId_key" ON "PaymentClaim"("replacesClaimId");

ALTER TABLE "StoreReturn" ADD COLUMN "replacesReturnId" TEXT;
CREATE UNIQUE INDEX "StoreReturn_replacesReturnId_key" ON "StoreReturn"("replacesReturnId");
