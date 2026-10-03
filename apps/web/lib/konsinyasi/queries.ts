import { prisma } from '@elorae/db';
import {
  bandingkanLaporan,
  giliranTahap,
  stokTitipan,
  tahapSiklus,
  type BarisBanding,
  type TahapSiklus,
} from './aturan';
import { pencocokanSiklus, penandaTerjualSiklus, type PencocokanSiklus } from "./pencocokan-queries";
import type { PenandaCocok } from "./pencocokan";
import { promoEloraeSiklus } from "./promo-elorae-queries";
import { totalTagihanKonsi } from "./promo-elorae";

const angka = (v: unknown): number => Number(v ?? 0);

export type BarisSiklus = {
  id: string;
  noKonsi: string;
  storeId: string;
  storeName: string;
  periode: string;
  tahap: TahapSiklus;
  giliran: ReturnType<typeof giliranTahap>;
  nilaiTerjual: number;
  noNota: string | null;
  noFakturPajak: string | null;
  tenggatSpg: string | null;
  /** Tenggat gaji SPG sudah lewat dan masih ada yang belum dibayar. */
  gajiTerlambat: boolean;
  /**
   * Buku stok toko vs laporan SPG vs laporan toko (bagian terjual saja), untuk
   * siklus yang belum dikunci. null = sudah dikunci, atau belum ada dua sumber
   * yang bisa dibandingkan.
   */
  penandaCocok: PenandaCocok | null;
};

