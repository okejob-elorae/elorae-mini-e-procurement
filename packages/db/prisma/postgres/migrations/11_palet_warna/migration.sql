-- Palet warna tim kreatif.
--
-- `harmony` disimpan sebagai teks, bukan enum: daftar aturannya hidup di
-- `lib/creative/palet/harmoni.ts` dan dijaga oleh `periksaPalet` sebelum
-- ditulis. Menambah aturan baru tidak perlu migrasi.
--
-- `colors` berisi tepat lima hex `#rrggbb` huruf kecil, warna dasar di posisi
-- ketiga. Hex, bukan posisi roda: palet yang tersimpan harus tampil sama persis
-- walau cara roda menghitung suatu hari diubah.
CREATE TABLE IF NOT EXISTS "ColorPalette" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "harmony" TEXT NOT NULL,
    "colors" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColorPalette_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ColorPalette_createdAt_idx" ON "ColorPalette"("createdAt");

CREATE INDEX IF NOT EXISTS "ColorPalette_createdById_idx" ON "ColorPalette"("createdById");
