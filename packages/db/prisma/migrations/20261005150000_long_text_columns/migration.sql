-- Kolom teks yang dilebarkan dari VARCHAR(191) ke TEXT (MariaDB).
-- BELUM PERNAH DIJALANKAN pada MariaDB mana pun — cabang ini berjalan di PostgreSQL.
--
-- `String` tanpa `@db.Text` menjadi VARCHAR(191) di MariaDB, sementara aksinya
-- menerima lebih panjang. Dalam mode ketat MariaDB menolak simpanannya dengan
-- "Data too long" — tidak terlihat di PostgreSQL, tempat String sudah TEXT.
--
-- Tidak ada sisi Postgres: `@db.Text` tidak mengubah DDL di sana.
-- Pelebaran tidak memotong data apa pun, dan MODIFY yang diulang tidak mengubah
-- apa-apa, jadi aman dijalankan ulang. Tidak ada kolom ini yang diindeks.

-- SPG: catatan kerusakan saat menerima kiriman (zod 500), titip pesan pembeli
-- (zod 400), dan barang yang dicari pembeli (zod 200 dari layar stok, sampai 400
-- bila disalin dari titip pesan yang gagal dipenuhi). Tabelnya baru, jadi kosong.
ALTER TABLE `StoreReceiptLine` MODIFY `damageNote` TEXT NULL;

ALTER TABLE `LostSale` MODIFY `description` TEXT NOT NULL;

ALTER TABLE `CustomerRequest` MODIFY `description` TEXT NOT NULL;

-- Alasan banding harga dari HP (zod 500). Tabel ini sudah berisi di produksi;
-- pelebaran VARCHAR -> TEXT menyalin tabelnya sekali.
ALTER TABLE `FieldSalesOrderLine` MODIFY `appealReason` TEXT NULL;

-- Alasan di jejak audit. Banyak penulis baru menyalin alasan isian pengguna ke
-- sini DI DALAM transaksinya (mutasi toko zod 500, tutup titip pesan 500, ...),
-- jadi alasan di atas 191 huruf menggagalkan seluruh transaksi bisnisnya, bukan
-- hanya baris auditnya. Tabel ini sudah berisi di produksi; pelebarannya
-- menyalin tabel sekali dan menahan penulisan AuditLog selama itu.
ALTER TABLE `AuditLog` MODIFY `reason` TEXT NULL;
