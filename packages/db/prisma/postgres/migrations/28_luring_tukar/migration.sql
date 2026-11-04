-- Pekerjaan SPG tanpa sinyal dan tukar barang di konter (2026-10-03).
-- * `idempotencyKey` pada tanda terima kiriman dan opname toko: HP yang
--   mengirim ulang dari antrean tidak pernah mencatat dua kali.
-- * `StoreVisit.clientId` (unik) + `capturedOffline` + `syncedAt`: check-in
--   yang dicatat tanpa sinyal tercatat pada waktu di HP; nota yang dijual
--   selama itu menunjuk kunjungannya lewat `clientId`, sebelum id server ada.
-- * (Tukar barang di konter sempat dibuat di migrasi ini lalu dicabut hari yang
--   sama atas keputusan pemilik — SPG tidak menerima tukar ukuran. Kolomnya
--   dibuang dari sini; nama folder dibiarkan.)
ALTER TABLE "StoreOpname" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "StoreReceipt" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "StoreVisit" ADD COLUMN "capturedOffline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "clientId" TEXT,
ADD COLUMN "syncedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "StoreOpname_idempotencyKey_key" ON "StoreOpname"("idempotencyKey");
CREATE UNIQUE INDEX "StoreReceipt_idempotencyKey_key" ON "StoreReceipt"("idempotencyKey");
CREATE UNIQUE INDEX "StoreVisit_clientId_key" ON "StoreVisit"("clientId");
