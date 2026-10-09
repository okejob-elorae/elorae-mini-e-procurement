-- Formulir data KOL lewat link (2026-10-09).
-- Rancangan: docs/superpowers/specs/2026-10-09-formulir-data-kol-design.md
--
-- * KolFormLink: link yang dikirim ke KOL lewat WhatsApp. Token (32 byte acak)
--   disimpan HANYA sebagai sha256-nya; berlaku 14 hari; link baru mencabut
--   link aktif lain milik KOL yang sama.
-- * KolFormSubmission: satu pengiriman formulir — perubahan per kolom
--   (sebelum → sesudah; rekening/NIK/NPWP tanpa nilai) dalam JSON teks,
--   jumlah kolom yang menimpa isian kantor, dan kapan kantor menandainya dicek.
-- Tanpa foreign key (relationMode = prisma).

CREATE TABLE IF NOT EXISTS "KolFormLink" (
    "id" TEXT NOT NULL,
    "kolId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KolFormLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "KolFormLink_tokenHash_key" ON "KolFormLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "KolFormLink_kolId_idx" ON "KolFormLink"("kolId");

CREATE TABLE IF NOT EXISTS "KolFormSubmission" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "kolId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changes" TEXT NOT NULL,
    "replacedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "KolFormSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KolFormSubmission_kolId_idx" ON "KolFormSubmission"("kolId");
CREATE INDEX IF NOT EXISTS "KolFormSubmission_reviewedAt_idx" ON "KolFormSubmission"("reviewedAt");
