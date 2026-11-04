-- Toko "Tanpa batas kredit" (keputusan pemilik 2026-11-01, pilihan C).
-- Batas kredit / faktur toko yang KOSONG kini ikut bawaan Pengaturan → Salesman di kedua
-- pemeriksaan kredit; toko dengan centang ini dibebaskan dari batas nilai dan batas faktur.
-- Arti kolomnya diputuskan di satu tempat: `batasKreditBerlaku` (apps/web/lib/salesman/kredit.ts).

ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "noCreditLimit" BOOLEAN NOT NULL DEFAULT false;
