-- Palet warna dan warna sablon disatukan: palet bisa membawa warna kain.
--
-- `fabricHex` kosong = palet bebas (lima warna, feed/poster). Terisi = palet
-- sablon: `colors` berisi 1–6 warna sablon dan `portions` porsinya di desain,
-- sejajar dengan `colors`, berjumlah 100. Keduanya dijaga `periksaPalet`
-- sebelum ditulis; baris lama tetap sah sebagai palet bebas.
ALTER TABLE "ColorPalette" ADD COLUMN IF NOT EXISTS "fabricHex" TEXT;
ALTER TABLE "ColorPalette" ADD COLUMN IF NOT EXISTS "portions" JSONB;
