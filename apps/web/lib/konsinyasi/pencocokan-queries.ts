import { prisma } from "@elorae/db";
import { rentangBulanWib } from "./laporan-spg";
import {
  buatPenyelesaiKunci,
  kunciNama,
  penandaDariTerjual,
  pilihTerjualBulan,
  susunPencocokan,
  titipanPerBarang,
  type BahanBulan,
  type BahanStok,
  type DasarTerjual,
  type HasilPencocokan,
  type JumlahBarang,
  type PenandaCocok,
} from "./pencocokan";

/**
 * Pemuat pencocokan buku stok toko vs laporan laku konsinyasi. Aturannya di
 * `pencocokan.ts`; di sini hanya mengambil bahan dari basis data.
 */

const BULAN_WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" });
/** "2026-09" — bulan kalender Jakarta sebuah instant. */
const bulanDari = (d: Date): string => BULAN_WIB.format(d);
const periodeKunci = (tahun: number, bulan: number): string => `${tahun}-${String(bulan).padStart(2, "0")}`;

type BarisNama = { itemId: string | null; itemName: string; qty: number };
type Penyelesai = (itemId: string | null | undefined, nama: string) => string;

/** Master barang untuk kunci + nama tampil: yang terlibat (id) dan yang namanya disebut laporan. */
async function muatPenyelesai(idTerlibat: Iterable<string>, namaDisebut: Iterable<string>) {
  const ids = [...new Set(idTerlibat)];
  const names = [...new Set(namaDisebut)].filter((n) => n.trim());
  const items =
    ids.length || names.length
      ? await prisma.item.findMany({
          where: { OR: [{ id: { in: ids } }, { nameId: { in: names } }] },
          select: { id: true, nameId: true, sku: true },
        })
      : [];
  const terlibat = new Set(ids);
  const kunci = buatPenyelesaiKunci({ terlibat: items.filter((i) => terlibat.has(i.id)), semua: items });
  return { kunci, items };
}

function keJumlah(baris: BarisNama[], kunci: Penyelesai): JumlahBarang[] {
  return baris.map((b) => ({ kunci: kunci(b.itemId, b.itemName), qty: b.qty }));
}

export type PencocokanSiklus = HasilPencocokan & {
  adaBuku: boolean;
  /** Gerakan buku stok pertama toko ini (ISO), kalau ada. */
  bukuMulai: string | null;
  /** Buku dimulai di tengah bulan siklus — terjual menurut buku hanya sejak tanggal itu. */
  bukuMulaiTengahBulan: boolean;
  sumber: { buku: boolean; nota: boolean; laporanSpg: boolean; laporanToko: boolean; resmi: boolean };
  /** Bulan (sampai bulan siklus) yang terjualnya untuk stok titipan belum resmi. */
  bulanSementara: { periode: string; dasar: DasarTerjual }[];
};

