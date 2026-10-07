import { prisma } from "@elorae/db";
import { akhirBulanWib, stokDiToko } from "@/lib/konsinyasi/stok-di-toko";
import { gerakLakuBersih } from "@/lib/spg/laku-bersih";
import {
  rentangAnalisa,
  susunAnalisa,
  susunLaku,
  susunWawasan,
  type Analisa,
  type BarisAnalisa,
  type DasarAnalisa,
  type InfoBarangAnalisa,
  type Laku,
  type PeriodeAnalisa,
  type Wawasan,
} from "./analisa-toko";
import { bagiSen } from "./target-rinci";

/**
 * Kueri "Analisa toko" di HP salesman. Aturannya di `analisa-toko.ts`.
 *
 * Riwayat milik TOKO, siapa pun salesman yang mencatatnya — sama dengan
 * "Sering dibeli" dan saran tawar: toko yang baru dirotasi ke salesman lain
 * tidak boleh kehilangan riwayatnya.
 *
 * Sumbernya, satu dokumen satu peristiwa:
 *   putus = baris KIRIMAN (tanggal kirim) — pesanan yang belum dikirim belum
 *           sampai ke toko; rupiahnya = total kiriman dibagi ke baris sebanding
 *           nilai bersih baris (`bagiSen`, sama dengan target rinci), jadi
 *           diskon pesanan ikut;
 *   van   = penjualan mobil ke toko ini (tanggal jual);
 *   konsi = baris pesanan konsinyasi DISETUJUI (tanggal disetujui) +
 *           kiriman modul konsinyasi — "terkirim", TANPA rupiah;
 *   laku konsinyasi = laku bersih buku stok toko (`gerakLakuBersih`) bila toko
 *           punya buku, selain itu laporan laku konsinyasi (`ConsignmentSold`,
 *           per barang, bertanggal akhir bulan siklusnya) — pilihan yang sama
 *           dengan `stokDiToko`, supaya dua sumber tidak pernah dijumlahkan.
 * Baris bonus (promo "beli X gratis Y") bukan barang yang dibeli: pcs-nya nol.
 */

const angka = (v: unknown) => Number(v ?? 0);
const sen = (v: unknown) => Math.round(angka(v) * 100);

export type HasilAnalisaToko = {
  toko: { id: string; nama: string; jenis: "PUTUS" | "KONSI" };
  periode: PeriodeAnalisa;
  dasar: DasarAnalisa;
  analisa: Analisa;
  /** Hanya toko konsinyasi. */
  laku: Laku | null;
  wawasan: Wawasan[];
  /** Tidak ada riwayat sama sekali dalam periode ini maupun pembandingnya. */
  kosong: boolean;
};