function bahan(c: {
  reports: { source: string }[];
  lockedAt: Date | null;
  commissions: { paidAt: Date | null }[];
  noNota: string | null;
  noFakturPajak: string | null;
}) {
  const sumber = new Set(c.reports.map((r) => r.source));
  return {
    adaLaporanSpg: sumber.has('SPG'),
    adaLaporanToko: sumber.has('TOKO'),
    terkunci: c.lockedAt !== null,
    adaSpg: c.commissions.length > 0,
    semuaKomisiDibayar: c.commissions.every((k) => k.paidAt !== null),
    adaNota: Boolean(c.noNota),
    adaFakturPajak: Boolean(c.noFakturPajak),
  };
}

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Daftar siklus, yang perlu dikerjakan lebih dulu. */
export async function daftarSiklus(): Promise<BarisSiklus[]> {
  const rows = await prisma.consignmentCycle.findMany({
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    select: {
      id: true,
      noKonsi: true,
      storeId: true,
      periodYear: true,
      periodMonth: true,
      spgDueDate: true,
      noNota: true,
      noFakturPajak: true,
      lockedAt: true,
      store: { select: { name: true } },
      reports: { select: { source: true } },
      commissions: { select: { paidAt: true } },
      sold: { select: { amount: true } },
    },
  });

  const sekarang = new Date();
  const URUT: TahapSiklus[] = ['laporan', 'cocok', 'bayar_spg', 'nota', 'pajak', 'selesai'];
  const penanda = await penandaTerjualSiklus(rows.filter((c) => c.lockedAt === null));

  return rows
    .map((c) => {
      const tahap = tahapSiklus(bahan(c));
      return {
        id: c.id,
        noKonsi: c.noKonsi,
        storeId: c.storeId,
        storeName: c.store.name,
        periode: `${BULAN[c.periodMonth - 1]} ${c.periodYear}`,
        tahap,
        giliran: giliranTahap(tahap),
        nilaiTerjual: c.sold.reduce((s, x) => s + angka(x.amount), 0),
        noNota: c.noNota,
        noFakturPajak: c.noFakturPajak,
        tenggatSpg: c.spgDueDate?.toISOString() ?? null,
        /*
         * Gaji SPG punya tenggatnya sendiri justru supaya ia tidak lagi kalah
         * oleh pekerjaan bertenggat lain. Penandanya ikut dihitung di sini agar
         * daftar bisa menonjolkannya tanpa membaca ulang.
         */
        gajiTerlambat:
          c.spgDueDate !== null &&
          c.spgDueDate < sekarang &&
          c.commissions.some((k) => k.paidAt === null),
        penandaCocok: penanda.get(c.id) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.gajiTerlambat) - Number(a.gajiTerlambat) ||
        URUT.indexOf(a.tahap) - URUT.indexOf(b.tahap),
    );
}

export type RincianSiklus = {
  baris: BarisSiklus;
  terkunci: boolean;
  dikunciOleh: string | null;
  dikunciPada: string | null;
  laporanSpg: { itemName: string; qty: number }[] | null;
  laporanToko: { itemName: string; qty: number }[] | null;
  banding: BarisBanding[];
  resmi: { itemId: string | null; itemName: string; qty: number; price: number; amount: number; komisiPerPcs: number }[];
  komisi: {
    id: string;
    spgNama: string | null;
    gajiPokok: number;
    komisi: number;
    total: number;
    /**
     * Beban barang hilang yang SUDAH dipotong saat siklus dikunci (berbeda dari
     * beban selisih retur di bawah, yang hanya diingatkan). Yang dibayarkan =
     * `total − potonganHilang`.
     */
    potonganHilang: number;
    dibayarPada: string | null;
    /**
     * Beban selisih retur yang masih ditanggung orang ini.
     *
     * Brief bilang penagihannya "bisa dipotong dari komisi" — BISA, bukan
     * harus. Jadi angka ini TIDAK dikurangkan otomatis dari totalnya:
     * ditampilkan di layar pembayaran supaya admin tahu, dan keputusannya
     * tetap miliknya. Tanpa ini, komisi dibayar penuh sementara bebannya
     * menganggur di layar lain yang tidak pernah dibuka bersamaan.
     */
    bebanTerbuka: number;
  }[];
  titipan: { itemName: string; dikirim: number; terjual: number; sisa: number }[];
  pengiriman: { id: string; noKirim: string; tanggal: string; nilai: number; jumlahBaris: number }[];
  /** Buku stok toko vs laporan laku konsinyasi, per barang. */
  pencocokan: PencocokanSiklus;
  tagihan: TagihanSiklus;
};

/**
 * Ringkasan tagihan ke toko: laku resmi − potongan promo ditanggung Elorae +
 * beban barang hilang ke toko. Sebelum dikunci hanya potongan promo yang ada
 * (dihitung langsung dari nota); sesudahnya ketiganya dibekukan di siklus.
 */
export type TagihanSiklus = {
  beku: boolean;
  /** Σ angka resmi. null selama belum dikunci. */
  lakuResmi: number | null;
  /** Dibekukan saat dikunci; sebelum itu dihitung langsung. */
  promoElorae: number;
  /** Dihitung dari nota SPG sekarang — pembanding untuk angka yang dibekukan. */
  promoEloraeSekarang: number;
  /** Ditetapkan saat mengunci. null selama belum dikunci. */
  bebanHilang: number | null;
  /** null selama belum dikunci. */
  total: number | null;
};

/** Satu siklus, kedua laporannya, angka resminya, komisinya, dan stok titipannya. */
export async function rincianSiklus(id: string): Promise<RincianSiklus | null> {
  const c = await prisma.consignmentCycle.findUnique({
    where: { id },
    select: {
      id: true,
      noKonsi: true,
      storeId: true,
      periodYear: true,
      periodMonth: true,
      spgDueDate: true,
      noNota: true,
      noFakturPajak: true,
      lockedAt: true,
      promoBorneByElorae: true,
      lossChargedToStore: true,
      store: { select: { name: true } },
      lockedBy: { select: { name: true } },
      reports: {
        select: {
          source: true,
          items: { select: { itemName: true, qty: true } },
        },
      },
      sold: {
        select: {
          itemId: true,
          itemName: true,
          qty: true,
          price: true,
          amount: true,
          commissionPerPcs: true,
        },
      },
      commissions: {
        select: {
          id: true,
          spgUserId: true,
          baseSalary: true,
          commission: true,
          total: true,
          deduction: true,
          paidAt: true,
          spgUser: { select: { name: true } },
        },
      },
    },
  });
  if (!c) return null;

  // Pengiriman dicari lewat TOKO, bukan lewat siklus: barang bisa dikirim
  // sebelum siklus bulan itu dibuka, dan stok titipannya tetap milik toko itu.
  const kirim = await prisma.consignmentShipment.findMany({
    where: { storeId: c.storeId },
    orderBy: { shippedAt: 'desc' },
    select: {
      id: true,
      noKirim: true,
      shippedAt: true,
      items: { select: { itemName: true, qty: true, amount: true } },
    },
  });

  /*
   * Beban selisih retur yang masih ditanggung orang-orang di siklus ini.
   *
   * Dikumpulkan HANYA untuk penerima komisi di siklus ini — bukan seluruh
   * beban terbuka di perusahaan. Beban yang sudah `LUNAS` tidak ikut: yang
   * sudah dibayar tidak boleh muncul lagi sebagai peringatan.
   */
  const idPenerima = c.commissions.map((k) => k.spgUserId);
  const beban = idPenerima.length
    ? await prisma.returnCharge.findMany({
        where: {
          bearerUserId: { in: idPenerima },
          status: { not: 'LUNAS' },
        },
        select: { bearerUserId: true, amount: true },
      })
    : [];
  const bebanPerOrang = new Map<string, number>();
  for (const b of beban) {
    if (!b.bearerUserId) continue;
    bebanPerOrang.set(b.bearerUserId, (bebanPerOrang.get(b.bearerUserId) ?? 0) + angka(b.amount));
  }

  const [mutasi, pencocokan, promoSekarang, penanda] = await Promise.all([
    mutasiTitipan(c.storeId),
    pencocokanSiklus(c.id),
    promoEloraeSiklus(prisma, { storeId: c.storeId, periodYear: c.periodYear, periodMonth: c.periodMonth }),
    c.lockedAt ? Promise.resolve(new Map<string, PenandaCocok | null>()) : penandaTerjualSiklus([c]),
  ]);
  if (!pencocokan) return null;
  const terkunci = c.lockedAt !== null;
  const lakuResmi = c.sold.reduce((s, x) => s + angka(x.amount), 0);
  const tagihan: TagihanSiklus = terkunci
    ? {
        beku: true,
        lakuResmi,
        promoElorae: angka(c.promoBorneByElorae),
        promoEloraeSekarang: promoSekarang.total,
        bebanHilang: angka(c.lossChargedToStore),
        total: totalTagihanKonsi({
          lakuResmi,
          promoElorae: angka(c.promoBorneByElorae),
          bebanHilang: angka(c.lossChargedToStore),
        }),
      }
    : {
        beku: false,
        lakuResmi: null,
        promoElorae: promoSekarang.total,
        promoEloraeSekarang: promoSekarang.total,
        bebanHilang: null,
        total: null,
      };

  const spg = c.reports.find((r) => r.source === 'SPG')?.items ?? null;
  const toko = c.reports.find((r) => r.source === 'TOKO')?.items ?? null;
  const tahap = tahapSiklus(bahan({ ...c, commissions: c.commissions }));

  return {
    baris: {
      id: c.id,
      noKonsi: c.noKonsi,
      storeId: c.storeId,
      storeName: c.store.name,
      periode: `${BULAN[c.periodMonth - 1]} ${c.periodYear}`,
      tahap,
      giliran: giliranTahap(tahap),
      nilaiTerjual: c.sold.reduce((s, x) => s + angka(x.amount), 0),
      noNota: c.noNota,
      noFakturPajak: c.noFakturPajak,
      tenggatSpg: c.spgDueDate?.toISOString() ?? null,
      gajiTerlambat:
        c.spgDueDate !== null &&
        c.spgDueDate < new Date() &&
        c.commissions.some((k) => k.paidAt === null),
      penandaCocok: penanda.get(c.id) ?? null,
    },
    terkunci,
    dikunciOleh: c.lockedBy?.name ?? null,
    dikunciPada: c.lockedAt?.toISOString() ?? null,
    laporanSpg: spg,
    laporanToko: toko,
    banding: bandingkanLaporan(spg ?? [], toko ?? []),
    resmi: c.sold.map((s) => ({
      itemId: s.itemId,
      itemName: s.itemName,
      qty: s.qty,
      price: angka(s.price),
      amount: angka(s.amount),
      komisiPerPcs: angka(s.commissionPerPcs),
    })),
    komisi: c.commissions.map((k) => ({
      id: k.id,
      spgNama: k.spgUser?.name ?? null,
      gajiPokok: angka(k.baseSalary),
      komisi: angka(k.commission),
      total: angka(k.total),
      potonganHilang: angka(k.deduction),
      dibayarPada: k.paidAt?.toISOString() ?? null,
      bebanTerbuka: bebanPerOrang.get(k.spgUserId) ?? 0,
    })),
    titipan: stokTitipan(
      [...kirim.flatMap((k) => k.items.map((i) => ({ itemName: i.itemName, qty: i.qty }))), ...mutasi],
      c.sold.map((s) => ({ itemName: s.itemName, qty: s.qty })),
    ),
    pengiriman: kirim.map((k) => ({
      id: k.id,
      noKirim: k.noKirim,
      tanggal: k.shippedAt.toISOString(),
      nilai: k.items.reduce((s, i) => s + angka(i.amount), 0),
      jumlahBaris: k.items.length,
    })),
    pencocokan,
    tagihan,
  };
}

/**
 * Mutasi antar toko sebagai baris "dikirim" stok titipan, BERTANDA: barang yang
 * diterima toko ini dari toko lain (jumlah diterima, termasuk barang yang
 * kembali dari mutasi yang dibatalkan) menambah; barang yang dikirim toko ini
 * ke toko lain mengurangi; selisih yang diputuskan KEMBALI menambah lagi di toko
 * asal. Nama barang = nama master (`Item.nameId`) — nama yang sama dengan bahan
 * laporan SPG, supaya barisnya bertemu dengan barang yang sama.
 */
async function mutasiTitipan(storeId: string): Promise<{ itemName: string; qty: number }[]> {
  const [masuk, keluar, kembali] = await Promise.all([
    prisma.storeReceiptLine.findMany({
      where: { itemId: { not: null }, qtyReceived: { gt: 0 }, receipt: { storeId, sourceType: { in: ['MUTASI', 'MUTASI_KEMBALI'] } } },
      select: { itemId: true, qtyReceived: true },
    }),
    prisma.storeTransferLine.findMany({
      where: { transfer: { fromStoreId: storeId, shippedAt: { not: null }, status: { in: ['DIKIRIM', 'DITERIMA', 'DIKEMBALIKAN'] } } },
      select: { itemId: true, qty: true },
    }),
    prisma.storeStockMovement.findMany({
      where: { storeId, kind: 'MUTASI_MASUK', refType: 'StoreTransfer' },
      select: { itemId: true, qty: true },
    }),
  ]);
  const baris = [
    ...masuk.map((l) => ({ itemId: l.itemId as string, qty: l.qtyReceived })),
    ...keluar.map((l) => ({ itemId: l.itemId, qty: -l.qty })),
    ...kembali.map((l) => ({ itemId: l.itemId, qty: l.qty })),
  ];
  if (baris.length === 0) return [];
  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(baris.map((b) => b.itemId))] } },
    select: { id: true, nameId: true },
  });
  const nama = new Map(items.map((i) => [i.id, i.nameId]));
  return baris.map((b) => ({ itemName: nama.get(b.itemId) ?? b.itemId, qty: b.qty }));
}

/** Toko konsinyasi, untuk membuka siklus atau mengirim titipan. */
export async function tokoKonsi(): Promise<{ id: string; name: string }[]> {
  return prisma.store.findMany({
    where: { isActive: true, termsType: 'KONSI' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
