-- Bagian faktur yang sudah dibayar SEBELUM faktur itu diimpor (MariaDB).
-- Setara 29_dibayar_sebelum_impor di sisi Postgres; alasannya ditulis di sana.
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
ALTER TABLE `Receivable` ADD COLUMN `paidBeforeImport` DECIMAL(15, 2) NOT NULL DEFAULT 0;

-- Hanya faktur impor yang belum pernah disentuh klaim (lihat sisi Postgres).
UPDATE `Receivable` r
SET r.`paidBeforeImport` = r.`amount` - r.`outstanding`
WHERE r.`source` = 'IMPORT'
  AND r.`outstanding` >= 0
  AND r.`outstanding` < r.`amount`
  AND NOT EXISTS (
    SELECT 1 FROM `PaymentClaimReceivable` l WHERE l.`receivableId` = r.`id`
  );