export async function analisaToko(storeId: string, periode: PeriodeAnalisa, hariIni: Date): Promise<HasilAnalisaToko | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, termsType: true } });
  if (!toko) return null;
  const konsiToko = toko.termsType === "KONSI";
  const rentang = rentangAnalisa(hariIni, periode);
  const waktu = { gte: rentang.awalSebelumnya, lt: rentang.akhir };

  const [kirim, konsi, van, kirimanKonsi, stok] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: waktu, order: { storeId, orderType: "PUTUS" } },
      select: {
        deliveredAt: true,
        total: true,
        lines: {
          select: {
            itemId: true,
            variantSku: true,
            qty: true,
            unitPrice: true,
            lineTotal: true,
            discountAmount: true,
            orderLine: { select: { isBonus: true } },
          },
        },
      },
    }),
    prisma.fieldSalesOrderLine.findMany({
      where: { order: { storeId, orderType: "KONSI", status: "APPROVED", approvedAt: waktu } },
      select: { itemId: true, variantSku: true, qty: true, cancelledQty: true, isBonus: true, order: { select: { approvedAt: true } } },
    }),
    // Van ke toko konsinyasi bukan barang titipan — analisa konsinyasi tidak memakainya.
    konsiToko
      ? Promise.resolve([])
      : prisma.vanSale.findMany({
          where: { storeId, createdAt: waktu },
          select: { createdAt: true, total: true, lines: { select: { itemId: true, variantSku: true, qty: true, lineTotal: true } } },
        }),
    konsiToko
      ? prisma.consignmentShipmentItem.findMany({
          where: { itemId: { not: null }, shipment: { storeId, shippedAt: waktu } },
          select: { itemId: true, qty: true, shipment: { select: { shippedAt: true } } },
        })
      : Promise.resolve([]),
    konsiToko ? stokDiToko(storeId, hariIni) : Promise.resolve(null),
  ]);

  const beli: BarisAnalisa[] = [];
  for (const d of kirim) {
    if (d.lines.length === 0) continue;
    const bobot = d.lines.map((l) =>
      l.orderLine.isBonus ? 0 : (l.lineTotal !== null ? sen(l.lineTotal) : sen(angka(l.unitPrice) * l.qty)) - sen(l.discountAmount),
    );
    const bagian = bagiSen(sen(d.total), bobot);
    d.lines.forEach((l, i) =>
      beli.push({
        tanggal: d.deliveredAt,
        itemId: l.itemId,
        variantSku: l.variantSku ?? "",
        pcs: l.orderLine.isBonus ? 0 : l.qty,
        nilai: bagian[i] / 100,
      }),
    );
  }
  for (const v of van) {
    if (v.lines.length === 0) continue;
    const bagian = bagiSen(sen(v.total), v.lines.map((l) => sen(l.lineTotal)));
    v.lines.forEach((l, i) =>
      beli.push({ tanggal: v.createdAt, itemId: l.itemId, variantSku: l.variantSku ?? "", pcs: Math.round(angka(l.qty)), nilai: bagian[i] / 100 }),
    );
  }
  const terkirim: BarisAnalisa[] = [
    ...konsi.map((l) => ({
      tanggal: l.order.approvedAt as Date,
      itemId: l.itemId,
      variantSku: l.variantSku ?? "",
      pcs: l.isBonus ? 0 : l.qty - l.cancelledQty,
      nilai: null,
    })),
    ...kirimanKonsi.map((l) => ({ tanggal: l.shipment.shippedAt, itemId: l.itemId as string, variantSku: "", pcs: l.qty, nilai: null })),
  ];

  let terjual: BarisAnalisa[] = [];
  if (konsiToko && stok) {
    if (stok.source === "BUKU_TOKO") {
      const gerak = await gerakLakuBersih([{ storeId, dari: rentang.awalSebelumnya, sebelum: rentang.akhir }]);
      // JUAL ditulis negatif, retur pembeli (layak maupun rusak) positif: laku bersih = kebalikannya.
      terjual = gerak.map((g) => ({ tanggal: g.createdAt, itemId: g.itemId, variantSku: g.variantSku, pcs: -g.qty, nilai: null }));
    } else {
      const laporan = await prisma.consignmentSold.findMany({
        where: { itemId: { not: null }, cycle: { storeId } },
        select: { itemId: true, qty: true, cycle: { select: { periodYear: true, periodMonth: true } } },
      });
      terjual = laporan
        .map((s) => {
          const akhir = akhirBulanWib(s.cycle.periodYear, s.cycle.periodMonth);
          return { tanggal: akhir > hariIni ? hariIni : akhir, itemId: s.itemId as string, variantSku: "", pcs: s.qty, nilai: null };
        })
        .filter((s) => s.tanggal >= rentang.awalSebelumnya && s.tanggal < rentang.akhir);
    }
  }

  const itemIds = new Set<string>([...beli, ...terkirim, ...terjual].map((b) => b.itemId));
  for (const s of stok?.baris ?? []) itemIds.add(s.itemId);
  const barangRows = itemIds.size
    ? await prisma.item.findMany({
        where: { id: { in: [...itemIds] } },
        select: { id: true, sku: true, nameId: true, categoryId: true, variants: true },
      })
    : [];
  const barang = new Map<string, InfoBarangAnalisa>(
    barangRows.map((b) => [b.id, { nama: b.nameId, sku: b.sku, kategoriId: b.categoryId, variants: b.variants }]),
  );
  const kategoriIds = [...new Set(barangRows.map((b) => b.categoryId).filter((x): x is string => !!x))];
  const kategoriRows = kategoriIds.length
    ? await prisma.itemCategory.findMany({ where: { id: { in: kategoriIds } }, select: { id: true, name: true } })
    : [];
  const kategori = new Map(kategoriRows.map((k) => [k.id, k.name]));

  const laku =
    konsiToko && stok
      ? susunLaku({
          sumber: stok.source,
          rentang,
          terkirim,
          terjual,
          stok: stok.baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, qty: b.qty, firstInAt: b.firstInAt })),
          barang,
          hariIni,
        })
      : null;

  const dasar: DasarAnalisa = !konsiToko ? "BELI" : laku?.adaDataLaku ? "LAKU" : "KIRIM";
  const bahan = dasar === "BELI" ? [...beli, ...terkirim] : dasar === "LAKU" ? terjual : terkirim;
  const analisa = susunAnalisa({ baris: bahan, barang, kategori, rentang, tampilNilai: !konsiToko });

  const kosong =
    analisa.totalPcs === 0 &&
    analisa.totalPcsSebelumnya === 0 &&
    analisa.tren.every((t) => t.pcs === 0) &&
    (!laku || (laku.terkirimPcs === 0 && laku.lakuPcs === 0 && laku.sisaPcs === 0));

  return {
    toko: { id: toko.id, nama: toko.name, jenis: toko.termsType },
    periode,
    dasar,
    analisa,
    laku,
    wawasan: kosong ? [] : susunWawasan(analisa, laku),
    kosong,
  };
}
