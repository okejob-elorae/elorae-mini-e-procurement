import type { prisma, Prisma } from "@elorae/db";

/**
 * Yang menghalangi sebuah piutang dibatalkan.
 *
 * Dipakai SETIAP jalur yang membatalkan piutang (status VOIDED): membuka kunci siklus
 * konsinyasi (`bukaKunci`, tagihan siklusnya) dan "tidak jadi dikirim" pada pengiriman putus
 * (notanya, lewat `periksaNotaBolehBatal`). Piutang yang sudah disentuh uang toko tidak boleh
 * lenyap diam-diam — uangnya akan menunjuk tagihan yang sudah tidak ada.
 *
 * Ini batas BAWAH bersama, bukan seluruh aturan nota putus: `periksaNotaBolehBatal`
 * (`lib/field-sales/delivery/koreksi-nota.ts`) lebih dulu menjalankan `penghalangBatalNota`, yang
 * juga menolak BKM DITOLAK serta setoran penagih dan pelunasan toko berstatus APA PUN (P16, P33a:
 * "selama nota itu punya BKM, diperiksa atau belum"). Di sini hanya BKM DIKIRIM/TERVERIFIKASI
 * dan setoran/pelunasan PENDING; membuka kunci siklus konsi hanya memakai penghalang bersama ini.
 * Jangan melonggarkan aturan nota supaya sama dengan yang di sini.
 *
 * Diperiksa BERURUTAN, yang pertama ditemukan dikembalikan:
 * 1. `ADA_BKM` — BKM DIKIRIM atau TERVERIFIKASI menautkannya. Diperiksa atau
 *    belum sama saja (P33a: BKM yang dilaporkan berarti toko sudah menyerahkan
 *    uangnya).
 * 2. `ADA_KONTRABON` — kontrabon BERJALAN menautkannya.
 * 3. `ADA_PEMBAYARAN_TOKO` — pembayaran kantor sudah masuk (`paidAmount > 0`),
 *    atau setoran penagih / pelunasan toko masih menunggu cek.
 * 4. `ADA_TUGAS_TAGIH` — tugas tagih TERBUKA mencantumkannya.
 *
 * Hanya membaca. Pemanggil menjalankannya di dalam transaksi serializable yang
 * sama dengan pembatalannya, supaya laporan yang masuk di antaranya tidak lolos.
 */
export type KodePenghalangBatal = "ADA_BKM" | "ADA_KONTRABON" | "ADA_PEMBAYARAN_TOKO" | "ADA_TUGAS_TAGIH";

export async function penghalangBatalPiutang(
  client: Prisma.TransactionClient | typeof prisma,
  receivableId: string,
): Promise<KodePenghalangBatal | null> {
  const r = await client.receivable.findUnique({
    where: { id: receivableId },
    select: {
      storeId: true,
      paidAmount: true,
      claimLinks: {
        where: { paymentClaim: { status: { in: ["DIKIRIM", "TERVERIFIKASI"] } } },
        select: { paymentClaimId: true },
        take: 1,
      },
      collectionLinks: {
        where: { collectionNote: { status: "BERJALAN" } },
        select: { collectionNoteId: true },
        take: 1,
      },
      submissions: { where: { status: "PENDING" }, select: { id: true }, take: 1 },
      settlementInvoices: { where: { settlement: { status: "PENDING" } }, select: { id: true }, take: 1 },
    },
  });
  if (!r) return null;
  if (r.claimLinks.length > 0) return "ADA_BKM";
  if (r.collectionLinks.length > 0) return "ADA_KONTRABON";
  if (Number(r.paidAmount ?? 0) > 0 || r.submissions.length > 0 || r.settlementInvoices.length > 0) {
    return "ADA_PEMBAYARAN_TOKO";
  }
  // `receivableIds` adalah JSON: dibaca per toko lalu dicocokkan di sini, karena
  // penyaringan jalur JSON tidak andal di kedua adaptor.
  const tugas = await client.collectionTask.findMany({
    where: { storeId: r.storeId, status: "TERBUKA" },
    select: { receivableIds: true },
  });
  for (const t of tugas) {
    if (Array.isArray(t.receivableIds) && t.receivableIds.includes(receivableId)) return "ADA_TUGAS_TAGIH";
  }
  return null;
}
