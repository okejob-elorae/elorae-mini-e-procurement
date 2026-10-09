-- Warna jenis pemasok dari katalog Pantone TCX (pemilik 2026-10-09: "kenapa tidak menggunakan warna pantone saja").
-- SupplierType.colorTcx = kode Pantone yang dipilih; SupplierType.color tetap menyimpan hex-nya (diambil
-- server dari PantoneColor) supaya daftar pemasok tidak perlu bergabung ke katalog. Tanpa foreign key.
ALTER TABLE "SupplierType" ADD COLUMN "colorTcx" TEXT;
CREATE INDEX "SupplierType_colorTcx_idx" ON "SupplierType"("colorTcx");
