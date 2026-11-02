-- SPG shopper returns wait for the office (owner decision 2026-11-02): "pembeli tidak mungkin
-- mengembalikan barang ke toko ataupun SPG, namun jika ada kasus itu maka SPG harus memberikan
-- report bahwa ada retur, dan menunggu konfirmasi ke kantor dahulu". The SPG REPORTS the return;
-- the report changes nothing (store stock book, net sales, SPG commission, consignment report,
-- SalesHistory) until an approver (`spg_returns:approve`: admin and ADMIN_PENJUALAN by default)
-- approves it (apps/web/lib/spg/retur-pembeli.ts `setujuiReturPembeli`).
--
-- status: MENUNGGU -> DISETUJUI | DITOLAK, or DIBATALKAN (withdrawn by the reporting SPG). All
-- three are terminal. The column DEFAULT 'DISETUJUI' IS the backfill: ADD COLUMN fills every
-- existing row with DISETUJUI, and every existing row already took effect when it was recorded.
-- Deliberately NO UPDATE statement: re-running an UPDATE after new reports have arrived would
-- approve a MENUNGGU report without applying its effects. The same default keeps the deploy window
-- consistent: the deploy migrates BEFORE the new web image is live, and the old image still applies
-- a return's effects at insert without naming the column, so its rows land DISETUJUI — matching
-- what it applied. The new writer always writes MENUNGGU explicitly.
-- decidedById / decidedAt: who decided and when (approve or reject, or the SPG who withdrew); NULL
-- on the old rows, which read "Berlaku langsung" on the office screens.
-- rejectReason: the office's reason for rejecting, or the SPG's reason for withdrawing.
-- The (status, createdAt) index serves the office queue and the Beranda count of MENUNGGU reports.
-- No FOREIGN KEY (relationMode = "prisma"). Additive and re-runnable (IF NOT EXISTS).

ALTER TABLE `SpgSaleReturn`
  ADD COLUMN IF NOT EXISTS `status` ENUM('MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN') NOT NULL DEFAULT 'DISETUJUI',
  ADD COLUMN IF NOT EXISTS `decidedById` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `decidedAt` DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS `rejectReason` TEXT NULL;

CREATE INDEX IF NOT EXISTS `SpgSaleReturn_status_createdAt_idx` ON `SpgSaleReturn`(`status`, `createdAt`);
