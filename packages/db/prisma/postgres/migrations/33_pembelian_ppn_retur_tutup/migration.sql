-- Pembelian: PPN PO dihitung, PO kurang kirim bisa ditutup, retur pemasok
-- mengurangi utang PO (2026-10-06).
--
-- `ppnRatePercent`: tarif PPN yang dipakai saat PO dibuat. Kosong = PO lama yang
-- dibuat sebelum PPN dihitung — nilainya tidak diubah (taxAmount tetap 0).
-- `closedAt`/`closedById`/`closeReason`: diisi HANYA oleh "Tutup PO" (PO yang
-- ditutup sebelum barangnya lengkap); PO yang lengkap lewat GRN tetap kosong.
ALTER TABLE "PurchaseOrder" ADD COLUMN "ppnRatePercent" DECIMAL(5,2);
ALTER TABLE "PurchaseOrder" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN "closedById" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "closeReason" TEXT;

-- Retur pemasok yang selesai mencatat PO yang utangnya dikurangi dan besarnya
-- (harga beli di PO, termasuk PPN baris "Exclude PPN"). Kosong = retur lama
-- atau retur yang tidak terkait PO pemasok yang sama.
ALTER TABLE "VendorReturn" ADD COLUMN "poId" TEXT;
ALTER TABLE "VendorReturn" ADD COLUMN "poCreditAmount" DECIMAL(15,2);
CREATE INDEX "VendorReturn_poId_idx" ON "VendorReturn"("poId");
