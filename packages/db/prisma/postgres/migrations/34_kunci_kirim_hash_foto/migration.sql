-- Anti-dobel dan foto yang tidak bisa "dicuci" (2026-10-06).
--
-- `idempotencyKey`: dibuat formulir SEKALI per isian dan diperiksa penulis
-- PALING DULU. Kiriman ulang sesudah jawaban hilang mengembalikan dokumen yang
-- sama, bukan mencatat penerimaan barang / pengeluaran bahan / pembayaran toko
-- dua kali. Kosong = dokumen lama atau pemanggil tanpa kunci.
--
-- GRN: tanpa kunci, GRN yang disimpan ulang menambah stok, menggeser harga
-- rata-rata, status PO, dan jurnal hutang dua kali.
ALTER TABLE "GRN" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "GRN_idempotencyKey_key" ON "GRN"("idempotencyKey");

-- Pengeluaran bahan: kuncinya dulu hanya di `AuditLog.metadata`
-- (`MATERIAL_ISSUED`). Kunci lama tetap dikenali kode dari sana; tidak disalin
-- ke kolom ini supaya migrasi tidak bisa gagal pada kunci kembar data lama.
ALTER TABLE "MaterialIssue" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "MaterialIssue_idempotencyKey_key" ON "MaterialIssue"("idempotencyKey");

ALTER TABLE "ConsignmentPayment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "ConsignmentPayment_idempotencyKey_key" ON "ConsignmentPayment"("idempotencyKey");

-- Sidik isi foto (hex huruf kecil), diisi saat unggah. Foto yang isinya sama
-- persis dengan foto milik orang lain yang sudah dipakai dokumen bisa dikenali
-- (`lib/foto/kembar.ts`). Foto lama diisi dari isinya sendiri.
ALTER TABLE "Foto" ADD COLUMN "sha256" TEXT;
CREATE INDEX "Foto_sha256_idx" ON "Foto"("sha256");
UPDATE "Foto" SET "sha256" = encode(sha256("bytes"), 'hex') WHERE "sha256" IS NULL;
