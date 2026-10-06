-- Read-only pre-flight for adding the missing field-sales foreign keys.
--
-- Lists every row whose reference points at a parent that no longer exists, on
-- the relations that carry NO database constraint today (declared under
-- relationMode = "prisma" and never given a hand-authored FK). Strictly SELECT:
-- no INSERT, UPDATE, DELETE, DDL or session changes.
--
-- Run (owner only), against the prod tunnel on local port 3307 or on the VPS:
--   MySQL 8 client:   mariadb --ssl-mode=DISABLED -h 127.0.0.1 -P 3307 -u <user> -p elorae < scripts/audit-field-sales-orphans.sql
--   MariaDB client:   replace --ssl-mode=DISABLED with --skip-ssl
-- Against the local 3308 test bed it is equally safe.
--
-- Reading the result:
--   Sections 1-10 (relation, id, dangling_value): every row returned is one
--   orphan. Zero rows for a section means that relation is clean. Any rows
--   must be repaired or retired before the matching FK migration is written.
--   Sections C1-C5 are CONTROLS on relations that already have real FKs and
--   must always return zero rows. A control returning rows means the probe is
--   broken (or a constraint was dropped), not that the data has a problem.
--   The final section lists row counts per child table, so an empty bed can be
--   told apart from a clean one.
--   Plain = joins are correct here: the ids are cuid strings in the default
--   collation. A probe joining on a SKU would need BINARY on both sides.

-- 1. FieldSalesOrder.storeId -> Store
SELECT 'FieldSalesOrder.storeId' AS relation, child.id, child.storeId AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN Store p ON p.id = child.storeId
WHERE child.storeId IS NOT NULL AND p.id IS NULL;

-- 2. FieldSalesOrder.salesmanId -> User
SELECT 'FieldSalesOrder.salesmanId' AS relation, child.id, child.salesmanId AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN User p ON p.id = child.salesmanId
WHERE child.salesmanId IS NOT NULL AND p.id IS NULL;

-- 3. FieldSalesOrder.visitId -> StoreVisit
SELECT 'FieldSalesOrder.visitId' AS relation, child.id, child.visitId AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN StoreVisit p ON p.id = child.visitId
WHERE child.visitId IS NOT NULL AND p.id IS NULL;

-- 4. FieldSalesOrder.approvedById -> User
SELECT 'FieldSalesOrder.approvedById' AS relation, child.id, child.approvedById AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN User p ON p.id = child.approvedById
WHERE child.approvedById IS NOT NULL AND p.id IS NULL;

-- 5. FieldSalesOrder.rejectedById -> User
SELECT 'FieldSalesOrder.rejectedById' AS relation, child.id, child.rejectedById AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN User p ON p.id = child.rejectedById
WHERE child.rejectedById IS NOT NULL AND p.id IS NULL;

-- 6. FieldSalesOrder.closedById -> User
SELECT 'FieldSalesOrder.closedById' AS relation, child.id, child.closedById AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN User p ON p.id = child.closedById
WHERE child.closedById IS NOT NULL AND p.id IS NULL;

-- 7. FieldSalesOrder.creditOverrideById -> User
SELECT 'FieldSalesOrder.creditOverrideById' AS relation, child.id, child.creditOverrideById AS dangling_value
FROM FieldSalesOrder child
LEFT JOIN User p ON p.id = child.creditOverrideById
WHERE child.creditOverrideById IS NOT NULL AND p.id IS NULL;

-- 8. FieldSalesOrderLine.orderId -> FieldSalesOrder
SELECT 'FieldSalesOrderLine.orderId' AS relation, child.id, child.orderId AS dangling_value
FROM FieldSalesOrderLine child
LEFT JOIN FieldSalesOrder p ON p.id = child.orderId
WHERE child.orderId IS NOT NULL AND p.id IS NULL;

-- 9. FieldSalesOrderLine.itemId -> Item
SELECT 'FieldSalesOrderLine.itemId' AS relation, child.id, child.itemId AS dangling_value
FROM FieldSalesOrderLine child
LEFT JOIN Item p ON p.id = child.itemId
WHERE child.itemId IS NOT NULL AND p.id IS NULL;

-- 10. FieldSalesOrderLine.addedById -> User
SELECT 'FieldSalesOrderLine.addedById' AS relation, child.id, child.addedById AS dangling_value
FROM FieldSalesOrderLine child
LEFT JOIN User p ON p.id = child.addedById
WHERE child.addedById IS NOT NULL AND p.id IS NULL;

-- C1. CONTROL (real FK, must be zero rows): FieldSalesDelivery.orderId -> FieldSalesOrder
SELECT 'CONTROL FieldSalesDelivery.orderId' AS relation, child.id, child.orderId AS dangling_value
FROM FieldSalesDelivery child
LEFT JOIN FieldSalesOrder p ON p.id = child.orderId
WHERE child.orderId IS NOT NULL AND p.id IS NULL;

-- C2. CONTROL (real FK, must be zero rows): FieldSalesDelivery.deliveredById -> User
SELECT 'CONTROL FieldSalesDelivery.deliveredById' AS relation, child.id, child.deliveredById AS dangling_value
FROM FieldSalesDelivery child
LEFT JOIN User p ON p.id = child.deliveredById
WHERE child.deliveredById IS NOT NULL AND p.id IS NULL;

-- C3. CONTROL (real FK, must be zero rows): FieldSalesDeliveryLine.deliveryId -> FieldSalesDelivery
SELECT 'CONTROL FieldSalesDeliveryLine.deliveryId' AS relation, child.id, child.deliveryId AS dangling_value
FROM FieldSalesDeliveryLine child
LEFT JOIN FieldSalesDelivery p ON p.id = child.deliveryId
WHERE child.deliveryId IS NOT NULL AND p.id IS NULL;

-- C4. CONTROL (real FK, must be zero rows): FieldSalesDeliveryLine.orderLineId -> FieldSalesOrderLine
SELECT 'CONTROL FieldSalesDeliveryLine.orderLineId' AS relation, child.id, child.orderLineId AS dangling_value
FROM FieldSalesDeliveryLine child
LEFT JOIN FieldSalesOrderLine p ON p.id = child.orderLineId
WHERE child.orderLineId IS NOT NULL AND p.id IS NULL;

-- C5. CONTROL (real FK, must be zero rows): FieldSalesDeliveryLine.itemId -> Item
SELECT 'CONTROL FieldSalesDeliveryLine.itemId' AS relation, child.id, child.itemId AS dangling_value
FROM FieldSalesDeliveryLine child
LEFT JOIN Item p ON p.id = child.itemId
WHERE child.itemId IS NOT NULL AND p.id IS NULL;

-- Row counts per child table
SELECT 'FieldSalesOrder' AS child_table, COUNT(*) AS row_count FROM FieldSalesOrder
UNION ALL SELECT 'FieldSalesOrderLine', COUNT(*) FROM FieldSalesOrderLine
UNION ALL SELECT 'FieldSalesDelivery', COUNT(*) FROM FieldSalesDelivery
UNION ALL SELECT 'FieldSalesDeliveryLine', COUNT(*) FROM FieldSalesDeliveryLine;
