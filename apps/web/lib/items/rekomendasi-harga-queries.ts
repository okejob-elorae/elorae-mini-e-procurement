// Bukan aksi server — KHUSUS SERVER, tanpa pemeriksaan izin (pemanggilnya yang memeriksa).

import type { Prisma, PrismaClient } from "@elorae/db";
import { aturanDariKolom, rekomendasiHargaJual, type HasilRekomendasi } from "./rekomendasi-harga";
import { bacaHppTerbaru } from "./riwayat-hpp-queries";

type Klien = Prisma.TransactionClient | PrismaClient;

/** Berapa barang yang HPP terbarunya dibaca bersamaan. */
const SERENTAK = 5;

/**
 * SATU rekomendasi harga per barang (jawaban pemilik P4a, 2026-11-02: Laporan HPP memakai
 * pengaturan barang, satu harga rekomendasi, tidak ada harga ganda). Masukannya persis halaman
 * barang: HPP terbaru (`bacaHppTerbaru`), aturan barang atau pasangan bawaan Pengaturan Jubelio,
 * dan bantalan margin barang atau bawaan — jadi dua WO dari barang yang sama selalu menampilkan
 * angka yang sama, dan angka itu sama dengan yang tampil di formulir barang.
 */
export async function rekomendasiUntukBarang(klien: Klien, itemIds: string[]): Promise<Map<string, HasilRekomendasi>> {
  const hasil = new Map<string, HasilRekomendasi>();
  const unik = [...new Set(itemIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unik.length === 0) return hasil;

  const [barang, bawaan] = await Promise.all([
    klien.item.findMany({
      where: { id: { in: unik } },
      select: { id: true, targetMarginPercent: true, priceRuleBasis: true, additionalCost: true },
    }),
    klien.jubelioPushDefaults.findFirst({
      select: { defaultMarginPercent: true, defaultPriceRuleBasis: true, defaultAdditionalCost: true },
    }),
  ]);
  const aturanBawaan = aturanDariKolom(bawaan?.defaultMarginPercent, bawaan?.defaultPriceRuleBasis);
  const biayaBawaan = bawaan?.defaultAdditionalCost != null ? Number(bawaan.defaultAdditionalCost) : null;

  let i = 0;
  async function pekerja() {
    for (;;) {
      const b = barang[i++];
      if (!b) return;
      const hpp = await bacaHppTerbaru(klien, b.id);
      hasil.set(
        b.id,
        rekomendasiHargaJual({
          hppTerbaru: hpp ? { perPcs: hpp.perPcs, dokumen: hpp.dokumen, tanggal: hpp.tanggal } : null,
          aturanBarang: aturanDariKolom(b.targetMarginPercent, b.priceRuleBasis),
          biayaBarang: b.additionalCost != null ? Number(b.additionalCost) : null,
          aturanBawaan,
          biayaBawaan,
        }),
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(SERENTAK, barang.length) }, pekerja));
  return hasil;
}
