-- Warna pilihan pemilik (2026-10-09): "warna-warna ini, apakah tidak bisa di custom juga? biarkan saya yang pilih".
-- * SupplierType.color: warna jenis pemasok (#rrggbb) untuk lencana, kartu galeri, dan papan pemasok.
--   NULL = warna otomatis (lib/ui/category-color.ts).
-- * User.chartColors: warna grafik beranda pilihan orang itu sendiri (JSON {slot: "#rrggbb"}, lihat
--   lib/tampilan/warna-pilihan.ts). NULL = ikut tema.
ALTER TABLE "SupplierType" ADD COLUMN "color" TEXT;
ALTER TABLE "User" ADD COLUMN "chartColors" TEXT;
