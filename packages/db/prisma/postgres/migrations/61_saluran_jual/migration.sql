-- Saluran jual per barang jadi dan satu aturan rekomendasi harga (jawaban pemilik 2026-11-02, P1-P4a
-- dan P71-P76, docs/superpowers/specs/2026-11-02-pertanyaan-lanjutan.md).
--
-- Item."salesChannel" (MARKETPLACE | OFFLINE | BOTH): di mana barang jadi dijual, dipilih dengan dua
--   centang di formulir barang dan impor barang oleh pemegang items:create / items:edit (P3, P76).
--   Hanya MARKETPLACE dan BOTH yang diajukan / dikirim ke Jubelio; OFFLINE tidak pernah dikirim (P3a),
--   kecuali produk yang SUDAH di Jubelio lalu dijadikan OFFLINE dinonaktifkan di sana dengan satu
--   kiriman produk (P72, is_active false; tidak ada yang dihapus). MARKETPLACE tidak tampil di
--   pemilih jual offline; dokumen yang sudah memuatnya tetap dihormati (P73).
-- Item."priceRuleBasis" (MARKUP | MARGIN): dasar satu persen rekomendasi di targetMarginPercent (P4,
--   P4a). JubelioPushDefaults."defaultPriceRuleBasis" = dasar persen bawaan; pasangannya dipakai utuh.
-- Item."jubelioObservedPriceMax" / Min / At / ChangedAt: yang terakhir TERBACA di Jubelio - harga
--   varian tertinggi (P1) dan terendah - hanya ditulis lewat @elorae/db recordJubelioObservedPrice
--   (impor katalog, pengamat harga api, kiriman produk yang berhasil) dan createItemFromIngest.
--   Tidak pernah disalin ke sellingPrice.
-- Item."jubelioPriceDecidedAt": kapan admin terakhir memutuskan harga yang harus tampil di Jubelio
--   (konfirmasi, kembalikan, "Kirim ulang harga ERP"). Harga Jubelio yang berbeda dari harga
--   terkonfirmasi tanpa keputusan sesudahnya = peringatan turunan "Harga di Jubelio berbeda dengan
--   ERP" (P2); selama terbuka tidak ada kiriman yang boleh mengubah harga Jubelio (P75), kiriman
--   produk ditahan sebagai price_differs_held.
--
-- Nilai bawaan kolom adalah isian awalnya; tidak ada UPDATE: salesChannel = BOTH (barang lama tetap
-- di katalog offline, pengajuan dan pemetaan Jubelio tidak tersentuh; juga saluran barang dari impor
-- katalog, P71); priceRuleBasis = MARKUP (persen lama tetap dihitung dengan rumus yang sama); kolom
-- terbaca tetap NULL sampai bacaan pertama sesudah deploy (tidak ada peringatan palsu atau kiriman
-- tertahan di hari pertama); jubelioPriceDecidedAt tetap NULL. Image lama tidak menyebut kolom-kolom
-- ini, jadi sisipannya mendapat BOTH / MARKUP.
--
-- Tanpa indeks, tanpa FOREIGN KEY (relationMode = prisma), tanpa seed. Aman dijalankan ulang.

DO $$ BEGIN
  CREATE TYPE "ItemSalesChannel" AS ENUM ('MARKETPLACE', 'OFFLINE', 'BOTH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PriceRuleBasis" AS ENUM ('MARKUP', 'MARGIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "salesChannel" "ItemSalesChannel" NOT NULL DEFAULT 'BOTH';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "priceRuleBasis" "PriceRuleBasis" NOT NULL DEFAULT 'MARKUP';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioObservedPriceMax" DECIMAL(14,2);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioObservedPriceMin" DECIMAL(14,2);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioObservedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioObservedChangedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "jubelioPriceDecidedAt" TIMESTAMP(3);

ALTER TABLE "JubelioPushDefaults" ADD COLUMN IF NOT EXISTS "defaultPriceRuleBasis" "PriceRuleBasis" NOT NULL DEFAULT 'MARKUP';
