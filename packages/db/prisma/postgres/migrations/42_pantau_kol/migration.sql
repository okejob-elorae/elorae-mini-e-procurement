-- Pantau KOL lewat ekstensi Chrome — uji coba TikTok (2026-10-08).
-- Rancangan: docs/superpowers/specs/2026-10-08-pantau-kol-ekstensi-design.md
--
-- * KolPerangkat: komputer/profil Chrome yang menjalankan ekstensi. Kode
--   sambung (8 huruf, 15 menit, sekali pakai) dan token (32 byte acak)
--   disimpan HANYA sebagai sha256-nya. Perangkat tidak pernah dihapus —
--   dicabut (dicabutAt) atau dijeda (dijedaSampai).
-- * KolTugasPantau: antrean pengecekan. `kunci` unik
--   (KONTEN:<contentId>:H<n> / PROFIL:<accountId>:<YYYY-MM-DD WIB>) adalah
--   penjaga dobelnya. Dipinjam satu perangkat (DIPINJAM, pinjamSampai = lease).
-- * KolLogPantau: log hasil/masalah/sambung/jeda/lanjut — bahan hitungan
--   kuota harian dan aturan "gagal beruntun".
-- * KolAccount: ER akun terukur, rata-rata views, kapan terakhir dicek dan
--   hasilnya (OK / TIDAK_DITEMUKAN / PRIVAT / TIDAK_TERBACA).
-- * KolFollowerSnapshot: ER/rata-rata views/jumlah posting yang dihitung,
--   perangkat sumbernya. KolContentMetric: perangkat sumbernya.
-- Tanpa foreign key (relationMode = prisma).

ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "er" DECIMAL(6,2);
ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "avgViews" INTEGER;
ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "erUpdatedAt" TIMESTAMP(3);
ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "platformUserId" TEXT;
ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);
ALTER TABLE "KolAccount" ADD COLUMN IF NOT EXISTS "checkStatus" TEXT;

ALTER TABLE "KolFollowerSnapshot" ADD COLUMN IF NOT EXISTS "er" DECIMAL(6,2);
ALTER TABLE "KolFollowerSnapshot" ADD COLUMN IF NOT EXISTS "avgViews" INTEGER;
ALTER TABLE "KolFollowerSnapshot" ADD COLUMN IF NOT EXISTS "postsCounted" INTEGER;
ALTER TABLE "KolFollowerSnapshot" ADD COLUMN IF NOT EXISTS "perangkatId" TEXT;

ALTER TABLE "KolContentMetric" ADD COLUMN IF NOT EXISTS "perangkatId" TEXT;

CREATE TABLE IF NOT EXISTS "KolPerangkat" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "dibuatOlehId" TEXT NOT NULL,
    "kodeHash" TEXT,
    "kodeBerlakuSampai" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tersambungAt" TIMESTAMP(3),
    "terakhirLaporAt" TIMESTAMP(3),
    "dicabutAt" TIMESTAMP(3),
    "dijedaSampai" TIMESTAMP(3),
    "alasanJeda" TEXT,
    "versiEkstensi" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolPerangkat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KolPerangkat_kodeHash_key" ON "KolPerangkat"("kodeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "KolPerangkat_tokenHash_key" ON "KolPerangkat"("tokenHash");
CREATE INDEX IF NOT EXISTS "KolPerangkat_dibuatOlehId_idx" ON "KolPerangkat"("dibuatOlehId");

CREATE TABLE IF NOT EXISTS "KolTugasPantau" (
    "id" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "platform" "KolPlatform" NOT NULL,
    "accountId" TEXT,
    "contentId" TEXT,
    "url" TEXT NOT NULL,
    "titikH" INTEGER,
    "prioritas" INTEGER NOT NULL DEFAULT 0,
    "jatuhAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ANTRE',
    "perangkatId" TEXT,
    "pinjamSampai" TIMESTAMP(3),
    "percobaan" INTEGER NOT NULL DEFAULT 0,
    "galatTerakhir" TEXT,
    "selesaiAt" TIMESTAMP(3),
    "kunci" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KolTugasPantau_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KolTugasPantau_kunci_key" ON "KolTugasPantau"("kunci");
CREATE INDEX IF NOT EXISTS "KolTugasPantau_status_jatuhAt_idx" ON "KolTugasPantau"("status", "jatuhAt");
CREATE INDEX IF NOT EXISTS "KolTugasPantau_perangkatId_idx" ON "KolTugasPantau"("perangkatId");
CREATE INDEX IF NOT EXISTS "KolTugasPantau_accountId_idx" ON "KolTugasPantau"("accountId");
CREATE INDEX IF NOT EXISTS "KolTugasPantau_contentId_idx" ON "KolTugasPantau"("contentId");

CREATE TABLE IF NOT EXISTS "KolLogPantau" (
    "id" TEXT NOT NULL,
    "perangkatId" TEXT,
    "tugasId" TEXT,
    "jenis" TEXT NOT NULL,
    "kode" TEXT,
    "pesan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KolLogPantau_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KolLogPantau_createdAt_idx" ON "KolLogPantau"("createdAt");
CREATE INDEX IF NOT EXISTS "KolLogPantau_perangkatId_idx" ON "KolLogPantau"("perangkatId");
