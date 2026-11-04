-- Retur pembeli SPG menunggu persetujuan kantor (keputusan pemilik 2026-11-02). SPG MELAPORKAN
-- retur; laporannya baru berpengaruh (buku stok toko, penjualan bersih, komisi SPG, laporan
-- konsinyasi, SalesHistory) setelah disetujui pemegang `spg_returns:approve` (bawaannya admin dan
-- ADMIN_PENJUALAN) — apps/web/lib/spg/retur-pembeli.ts `setujuiReturPembeli`.
--
-- status: MENUNGGU → DISETUJUI | DITOLAK, atau DIBATALKAN (ditarik SPG pelapornya). Ketiganya
-- final. Isian bawaan 'DISETUJUI' ADALAH isian ulang: ADD COLUMN mengisi setiap baris lama dengan
-- DISETUJUI, dan semuanya sudah berlaku saat dicatat. Sengaja TANPA UPDATE: UPDATE yang dijalankan
-- ulang sesudah laporan baru masuk akan menyetujui laporan MENUNGGU tanpa menerapkan pengaruhnya.
-- Bawaan yang sama menjaga jendela penerapan: image lama yang masih berjalan sesudah migrasi
-- menerapkan retur saat mencatat tanpa menyebut kolom ini, dan barisnya mendarat DISETUJUI —
-- sesuai yang ia terapkan. Penulis baru selalu mengisi MENUNGGU sendiri.
-- decidedById/decidedAt: siapa & kapan memutuskan (setuju/tolak, atau SPG yang menarik); NULL pada
-- baris lama, yang di layar kantor tertulis "Berlaku langsung".
-- rejectReason: alasan kantor menolak, atau alasan SPG menarik.
-- Indeks (status, createdAt) melayani antrean kantor dan hitungan Beranda laporan MENUNGGU.
-- Tanpa FOREIGN KEY (relationMode = "prisma"). Menambah saja, aman dijalankan ulang.

DO $$ BEGIN
  CREATE TYPE "SpgSaleReturnStatus" AS ENUM ('MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "status" "SpgSaleReturnStatus" NOT NULL DEFAULT 'DISETUJUI';
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "decidedById" TEXT;
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
ALTER TABLE "SpgSaleReturn" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;

CREATE INDEX IF NOT EXISTS "SpgSaleReturn_status_createdAt_idx" ON "SpgSaleReturn"("status", "createdAt");