/** Pencocokan satu siklus. null kalau siklusnya tidak ada. */
export async function pencocokanSiklus(cycleId: string): Promise<PencocokanSiklus | null> {
  const c = await prisma.consignmentCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, storeId: true, periodYear: true, periodMonth: true, lockedAt: true },
  });
  if (!c) return null;
  const storeId = c.storeId;
  const { awal, akhir } = rentangBulanWib(c.periodYear, c.periodMonth);
  const periodeIni = periodeKunci(c.periodYear, c.periodMonth);

  const [pertama, siklus, nota] = await Promise.all([
    prisma.storeStockMovement.findFirst({ where: { storeId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    // Semua siklus toko ini sampai bulan siklus: laporan & angka resmi bulan
    // ini, dan dasar terjual bulan-bulan sebelumnya untuk stok titipan.
    prisma.consignmentCycle.findMany({
      where: {
        storeId,
        OR: [{ periodYear: { lt: c.periodYear } }, { periodYear: c.periodYear, periodMonth: { lte: c.periodMonth } }],
      },
      select: {
        id: true,
        periodYear: true,
        periodMonth: true,
        lockedAt: true,
        reports: { select: { source: true, items: { select: { itemId: true, itemName: true, qty: true } } } },
        sold: { select: { itemId: true, itemName: true, qty: true } },
      },
    }),
    prisma.spgSaleLine.findMany({
      where: { spgSale: { storeId, createdAt: { gte: awal, lt: akhir } } },
      select: { itemId: true, qty: true, returnedQty: true },
    }),
  ]);
  const adaBuku = pertama !== null && pertama.createdAt < akhir;

  // Bulan yang sudah dikunci (selain bulan siklus) tidak butuh angka buku untuk
  // stok titipan — angka resminya yang dipakai.
  const bulanResmiLain = siklus
    .filter((s) => s.lockedAt && !(s.periodYear === c.periodYear && s.periodMonth === c.periodMonth))
    .map((s) => rentangBulanWib(s.periodYear, s.periodMonth));

  const stokMentah = adaBuku
    ? await (async () => {
        const [gerakJual, saldo, pesanan, kiriman, terimaMutasi, mutasiKeluar, mutasiKembali, retur, diterima, returKeluar, rusak, hilang] =
          await Promise.all([
            prisma.storeStockMovement.findMany({
              where: {
                storeId,
                kind: { in: ["JUAL", "RETUR_PEMBELI"] },
                createdAt: { lt: akhir },
                ...(bulanResmiLain.length > 0
                  ? { NOT: bulanResmiLain.map((r) => ({ createdAt: { gte: r.awal, lt: r.akhir } })) }
                  : {}),
              },
              select: { itemId: true, qty: true, createdAt: true },
            }),
            prisma.storeStockMovement.groupBy({
              by: ["itemId"],
              where: { storeId, createdAt: { lt: akhir } },
              _sum: { qty: true },
            }),
            prisma.fieldSalesOrderLine.findMany({
              where: {
                order: {
                  storeId,
                  orderType: "KONSI",
                  status: "APPROVED",
                  OR: [{ approvedAt: { lt: akhir } }, { approvedAt: null, createdAt: { lt: akhir } }],
                },
              },
              select: { itemId: true, qty: true, cancelledQty: true, order: { select: { id: true, approvedAt: true, createdAt: true } } },
            }),
            // Baris kiriman yang diketik nama saja tidak pernah masuk buku toko —
            // dilewati, sama dengan `muatStokDiToko`.
            prisma.consignmentShipmentItem.findMany({
              where: { itemId: { not: null }, shipment: { storeId, shippedAt: { lt: akhir } } },
              select: { itemId: true, qty: true, shipment: { select: { id: true, shippedAt: true } } },
            }),
            prisma.storeReceiptLine.findMany({
              where: {
                itemId: { not: null },
                qtyReceived: { gt: 0 },
                receipt: { storeId, sourceType: { in: ["MUTASI", "MUTASI_KEMBALI"] }, receivedAt: { lt: akhir } },
              },
              select: { itemId: true, qtyReceived: true },
            }),
            prisma.storeTransferLine.findMany({
              where: {
                transfer: { fromStoreId: storeId, shippedAt: { lt: akhir }, status: { in: ["DIKIRIM", "DITERIMA", "DIKEMBALIKAN"] } },
              },
              select: { itemId: true, qty: true },
            }),
            prisma.storeStockMovement.findMany({
              where: { storeId, kind: "MUTASI_MASUK", refType: "StoreTransfer", createdAt: { lt: akhir } },
              select: { itemId: true, qty: true },
            }),
            // NRI yang sudah FINAL sebelum akhir bulan: NRI DRAFT belum melepas apa pun.
            prisma.warehouseReturnItem.findMany({
              where: {
                itemId: { not: null },
                warehouseReturn: {
                  storeId,
                  status: "FINAL",
                  OR: [{ finalisedAt: { lt: akhir } }, { finalisedAt: null, receivedAt: { lt: akhir } }],
                },
              },
              select: { itemId: true, qty: true },
            }),
            prisma.storeReceipt.findMany({
              where: { storeId, sourceType: { in: ["KONSI_ORDER", "KONSI_SHIPMENT"] }, receivedAt: { lt: akhir } },
              select: { sourceType: true, sourceId: true },
            }),
            prisma.storeStockMovement.findMany({
              where: { storeId, kind: "RETUR_KELUAR", refType: "StoreReturn", createdAt: { lt: akhir } },
              select: { itemId: true, qty: true, refId: true },
            }),
            prisma.storeReceiptLine.findMany({
              where: { itemId: { not: null }, qtyDamaged: { gt: 0 }, receipt: { storeId, receivedAt: { lt: akhir } } },
              select: { id: true, itemId: true, qtyDamaged: true, damageStatus: true, damageDecidedAt: true },
            }),
            // Barang hilang yang sudah dicatat dan sudah memotong buku tapi tidak titipan.
            prisma.stockLossLine.findMany({
              where: {
                itemId: { not: null },
                loss: { storeId, source: { in: ["OPNAME", "PENERIMAAN"] }, status: { not: "BATAL" }, createdAt: { lt: akhir } },
              },
              select: { itemId: true, qty: true },
            }),
          ]);

        const idNrt = [...new Set(returKeluar.map((r) => r.refId).filter((x): x is string => Boolean(x)))];
        const idRusak = rusak.map((r) => r.id);
        const [nriNrt, rusakKembali] = await Promise.all([
          idNrt.length
            ? prisma.warehouseReturn.findMany({
                where: { storeReturnId: { in: idNrt } },
                select: { storeReturnId: true, status: true, finalisedAt: true, receivedAt: true },
              })
            : Promise.resolve([]),
          idRusak.length
            ? prisma.storeReturnItem.findMany({
                where: { storeReceiptLineId: { in: idRusak } },
                select: {
                  storeReceiptLineId: true,
                  qty: true,
                  storeReturn: { select: { warehouseReturn: { select: { status: true, finalisedAt: true, receivedAt: true } } } },
                },
              })
            : Promise.resolve([]),
        ]);
        return { gerakJual, saldo, pesanan, kiriman, terimaMutasi, mutasiKeluar, mutasiKembali, retur, diterima, returKeluar, rusak, nriNrt, rusakKembali, hilang };
      })()
    : null;

  const sudahDihitungGudang = (w: { status: string; finalisedAt: Date | null; receivedAt: Date } | null | undefined) =>
    Boolean(w && w.status === "FINAL" && (w.finalisedAt ?? w.receivedAt) < akhir);

  // Kunci barang: id terlibat + nama yang disebut laporan/angka resmi tanpa id.
  const semuaLaporan = siklus.flatMap((s) => [...s.reports.flatMap((r) => r.items), ...s.sold]);
  const idTerlibat = [
    ...nota.map((n) => n.itemId),
    ...semuaLaporan.map((x) => x.itemId).filter((x): x is string => Boolean(x)),
    ...(stokMentah
      ? [
          ...stokMentah.gerakJual.map((g) => g.itemId),
          ...stokMentah.saldo.map((g) => g.itemId),
          ...stokMentah.pesanan.map((g) => g.itemId),
          ...stokMentah.kiriman.map((g) => g.itemId as string),
          ...stokMentah.terimaMutasi.map((g) => g.itemId as string),
          ...stokMentah.mutasiKeluar.map((g) => g.itemId),
          ...stokMentah.mutasiKembali.map((g) => g.itemId),
          ...stokMentah.retur.map((g) => g.itemId as string),
          ...stokMentah.returKeluar.map((g) => g.itemId),
          ...stokMentah.rusak.map((g) => g.itemId as string),
          ...stokMentah.hilang.map((g) => g.itemId as string),
        ]
      : []),
  ];
  const { kunci, items } = await muatPenyelesai(
    idTerlibat,
    semuaLaporan.filter((x) => !x.itemId).map((x) => x.itemName),
  );

  const nama = new Map<string, { nama: string; sku: string | null; itemId: string | null }>();
  for (const i of items) nama.set(i.id, { nama: i.nameId, sku: i.sku, itemId: i.id });
  for (const x of semuaLaporan) {
    const k = kunci(x.itemId, x.itemName);
    if (!nama.has(k)) nama.set(k, { nama: x.itemName.trim(), sku: null, itemId: k === kunciNama(x.itemName) ? null : k });
  }

  // Terjual menurut buku per bulan: JUAL (−) dan RETUR_PEMBELI (+) → laku bersih.
  const bukuPerBulan = new Map<string, JumlahBarang[]>();
  for (const g of stokMentah?.gerakJual ?? []) {
    const p = bulanDari(g.createdAt);
    const d = bukuPerBulan.get(p) ?? [];
    d.push({ kunci: g.itemId, qty: -g.qty });
    bukuPerBulan.set(p, d);
  }

  const ini = siklus.find((s) => s.id === c.id);
  const laporanIni = (src: "SPG" | "TOKO") => {
    const r = ini?.reports.find((x) => x.source === src);
    return r ? keJumlah(r.items, kunci) : null;
  };
  const terjual = {
    buku: adaBuku ? (bukuPerBulan.get(periodeIni) ?? []) : null,
    // Nota SPG tanpa buku dan tanpa nota bulan ini = toko ini tidak punya SPG
    // yang mencatat: tidak ada pembanding, bukan "terjual 0".
    nota: adaBuku || nota.length > 0 ? nota.map((n) => ({ kunci: n.itemId, qty: n.qty - n.returnedQty })) : null,
    laporanSpg: laporanIni("SPG"),
    laporanToko: laporanIni("TOKO"),
    resmi: c.lockedAt && ini ? keJumlah(ini.sold, kunci) : null,
  };

  let stok: BahanStok | null = null;
  const bulanSementara: { periode: string; dasar: DasarTerjual }[] = [];
  if (stokMentah && pertama) {
    const s = stokMentah;
    const masuk: JumlahBarang[] = [
      ...s.pesanan.map((l) => ({ kunci: l.itemId, qty: l.qty - l.cancelledQty })),
      ...s.kiriman.map((l) => ({ kunci: l.itemId as string, qty: l.qty })),
      ...s.terimaMutasi.map((l) => ({ kunci: l.itemId as string, qty: l.qtyReceived })),
      ...s.mutasiKeluar.map((l) => ({ kunci: l.itemId, qty: -l.qty })),
      ...s.mutasiKembali.map((l) => ({ kunci: l.itemId, qty: l.qty })),
    ];

    // Dasar terjual per bulan: siklus yang ada, dan bulan-bulan berbuku tanpa siklus.
    const bahan = new Map<string, BahanBulan>();
    for (const x of siklus) {
      const lap = (src: "SPG" | "TOKO") => {
        const r = x.reports.find((y) => y.source === src);
        return r ? keJumlah(r.items, kunci) : null;
      };
      bahan.set(periodeKunci(x.periodYear, x.periodMonth), {
        resmi: x.lockedAt ? keJumlah(x.sold, kunci) : null,
        laporanToko: lap("TOKO"),
        laporanSpg: lap("SPG"),
        buku: null,
      });
    }
    for (const [p, baris] of bukuPerBulan) {
      const ada = bahan.get(p) ?? { resmi: null, laporanToko: null, laporanSpg: null, buku: null };
      bahan.set(p, { ...ada, buku: baris });
    }
    const terjualTitipan: JumlahBarang[] = [];
    for (const p of [...bahan.keys()].sort()) {
      const pilih = pilihTerjualBulan(bahan.get(p) as BahanBulan);
      terjualTitipan.push(...pilih.baris);
      if (pilih.dasar && pilih.dasar !== "RESMI") bulanSementara.push({ periode: p, dasar: pilih.dasar });
    }

    // Kiriman yang sudah jalan (sejak buku dimulai) tapi belum diterima SPG
    // sampai akhir bulan. Kiriman sebelum buku dimulai masuk lewat opname pembuka.
    const sudah = new Set(s.diterima.map((r) => `${r.sourceType}:${r.sourceId}`));
    const mulai = pertama.createdAt;
    const kirimanBelum: JumlahBarang[] = [
      ...s.pesanan
        .filter((l) => (l.order.approvedAt ?? l.order.createdAt) >= mulai && !sudah.has(`KONSI_ORDER:${l.order.id}`))
        .map((l) => ({ kunci: l.itemId, qty: l.qty - l.cancelledQty })),
      ...s.kiriman
        .filter((l) => l.shipment.shippedAt >= mulai && !sudah.has(`KONSI_SHIPMENT:${l.shipment.id}`))
        .map((l) => ({ kunci: l.itemId as string, qty: l.qty })),
    ];

    // Retur yang sudah keluar dari buku (RETUR_KELUAR, bersih dari pembaliknya)
    // tapi NRI-nya belum final sampai akhir bulan.
    const nriPerNrt = new Map(s.nriNrt.map((w) => [w.storeReturnId as string, w]));
    const returBelum = s.returKeluar
      .filter((r) => !r.refId || !sudahDihitungGudang(nriPerNrt.get(r.refId)))
      .map((r) => ({ kunci: r.itemId, qty: -r.qty }));

    // Rusak saat diterima yang belum masuk buku: belum diputuskan LAYAK_JUAL
    // sebelum akhir bulan, dikurangi yang sudah kembali ke gudang lewat NRI final.
    const kembaliPerBaris = new Map<string, number>();
    for (const k of s.rusakKembali) {
      if (!k.storeReceiptLineId || !sudahDihitungGudang(k.storeReturn.warehouseReturn)) continue;
      kembaliPerBaris.set(k.storeReceiptLineId, (kembaliPerBaris.get(k.storeReceiptLineId) ?? 0) + k.qty);
    }
    const rusakBelum = s.rusak
      .filter((r) => !(r.damageStatus === "LAYAK_JUAL" && r.damageDecidedAt && r.damageDecidedAt < akhir))
      .map((r) => ({ kunci: r.itemId as string, qty: Math.max(0, r.qtyDamaged - (kembaliPerBaris.get(r.id) ?? 0)) }));

    stok = {
      buku: s.saldo.map((g) => ({ kunci: g.itemId, qty: g._sum.qty ?? 0 })),
      titipan: titipanPerBarang({
        masuk,
        terjual: terjualTitipan,
        retur: s.retur.map((r) => ({ kunci: r.itemId as string, qty: r.qty })),
      }),
      kirimanBelumDiterima: kirimanBelum,
      returBelumDihitung: returBelum,
      rusakBelumMasukBuku: rusakBelum,
      hilangTercatat: s.hilang.map((l) => ({ kunci: l.itemId as string, qty: l.qty })),
    };
  }

  const hasil = susunPencocokan({ nama, terjual, stok });
  return {
    ...hasil,
    adaBuku,
    bukuMulai: pertama?.createdAt.toISOString() ?? null,
    bukuMulaiTengahBulan: adaBuku && pertama !== null && pertama.createdAt > awal,
    sumber: {
      buku: terjual.buku !== null,
      nota: terjual.nota !== null,
      laporanSpg: terjual.laporanSpg !== null,
      laporanToko: terjual.laporanToko !== null,
      resmi: terjual.resmi !== null,
    },
    bulanSementara,
  };
}

/**
 * Penanda Cocok/Selisih untuk daftar siklus — HANYA bagian terjual (buku vs
 * laporan SPG vs laporan toko), dan hanya untuk siklus yang belum dikunci:
 * itu yang murah dihitung beramai-ramai (satu bulan buku per siklus, bukan
 * seluruh riwayat titipan), dan itu yang masih bisa ditindaklanjuti sebelum
 * angka resmi dikunci. Definisinya sama persis dengan bagian terjual di rincian.
 */
export async function penandaTerjualSiklus(
  daftar: { id: string; storeId: string; periodYear: number; periodMonth: number }[],
): Promise<Map<string, PenandaCocok | null>> {
  const hasil = new Map<string, PenandaCocok | null>();
  if (daftar.length === 0) return hasil;
  const storeIds = [...new Set(daftar.map((d) => d.storeId))];
  const rentang = new Map(daftar.map((d) => [d.id, rentangBulanWib(d.periodYear, d.periodMonth)]));

  const [laporan, pertama, gerak] = await Promise.all([
    prisma.consignmentReport.findMany({
      where: { cycleId: { in: daftar.map((d) => d.id) } },
      select: { cycleId: true, source: true, items: { select: { itemId: true, itemName: true, qty: true } } },
    }),
    prisma.storeStockMovement.groupBy({ by: ["storeId"], where: { storeId: { in: storeIds } }, _min: { createdAt: true } }),
    prisma.storeStockMovement.findMany({
      where: {
        kind: { in: ["JUAL", "RETUR_PEMBELI"] },
        OR: daftar.map((d) => {
          const r = rentang.get(d.id) as { awal: Date; akhir: Date };
          return { storeId: d.storeId, createdAt: { gte: r.awal, lt: r.akhir } };
        }),
      },
      select: { storeId: true, itemId: true, qty: true, createdAt: true },
    }),
  ]);

  const barisLaporan = laporan.flatMap((l) => l.items);
  const { kunci } = await muatPenyelesai(
    [...barisLaporan.map((l) => l.itemId).filter((x): x is string => Boolean(x)), ...gerak.map((g) => g.itemId)],
    barisLaporan.filter((l) => !l.itemId).map((l) => l.itemName),
  );
  const mulai = new Map(pertama.map((p) => [p.storeId, p._min.createdAt]));

  for (const d of daftar) {
    const r = rentang.get(d.id) as { awal: Date; akhir: Date };
    const m = mulai.get(d.storeId);
    const adaBuku = Boolean(m && m < r.akhir);
    const lap = (src: "SPG" | "TOKO") => {
      const r = laporan.find((l) => l.cycleId === d.id && l.source === src);
      return r ? keJumlah(r.items, kunci) : null;
    };
    const buku = adaBuku
      ? gerak
          .filter((g) => g.storeId === d.storeId && g.createdAt >= r.awal && g.createdAt < r.akhir)
          .map((g) => ({ kunci: g.itemId, qty: -g.qty }))
      : null;
    hasil.set(d.id, penandaDariTerjual({ buku, laporanSpg: lap("SPG"), laporanToko: lap("TOKO") }));
  }
  return hasil;
}
