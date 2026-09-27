-- TikTok Shop orders were stored as TOKOPEDIA because channel detection keyed on
-- Jubelio's source_name ("Shop | Tokopedia"). The order-number prefix is authoritative.
-- Only prefixed marketplace rows change; OFFLINE field-sales rows carry no such prefix.
UPDATE `SalesOrder` SET `channel` = 'TIKTOK' WHERE `salesorderNo` LIKE 'TT-%' AND `channel` <> 'TIKTOK';
UPDATE `SalesOrder` SET `channel` = 'TOKOPEDIA' WHERE `salesorderNo` LIKE 'TP-%' AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesOrder` SET `channel` = 'SHOPEE' WHERE `salesorderNo` LIKE 'SP-%' AND `channel` <> 'SHOPEE';

UPDATE `SalesReturn` SET `channel` = 'TIKTOK' WHERE `jubelioReturnNo` LIKE 'TT-%' AND `channel` <> 'TIKTOK';
UPDATE `SalesReturn` SET `channel` = 'TOKOPEDIA' WHERE `jubelioReturnNo` LIKE 'TP-%' AND `channel` <> 'TOKOPEDIA';
UPDATE `SalesReturn` SET `channel` = 'SHOPEE' WHERE `jubelioReturnNo` LIKE 'SP-%' AND `channel` <> 'SHOPEE';
