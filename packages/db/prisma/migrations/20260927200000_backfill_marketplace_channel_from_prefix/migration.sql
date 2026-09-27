-- TikTok Shop orders were stored as TOKOPEDIA because channel detection keyed on
-- Jubelio's source_name ("Shop | Tokopedia"). The order-number prefix is authoritative.
-- Only prefixed marketplace rows change; OFFLINE field-sales rows carry no such prefix.
--
-- `salesorderNo`/`jubelioReturnNo` are VARCHAR(191) under the table's default
-- utf8mb4_unicode_ci collation, which makes LIKE case-INSENSITIVE — a bare
-- `LIKE 'TT-%'` would also relabel a lower-case `tt-...` row, while
-- `detectChannel` is deliberately case-sensitive on the prefix. `BINARY` on the
-- column forces a byte-wise comparison so the backfill matches the same rows the
-- application code would.
--
-- `BINARY col` rather than `LIKE '...' COLLATE utf8mb4_bin`: the prod deploy applies
-- this file through the `mariadb` CLI, which connects with a utf8mb3 connection
-- charset, so the literal is utf8mb3 and `COLLATE utf8mb4_bin` on it is rejected at
-- parse time (ERROR 1253). `BINARY` is independent of the connection charset.
--
-- Idempotent: every statement skips rows already on its target channel, so the same
-- six statements can be re-run safely.
UPDATE `SalesOrder` SET `channel` = 'TIKTOK' WHERE BINARY `salesorderNo` LIKE 'TT-%' AND `channel` <> 'TIKTOK';
UPDATE `SalesOrder` SET `channel` = 'TOKOPEDIA' WHERE BINARY `salesorderNo` LIKE 'TP-%' AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesOrder` SET `channel` = 'SHOPEE' WHERE BINARY `salesorderNo` LIKE 'SP-%' AND `channel` <> 'SHOPEE';

UPDATE `SalesReturn` SET `channel` = 'TIKTOK' WHERE BINARY `jubelioReturnNo` LIKE 'TT-%' AND `channel` <> 'TIKTOK';
UPDATE `SalesReturn` SET `channel` = 'TOKOPEDIA' WHERE BINARY `jubelioReturnNo` LIKE 'TP-%' AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesReturn` SET `channel` = 'SHOPEE' WHERE BINARY `jubelioReturnNo` LIKE 'SP-%' AND `channel` <> 'SHOPEE';
