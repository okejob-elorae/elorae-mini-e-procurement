-- TikTok Shop orders were stored as TOKOPEDIA because channel detection keyed on
-- Jubelio's source_name ("Shop | Tokopedia"). The order-number prefix is authoritative.
-- Only prefixed marketplace rows change; OFFLINE field-sales rows carry no such prefix.
--
-- `salesorderNo`/`jubelioReturnNo` are VARCHAR(191) under the table's default
-- utf8mb4_unicode_ci collation, which makes LIKE case-INSENSITIVE — a bare
-- `LIKE 'TT-%'` would also relabel a lower-case `tt-...` row, while
-- `detectChannel` is deliberately case-sensitive on the prefix. Force a binary
-- comparison with `COLLATE utf8mb4_bin` so the backfill matches the same rows
-- the application code would.
UPDATE `SalesOrder` SET `channel` = 'TIKTOK' WHERE `salesorderNo` LIKE 'TT-%' COLLATE utf8mb4_bin AND `channel` <> 'TIKTOK';
UPDATE `SalesOrder` SET `channel` = 'TOKOPEDIA' WHERE `salesorderNo` LIKE 'TP-%' COLLATE utf8mb4_bin AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesOrder` SET `channel` = 'SHOPEE' WHERE `salesorderNo` LIKE 'SP-%' COLLATE utf8mb4_bin AND `channel` <> 'SHOPEE';

UPDATE `SalesReturn` SET `channel` = 'TIKTOK' WHERE `jubelioReturnNo` LIKE 'TT-%' COLLATE utf8mb4_bin AND `channel` <> 'TIKTOK';
UPDATE `SalesReturn` SET `channel` = 'TOKOPEDIA' WHERE `jubelioReturnNo` LIKE 'TP-%' COLLATE utf8mb4_bin AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesReturn` SET `channel` = 'SHOPEE' WHERE `jubelioReturnNo` LIKE 'SP-%' COLLATE utf8mb4_bin AND `channel` <> 'SHOPEE';
