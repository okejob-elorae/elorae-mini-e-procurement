import { runSerializable } from "@/lib/db/tx-retry";
import { createProductPushRow, fireProductPushNow } from "@/lib/jubelio/product-push";
import { ALASAN_KIRIMAN, bedaDiJubelio, hargaKeTeks, MAKS_LEPAS_TAHANAN } from "./aturan";
import { idKirimanTertahanSiapDilepas } from "./queries";

export type HasilLepasTahanan = { dilepas: number; dilewati: number; gagal: number };

/**
 * Melepas kiriman produk yang DITAHAN karena beda harga (jawaban pemilik P75, 2026-11-02: kiriman
 * lain ke Jubelio ditahan selama ada peringatan beda harga — "ditahan" sampai diputuskan, lalu
 * dikirim). Sapuan web tiap 5 menit: barang yang kiriman TERAKHIR-nya `price_differs_held`, masih
 * terpetakan di Jubelio, sudah tidak BEDA (mis. harganya dikembalikan sendiri di Jubelio ke harga
 * ERP), dan tidak punya kiriman yang sedang berjalan mendapat SATU kiriman baru — potret penuh, jadi
 * perubahan nama, foto, varian atau status aktif yang ditahan ikut sampai ke Jubelio. Keputusan harga
 * (kirim ulang, konfirmasi) membawa perubahan yang ditahan dengan kirimannya sendiri.
 *
 * Setiap barang di `runSerializable`-nya sendiri: keempat syarat dibaca ulang di dalamnya, jadi dua
 * sapuan bersamaan tidak pernah membuat dua kiriman, dan pemetaan yang terhapus di antara kueri dan
 * transaksi tidak pernah berubah menjadi kiriman pembuat produk. Paling banyak `MAKS_LEPAS_TAHANAN` per putaran.
 * `itemIds` membatasi sapuan — SETIAP tes WAJIB memberikannya (basis data uji :3308 dipakai bersama).
 */
export async function lepaskanKirimanHargaTertahan(options?: { itemIds?: string[] }): Promise<HasilLepasTahanan> {
  const ids = (await idKirimanTertahanSiapDilepas({ hanyaBarang: options?.itemIds })).slice(0, MAKS_LEPAS_TAHANAN);
  let dilepas = 0;
  let dilewati = 0;
  let gagal = 0;
  for (const itemId of ids) {
    let rowId: string | null = null;
    try {
      rowId = await runSerializable(async (tx): Promise<string | null> => {
        const terakhir = await tx.jubelioOutbox.findFirst({
          where: { entityType: "product_push", entityId: itemId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { status: true, skipReason: true },
        });
        if (!(terakhir?.status === "SKIPPED" && terakhir.skipReason === ALASAN_KIRIMAN.DITAHAN)) return null;
        const [jumlahDikirim, jumlahPeta, barang] = await Promise.all([
          tx.jubelioOutbox.count({
            where: { entityType: "product_push", entityId: itemId, status: { in: ["PENDING", "PROCESSING"] } },
          }),
          tx.jubelioProductMapping.count({ where: { itemId } }),
          tx.item.findUnique({
            where: { id: itemId },
            select: {
              type: true,
              jubelioConfirmedPrice: true,
              jubelioObservedPriceMax: true,
              jubelioObservedPriceMin: true,
              jubelioObservedAt: true,
              jubelioObservedChangedAt: true,
              jubelioPriceDecidedAt: true,
            },
          }),
        ]);
        // Tanpa pemetaan (mis. produknya dihapus dari Jubelio sejak kueri tadi) tidak ada yang
        // ditahan lagi: kiriman penuh untuk barang yang tidak terpetakan MEMBUAT produk baru di
        // Jubelio tanpa diminta siapa pun, jadi dilewati. `bedaDiJubelio` saja tidak cukup — untuk
        // barang tak terpetakan ia mengembalikan "tidak beda".
        if (jumlahDikirim > 0 || jumlahPeta === 0 || !barang) return null;
        const masihBeda = bedaDiJubelio({
          barangJadi: barang.type === "FINISHED_GOOD",
          terpetakan: jumlahPeta > 0,
          terbacaPada: barang.jubelioObservedAt,
          jubelioTertinggi: hargaKeTeks(barang.jubelioObservedPriceMax),
          jubelioTerendah: hargaKeTeks(barang.jubelioObservedPriceMin),
          hargaTerkonfirmasi: hargaKeTeks(barang.jubelioConfirmedPrice),
          diputuskanPada: barang.jubelioPriceDecidedAt,
          berubahPada: barang.jubelioObservedChangedAt,
          sedangDikirim: false,
        });
        if (masihBeda) return null;
        return (await createProductPushRow(tx, itemId, null)).id;
      });
    } catch (err) {
      gagal++;
      console.error(`[jubelio-harga-tahan] barang ${itemId} gagal dilepas; diulang putaran berikutnya`, err);
      continue;
    }
    if (rowId) {
      dilepas++;
      fireProductPushNow(rowId, null);
    } else {
      dilewati++;
    }
  }
  return { dilepas, dilewati, gagal };
}
