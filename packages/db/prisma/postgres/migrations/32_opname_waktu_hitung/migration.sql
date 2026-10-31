-- Waktu hitung per baris opname toko (2026-10-05).
--
-- Opname toko dibandingkan dengan saldo buku SAAT BARANG ITU DIHITUNG, bukan
-- saat opname disimpan: penjualan atau kiriman yang tercatat di antaranya
-- belum dialami rak yang dihitung. Kolom ini mencatat kapan baris dihitung;
-- `qtySystem` adalah saldo pada waktu itu. Kosong = baris lama atau klien yang
-- tidak mengirim waktu hitung — berlaku `StoreOpname.countedAt`.
ALTER TABLE "StoreOpnameLine" ADD COLUMN "countedAt" TIMESTAMP(3);
