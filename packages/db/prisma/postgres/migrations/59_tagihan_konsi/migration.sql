-- Tagihan konsinyasi adalah piutang (keputusan pemilik 2026-10-29: "Tagihan konsinyasi MASUK Piutang
-- setelah angka terjual dikunci"; susulan P31, P54, P55, P59 tanggal 2026-11-02). Mengunci angka
-- terjual siklus (apps/web/lib/konsinyasi/writer.ts `kunciAngka`) membuat satu piutang hidup untuk
-- siklus itu; membuka kuncinya (`bukaKunci`) membatalkannya. Toko melunasinya hanya lewat BKM + cek
-- keuangan ("satu jalur bayar"), jadi tabel pembayaran toko konsi milik Max dihapus.
--
-- consignmentCycleId: siklus asal tagihan. SENGAJA tidak unik: siklus yang dibuka kuncinya menyimpan
-- piutang VOIDED-nya ("<noKonsi> (batal)") sebagai riwayat di samping yang hidup.
-- isConsignment: SATU-SATUNYA penanda konsi, diisi saat dibuat dan tidak pernah diubah.
--
-- Receivable di skema ini tidak punya sellThroughId maupun CHECK sumber, jadi tidak ada isian ulang
-- dan tidak ada CHECK yang dipasang ulang. Tanpa FOREIGN KEY (relationMode = "prisma"). Aman dijalankan
-- ulang.

ALTER TABLE "Receivable" ADD COLUMN IF NOT EXISTS "consignmentCycleId" TEXT;

ALTER TABLE "Receivable" ADD COLUMN IF NOT EXISTS "isConsignment" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Receivable_consignmentCycleId_idx" ON "Receivable"("consignmentCycleId");

DROP TABLE IF EXISTS "ConsignmentPayment";
