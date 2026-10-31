/**
 * Antrean push stok ERP → Jubelio (`JubelioOutbox` jenis `stock_push`).
 *
 * Dipanggil SESUDAH transaksi dokumen stok commit (GRN, penerimaan barang jadi,
 * penyesuaian manual, retur, kiriman, van, rilis inden — lihat `SUMBER_PUSH_STOK`). Tanpa ini webhook stok
 * Jubelio berikutnya menimpa angka ERP dengan angka Jubelio yang belum tahu
 * perubahannya.
 *
 * Aturan:
 *  - satu baris per BARANG, bukan per varian: penangan api
 *    (`stock-push.handler.ts`) membaca seluruh baris `InventoryValue` barang itu
 *    saat diproses dan mengirim `available` setiap variannya;
 *  - hanya barang yang punya `JubelioProductMapping` — barang lain akan
 *    dilewati penangan dengan `MISSING_MAPPING`, jadi tidak perlu diantrekan;
 *  - idempoten selama menunggu: baris PENDING untuk barang yang sama sudah
 *    cukup, karena penangan baru membaca stok saat mengklaim baris itu (sesudah
 *    commit dokumen ini). Dua pemanggil serentak bisa sama-sama menulis satu
 *    baris — tidak apa-apa, push mengirim angka mutlak, bukan selisih;
 *  - barang BERVARIAN di Jubelio (ada pemetaan dengan `erpVariantSku`) yang
 *    masih punya stok atau cadangan di baris gabungan null/"" TETAP
 *    diantrekan: penangan api melewati baris gabungan itu sendiri dan hanya
 *    mengirim baris per varian ke kodenya masing-masing. Menahan barang ini
 *    berarti perubahan stok per ukurannya tidak pernah sampai ke marketplace.
 *    Barangnya dilaporkan di `barisGabungan` dan dicatat ke log, karena stok
 *    tanpa ukuran itu memang tidak terkirim; baris gabungan kosong (0 pcs, 0
 *    ditahan) tidak dilaporkan;
 *  - best-effort: kegagalan dicatat ke log dan dikembalikan sebagai
 *    `gagal: true`, tidak pernah dilempar — termasuk opsi yang rusak. Dokumen
 *    stoknya sudah sah.
 *
 * SENGAJA tanpa "use server": ini penulis antrean, bukan titik akhir.
 */
import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { apiFetch } from "@/lib/internal-api";

/**
 * Dokumen yang memicu push — hanya dicatat di payload (`sumber`) untuk dibaca
 * orang; penangan api tidak membacanya. `ADJUSTMENT` = penyesuaian stok manual,
 * bukan pengganti untuk dokumen yang punya nama sendiri.
 */
export const SUMBER_PUSH_STOK = [
  "GRN",
  "GRN_DECLINE",
  "FG_RECEIPT",
  "ADJUSTMENT",
  "SALES_RETURN_ACCEPT",
  /** Hitungan gudang atas retur toko (NRI) — stok kembali masuk. */
  "NRI",
  /** Kirim konsinyasi ke toko. */
  "KONSI_TRANSFER",
  /** Pengiriman pesanan putus (nota). */
  "KIRIM_PUTUS",
  /** Pesanan lapangan: cadangan dibuat/dilepas (buat, setujui, tolak, batal). */
  "PESANAN_LAPANGAN",
  /** Muat dan rekonsiliasi van kanvas. */
  "VAN",
  /** Tukar barang dengan toko putus. */
  "TUKAR",
  /** Barang gudang rusak yang diperbaiki kembali ke stok jual. */
  "GUDANG_RUSAK",
  /** Retur ke pemasok. */
  "RETUR_PEMASOK",
  /** Rilis jendela pre-order: pesanan yang disetujui dicadangkan. */
  "INDEN",
  /** Sampel KOL berangkat (Kreatif → Sampel). */
  "KOL_SAMPEL",
] as const;

export type SumberPushStok = (typeof SUMBER_PUSH_STOK)[number];

export type HasilAntrePushStok = {
  /** Barang yang mendapat baris antrean baru. */
  diantrekan: string[];
  /** Barang yang sudah punya baris PENDING — tidak digandakan. */
  sudahAntre: string[];
  /** Barang tanpa pemetaan Jubelio — memang tidak dikirim. */
  tanpaPemetaan: string[];
  /**
   * Barang bervarian yang masih punya stok/cadangan di baris gabungan. Barangnya
   * tetap diantrekan (baris per ukurannya terkirim), tetapi angka baris gabungan
   * itu sendiri tidak dikirim penangan api.
   */
  barisGabungan: string[];
  gagal: boolean;
};

