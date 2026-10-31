-- A payment claim can be VOIDED, which is a different thing from being rejected.
--
-- Rejected means finance looked and the money was not there. Voided means the
-- claim itself was entered wrong — wrong invoice, wrong amount, wrong return
-- link. Until now only rejection existed, so correcting a typing mistake meant
-- recording a false statement about the bank.
--
-- The row is kept rather than deleted: it is the only place the mistake and its
-- correction are both visible. `nilaiDiakui` recognises zero for anything that
-- is not TERVERIFIKASI, so a voided claim releases its hold on the receivable
-- with no change to the money rule itself.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PostgreSQL 12+
-- as long as the new value is not USED in the same transaction. This migration
-- only adds it.

ALTER TYPE "PaymentClaimStatus" ADD VALUE IF NOT EXISTS 'DIBATALKAN';
