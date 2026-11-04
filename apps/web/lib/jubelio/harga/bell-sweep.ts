import { prisma } from "@elorae/db";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { hargaKeTeks, JUBELIO_PRICE_DIFFERS, MAKS_PENGUMUMAN_BEDA } from "./aturan";
import { buildBedaHargaBellCopy } from "./bell-copy";
import { idHargaBedaDiJubelio } from "./queries";

export type HasilSapuanLoncengBeda = { scanned: number; announced: number; deferred: number; failed: number };

const KOSONG: HasilSapuanLoncengBeda = { scanned: 0, announced: 0, deferred: 0, failed: 0 };

/** Kunci "sudah diumumkan": satu pemberitahuan per barang per perubahan bacaan Jubelio. */
const kunci = (itemId: string, berubahPada: string | null) => `${itemId}|${berubahPada ?? ""}`;

/**
 * Lonceng "Harga di Jubelio berbeda dengan ERP" (jawaban pemilik P2, 2026-11-02: "langsung ada
 * warning alert"). Sapuan web saja — apps/api hanya MENCATAT bacaan Jubelio, tidak pernah
 * mengabari siapa pun. Satu `JUBELIO_PRICE_DIFFERS` per (barang, `jubelioObservedChangedAt`):
 * bacaan yang sama tidak diumumkan dua kali, perubahan baru di Jubelio diumumkan lagi. Paling
 * banyak `MAKS_PENGUMUMAN_BEDA` per putaran, terlama dulu, supaya satu gelombang bacaan pertama
 * sesudah deploy tidak mendorong kategori lain keluar dari halaman pertama lonceng.
 *
 * `itemIds` membatasi sapuan; tanpa itu menyapu semua barang BEDA. SETIAP tes WAJIB memberikannya —
 * basis data uji :3308 juga berisi data pengembangan sungguhan.
 */
export async function runJubelioPriceDiffBellSweep(options?: {
  itemIds?: string[];
  now?: Date;
  maxAnnouncementsPerRun?: number;
}): Promise<HasilSapuanLoncengBeda> {
  const cap = options?.maxAnnouncementsPerRun ?? MAKS_PENGUMUMAN_BEDA;
  const calon = await idHargaBedaDiJubelio({ hanyaBarang: options?.itemIds });
  if (calon.length === 0) return KOSONG;

  /*
   * Sengaja TANPA `take` dan tanpa batas waktu: baris-baris ini satu-satunya catatan bahwa sebuah
   * bacaan sudah diumumkan, jadi baris di luar jendela akan diumumkan ulang setiap putaran.
   */
  const lama = await prisma.adminNotification.findMany({
    where: { category: JUBELIO_PRICE_DIFFERS },
    select: { metadata: true },
  });
  const sudah = new Set<string>();
  for (const r of lama) {
    const m = r.metadata as { itemId?: unknown; berubahPada?: unknown } | null;
    if (typeof m?.itemId === "string") sudah.add(kunci(m.itemId, typeof m.berubahPada === "string" && m.berubahPada ? m.berubahPada : null));
  }

  const baru = calon.filter((c) => !sudah.has(kunci(c.itemId, c.berubahPada)));
  const diumumkan = baru.slice(0, cap);
  const deferred = baru.length - diumumkan.length;
  if (diumumkan.length === 0) return { scanned: calon.length, announced: 0, deferred, failed: 0 };

  const barang = await prisma.item.findMany({
    where: { id: { in: diumumkan.map((c) => c.itemId) } },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      jubelioConfirmedPrice: true,
      jubelioObservedPriceMax: true,
      jubelioObservedPriceMin: true,
    },
  });
  const perId = new Map(barang.map((b) => [b.id, b]));

  let announced = 0;
  let failed = 0;
  for (const c of diumumkan) {
    const b = perId.get(c.itemId);
    if (!b) continue;
    const jubelioTertinggi = hargaKeTeks(b.jubelioObservedPriceMax);
    const jubelioTerendah = hargaKeTeks(b.jubelioObservedPriceMin);
    const hargaTerkonfirmasi = hargaKeTeks(b.jubelioConfirmedPrice);
    const { title, message } = buildBedaHargaBellCopy({
      sku: b.sku,
      nama: b.nameId || b.nameEn || b.sku,
      jubelioTertinggi,
      jubelioTerendah,
      hargaTerkonfirmasi,
    });
    /**
     * Baris AdminNotification adalah penanda "sudah diumumkan". Gagal sebelum baris itu tertulis →
     * belum diumumkan, diulang putaran berikutnya. `fanOutAdminNotification` tidak pernah melempar
     * dan ditunggu di sini hanya karena ini cron tanpa pengguna yang menunggu.
     */
    try {
      // Skalar datar saja: `toFcmData` membuang selain itu.
      const notification = await prisma.adminNotification.create({
        data: {
          category: JUBELIO_PRICE_DIFFERS,
          severity: "WARNING",
          title,
          message,
          metadata: {
            itemId: b.id,
            sku: b.sku,
            berubahPada: c.berubahPada ?? "",
            hargaJubelio: jubelioTertinggi ?? "",
            hargaErp: hargaTerkonfirmasi ?? "",
          },
        },
      });
      await fanOutAdminNotification(notification);
    } catch (err) {
      failed++;
      console.error(`[jubelio-harga-beda] barang ${c.itemId} gagal diumumkan; diulang putaran berikutnya`, err);
      continue;
    }
    announced++;
  }
  return { scanned: calon.length, announced, deferred, failed };
}