type KlienAntre = Pick<typeof prisma, "jubelioProductMapping" | "jubelioOutbox" | "inventoryValue">;

const JENIS: JubelioOutboxEntityType = "stock_push";

export async function antrekanPushStok(
  itemIds: readonly (string | null | undefined)[],
  opsi: { sumber: SumberPushStok; ref?: string | null; userId?: string | null; client?: KlienAntre },
): Promise<HasilAntrePushStok> {
  const hasil: HasilAntrePushStok = { diantrekan: [], sudahAntre: [], tanpaPemetaan: [], barisGabungan: [], gagal: false };
  // Semua di dalam try — juga membaca opsi dan daftar barang: penolong ini
  // dipanggil sesudah commit, jadi lemparan apa pun di sini menggagalkan aksi
  // yang dokumennya sudah sah.
  try {
    const unik = [...new Set(itemIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (unik.length === 0) return hasil;

    const klien = opsi.client ?? prisma;
    const pemetaan = await klien.jubelioProductMapping.findMany({
      where: { itemId: { in: unik } },
      select: { itemId: true, erpVariantSku: true },
    });
    const terpetakan = new Set(pemetaan.map((p) => p.itemId));
    hasil.tanpaPemetaan = unik.filter((id) => !terpetakan.has(id));
    if (terpetakan.size === 0) return hasil;

    // Barang bervarian dengan stok/cadangan di baris gabungan: TETAP diantrekan
    // (lihat aturan di atas), hanya dilaporkan.
    const bervarian = [...new Set(pemetaan.filter((p) => (p.erpVariantSku ?? "").trim() !== "").map((p) => p.itemId))];
    if (bervarian.length > 0) {
      const gabungan = await klien.inventoryValue.findMany({
        where: {
          itemId: { in: bervarian },
          OR: [{ variantSku: null }, { variantSku: "" }],
          NOT: { qtyOnHand: 0, reservedQty: 0 },
        },
        select: { itemId: true },
      });
      const berisi = new Set(gabungan.map((g) => g.itemId));
      hasil.barisGabungan = unik.filter((id) => berisi.has(id));
      if (hasil.barisGabungan.length > 0) {
        console.warn(
          `[jubelio] push stok (${opsi.sumber}${opsi.ref ? ` ${opsi.ref}` : ""}): ` +
            `barang bervarian ${hasil.barisGabungan.join(", ")} masih punya stok di baris tanpa varian — ` +
            `baris per ukurannya dikirim, baris tanpa varian tidak; pindahkan stoknya ke baris per ukuran`,
        );
      }
    }

    const menunggu = await klien.jubelioOutbox.findMany({
      where: { entityType: JENIS, entityId: { in: [...terpetakan] }, status: "PENDING" },
      select: { entityId: true },
    });
    const sudah = new Set(menunggu.map((m) => m.entityId));
    hasil.sudahAntre = unik.filter((id) => terpetakan.has(id) && sudah.has(id));

    const baru = unik.filter((id) => terpetakan.has(id) && !sudah.has(id));
    const barisBaru: string[] = [];
    for (const itemId of baru) {
      const baris = await klien.jubelioOutbox.create({
        data: {
          entityType: JENIS,
          entityId: itemId,
          payload: { sumber: opsi.sumber, ...(opsi.ref ? { ref: opsi.ref } : {}) },
          enqueuedById: opsi.userId ?? null,
        },
        select: { id: true },
      });
      hasil.diantrekan.push(itemId);
      barisBaru.push(baris.id);
    }

    // Tendang api supaya tidak menunggu poller; kalau gagal, poller mengambilnya.
    for (const id of barisBaru) {
      try {
        void apiFetch("POST", `/jubelio/outbox/enqueue/${id}`, { userId: opsi.userId ?? "" }).catch(() => {});
      } catch {
        // Barisnya sudah tertulis; poller yang mengambilnya.
      }
    }
  } catch (e) {
    hasil.gagal = true;
    try {
      console.error(
        `[jubelio] push stok tidak masuk antrean (${opsi.sumber}${opsi.ref ? ` ${opsi.ref}` : ""}); kirim manual dari halaman Jubelio`,
        e,
      );
    } catch {
      // Bahkan opsinya tidak terbaca — hasil `gagal` tetap dikembalikan.
    }
  }
  return hasil;
}
