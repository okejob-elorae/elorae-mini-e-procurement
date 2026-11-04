-- Invoice item lines, for invoices typed by hand.
--
-- Optional by design: imported invoices arrive as a total and have no lines,
-- and demanding them would make the import unusable. The lines exist so an
-- invoice entered by hand can be checked against the shop's own copy.
--
-- Re-runnable: every statement is guarded.

CREATE TABLE IF NOT EXISTS "ReceivableItem" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "ReceivableItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReceivableItem_receivableId_idx" ON "ReceivableItem"("receivableId");
CREATE INDEX IF NOT EXISTS "ReceivableItem_itemId_idx" ON "ReceivableItem"("itemId");
