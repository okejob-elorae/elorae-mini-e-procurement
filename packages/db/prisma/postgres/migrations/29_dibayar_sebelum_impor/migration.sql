-- Bagian faktur yang sudah dibayar SEBELUM faktur itu diimpor (2026-10-05).
--
-- Berkas impor membawa nilai faktur dan sisanya (Rp10 jt, sisa Rp4 jt). Dulu
-- sisa itu hanya ditaruh di kolom cache `outstanding`, sedangkan setiap
-- perhitungan ulang menghitung dari `amount` — begitu faktur disentuh BKM atau
-- dibuka di daftar piutang, ia kembali Rp10 jt dan toko ditagih ulang. Bagian
-- yang sudah dibayar kini disimpan di kolomnya sendiri dan dikurangkan oleh
-- `hitungSisaPiutang`.
ALTER TABLE "Receivable" ADD COLUMN "paidBeforeImport" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Isi untuk faktur impor yang BELUM PERNAH disentuh klaim: kolom `outstanding`
-- miliknya masih sisa dari berkas. Faktur yang sudah disentuh klaim TIDAK diisi:
-- `outstanding`-nya sudah ditimpa perhitungan ulang, jadi `amount - outstanding`
-- di sana adalah pembayaran terverifikasi, dan mengisinya akan memotong
-- pembayaran itu dua kali. Faktur seperti itu harus dibetulkan dari berkas
-- impor aslinya.
UPDATE "Receivable" r
SET "paidBeforeImport" = r."amount" - r."outstanding"
WHERE r."source" = 'IMPORT'
  AND r."outstanding" >= 0
  AND r."outstanding" < r."amount"
  AND NOT EXISTS (
    SELECT 1 FROM "PaymentClaimReceivable" l WHERE l."receivableId" = r."id"
  );
