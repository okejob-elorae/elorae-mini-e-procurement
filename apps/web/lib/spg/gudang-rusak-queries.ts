import { prisma, type Prisma } from "@elorae/db";
import {
  REF_BARIS_NRI,
  REF_PENYESUAIAN,
  asalBarisNri,
  bacaJenisGerakRusak,
  kunciRusak,
  sisaKirimBalikPembeli,
  type AsalRusak,
  type JenisGerakRusak,
  type KondisiRusak,
} from "./gudang-rusak";

/**
 * Bacaan gudang barang rusak — layar kantor, layar HP SPG (barang rusak dari
 * pembeli yang belum dikirim balik), dan formulir nota retur yang diisi dari
 * retur pembeli (`?dariReturPembeli=`).
 *
 * Hanya untuk server (menarik Prisma). Komponen klien hanya boleh
 * `import type` dari sini; nilai yang aman ada di `gudang-rusak.ts`.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

/** Gerakan terakhir di layar kantor. */
export const BATAS_RIWAYAT_GUDANG_RUSAK = 100;

// ---------------------------------------------------------------------------
// Asal gerakan masuk
// ---------------------------------------------------------------------------

export type AsalMasuk = {
  noNri: string;
  toko: string | null;
  noNrt: string | null;
  asal: AsalRusak[];
};

/** Asal setiap gerakan masuk (per baris NRI): nomor NRI/NRT, toko, dan jalan barangnya. */
async function asalPerBarisNri(klien: Klien, lineIds: string[]): Promise<Map<string, AsalMasuk>> {
  const hasil = new Map<string, AsalMasuk>();
  const ids = [...new Set(lineIds.filter(Boolean))];
  if (ids.length === 0) return hasil;
  const rows = await klien.warehouseReturnItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      itemId: true,
      variantSku: true,
      warehouseReturn: {
        select: {
          noNri: true,
          store: { select: { name: true } },
          storeReturn: {
            select: {
              noNrt: true,
              store: { select: { name: true } },
              items: { select: { itemId: true, variantSku: true, condition: true, spgSaleReturnLineId: true, storeReceiptLineId: true } },
            },
          },
        },
      },
    },
  });
  for (const r of rows) {
    const nri = r.warehouseReturn;
    hasil.set(r.id, {
      noNri: nri.noNri,
      toko: nri.store?.name ?? nri.storeReturn?.store.name ?? null,
      noNrt: nri.storeReturn?.noNrt ?? null,
      asal: asalBarisNri(r, nri.storeReturn),
    });
  }
  return hasil;
}

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

// ---------------------------------------------------------------------------
// Kantor
// ---------------------------------------------------------------------------

export type SaldoGudangRusak = {
  kunci: string;
  itemId: string;
  variantSku: string;
  sku: string;
  productName: string;
  saldo: number;
  masuk: number;
  keluar: number;
  /** Dari gerakan masuk barang ini: per toko + jalan barangnya, dengan jumlahnya. */
  asal: { toko: string | null; asal: AsalRusak[]; qty: number }[];
};

/**
 * Saldo per barang × varian yang masih bersisa (≠ 0), urut nama. Asalnya dari
 * seluruh gerakan masuk barang itu — saldo tidak dilacak per asal, jadi angka
 * asal adalah jumlah yang pernah MASUK, bukan sisa.
 */
export async function saldoGudangRusak(): Promise<SaldoGudangRusak[]> {
  const grup = await prisma.damagedStockMovement.groupBy({ by: ["itemId", "variantSku"], _sum: { qty: true } });
  const bersisa = grup.filter((g) => (g._sum.qty ?? 0) !== 0);
  if (bersisa.length === 0) return [];
  const kunciBersisa = bersisa.map((g) => ({ itemId: g.itemId, variantSku: g.variantSku }));

  const [gerak, barang] = await Promise.all([
    prisma.damagedStockMovement.findMany({
      where: { OR: kunciBersisa },
      orderBy: { createdAt: "asc" },
      select: { itemId: true, variantSku: true, productName: true, qty: true, kind: true, refType: true, refId: true },
    }),
    prisma.item.findMany({
      where: { id: { in: [...new Set(kunciBersisa.map((k) => k.itemId))] } },
      select: { id: true, sku: true, nameId: true },
    }),
  ]);
  const asalNri = await asalPerBarisNri(
    prisma,
    gerak.filter((g) => g.kind === "MASUK_RETUR" && g.refType === REF_BARIS_NRI && g.refId).map((g) => g.refId as string),
  );
  const perBarang = new Map(barang.map((b) => [b.id, b]));

  const baris = new Map<string, SaldoGudangRusak>();
  for (const k of kunciBersisa) {
    const b = perBarang.get(k.itemId);
    baris.set(kunciRusak(k.itemId, k.variantSku), {
      kunci: kunciRusak(k.itemId, k.variantSku),
      itemId: k.itemId,
      variantSku: k.variantSku,
      sku: k.variantSku || b?.sku || "",
      productName: b?.nameId ?? k.itemId,
      saldo: 0,
      masuk: 0,
      keluar: 0,
      asal: [],
    });
  }
  for (const g of gerak) {
    const r = baris.get(kunciRusak(g.itemId, g.variantSku));
    if (!r) continue;
    r.saldo += g.qty;
    r.productName = g.productName || r.productName;
    if (g.qty > 0) r.masuk += g.qty;
    else r.keluar += -g.qty;
    if (g.kind === "MASUK_RETUR") {
      const a = g.refId ? asalNri.get(g.refId) : undefined;
      const toko = a?.toko ?? null;
      const jalan = a?.asal ?? ["TANPA_NOTA"];
      const sama = r.asal.find((x) => x.toko === toko && x.asal.join() === jalan.join());
      if (sama) sama.qty += g.qty;
      else r.asal.push({ toko, asal: jalan, qty: g.qty });
    }
  }
  return [...baris.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku));
}

export type GerakGudangRusak = {
  id: string;
  createdAt: Date;
  itemId: string;
  variantSku: string;
  productName: string;
  jenis: JenisGerakRusak | null;
  qty: number;
  nilai: number | null;
  catatan: string | null;
  oleh: string;
  /** Gerakan masuk: dari hitungan gudang mana. */
  masuk: AsalMasuk | null;
  /** PERBAIKI: nomor penyesuaian stok jualnya. */
  penyesuaian: string | null;
};

/** Gerakan terbaru (masuk dan keputusan), terbaru dulu. */
export async function riwayatGudangRusak(batas = BATAS_RIWAYAT_GUDANG_RUSAK): Promise<GerakGudangRusak[]> {
  const rows = await prisma.damagedStockMovement.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batas,
    select: {
      id: true,
      createdAt: true,
      itemId: true,
      variantSku: true,
      productName: true,
      qty: true,
      kind: true,
      refType: true,
      refId: true,
      value: true,
      note: true,
      createdById: true,
    },
  });
  const idNri = rows.filter((r) => r.refType === REF_BARIS_NRI && r.refId).map((r) => r.refId as string);
  const idAdj = rows.filter((r) => r.refType === REF_PENYESUAIAN && r.refId).map((r) => r.refId as string);
  const [asal, nama, adj] = await Promise.all([
    asalPerBarisNri(prisma, idNri),
    namaPengguna(rows.map((r) => r.createdById)),
    idAdj.length
      ? prisma.stockAdjustment.findMany({ where: { id: { in: idAdj } }, select: { id: true, docNumber: true } })
      : Promise.resolve([]),
  ]);
  const docAdj = new Map(adj.map((a) => [a.id, a.docNumber]));
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    itemId: r.itemId,
    variantSku: r.variantSku,
    productName: r.productName,
    jenis: bacaJenisGerakRusak(r.kind),
    qty: r.qty,
    nilai: r.value === null ? null : Number(r.value),
    catatan: r.note,
    oleh: nama.get(r.createdById) ?? "—",
    masuk: r.refType === REF_BARIS_NRI && r.refId ? (asal.get(r.refId) ?? null) : null,
    penyesuaian: r.refType === REF_PENYESUAIAN && r.refId ? (docAdj.get(r.refId) ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// HP SPG — barang rusak dari pembeli
// ---------------------------------------------------------------------------

/**
 * Barang rusak dari pembeli yang sudah dikirim balik per baris retur pembeli:
 * jumlah baris nota retur yang menunjuknya, dari nota yang TIDAK batal, beserta
 * nomornya.
 */
export async function dikirimPerReturPembeli(klien: Klien, lineIds: string[]): Promise<Map<string, { qty: number; nota: string[] }>> {
  const hasil = new Map<string, { qty: number; nota: string[] }>();
  const ids = [...new Set(lineIds.filter(Boolean))];
  if (ids.length === 0) return hasil;
  const rows = await klien.storeReturnItem.findMany({
    where: { spgSaleReturnLineId: { in: ids }, storeReturn: { status: { not: "BATAL" } } },
    select: { spgSaleReturnLineId: true, qty: true, storeReturn: { select: { noNrt: true } } },
  });
  for (const r of rows) {
    const k = r.spgSaleReturnLineId as string;
    const x = hasil.get(k) ?? { qty: 0, nota: [] };
    x.qty += r.qty;
    if (!x.nota.includes(r.storeReturn.noNrt)) x.nota.push(r.storeReturn.noNrt);
    hasil.set(k, x);
  }
  return hasil;
}

export type RusakPembeliHp = {
  /** Id baris retur pembeli (`SpgSaleReturnLine`). */
  id: string;
  itemId: string;
  variantSku: string;
  productName: string;
  kondisi: KondisiRusak;
  /** Rusak yang dikembalikan pembeli di baris ini. */
  qty: number;
  /** Yang masih harus dikirim balik. */
  sisa: number;
  docNo: string;
  dikembalikanPada: Date;
  alasan: string;
  notaRetur: string[];
};

const PILIH_RUSAK_PEMBELI = {
  id: true,
  itemId: true,
  variantSku: true,
  qty: true,
  condition: true,
  saleLine: { select: { productName: true } },
  saleReturn: { select: { createdAt: true, reason: true, storeId: true, spgSale: { select: { docNo: true } } } },
} satisfies Prisma.SpgSaleReturnLineSelect;

type RusakPembeliMentah = Prisma.SpgSaleReturnLineGetPayload<{ select: typeof PILIH_RUSAK_PEMBELI }>;

async function bentukRusakPembeli(klien: Klien, rows: RusakPembeliMentah[]): Promise<RusakPembeliHp[]> {
  const dikirim = await dikirimPerReturPembeli(
    klien,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const k = dikirim.get(r.id);
    return {
      id: r.id,
      itemId: r.itemId,
      variantSku: r.variantSku,
      productName: r.saleLine.productName,
      kondisi: r.condition === "EXPIRED" ? "EXPIRED" : "RUSAK",
      qty: r.qty,
      sisa: sisaKirimBalikPembeli(r.qty, k?.qty ?? 0),
      docNo: r.saleReturn.spgSale.docNo,
      dikembalikanPada: r.saleReturn.createdAt,
      alasan: r.saleReturn.reason,
      notaRetur: k?.nota ?? [],
    };
  });
}

/**
 * Barang rusak dari pembeli di toko ini yang BELUM dikirim balik — untuk HP
 * SPG (layar Terima kiriman). Milik toko, bukan milik SPG yang mencatat: rekan
 * setoko boleh mengirimnya balik. Tanpa harga. Terlama dulu.
 */
export async function rusakPembeliUntukSpg(storeId: string): Promise<RusakPembeliHp[]> {
  const rows = await prisma.spgSaleReturnLine.findMany({
    where: { condition: { in: ["RUSAK", "EXPIRED"] }, saleReturn: { storeId } },
    orderBy: [{ saleReturn: { createdAt: "asc" } }, { id: "asc" }],
    select: PILIH_RUSAK_PEMBELI,
  });
  return (await bentukRusakPembeli(prisma, rows)).filter((r) => r.sisa > 0);
}

/**
 * Baris retur pembeli yang boleh mengisi nota retur SPG
 * (`/pwa/retur/baru?dariReturPembeli=`): milik toko ini, RUSAK/EXPIRED, dan
 * masih bersisa. Penulis nota retur memeriksa ulang semuanya di transaksinya.
 */
export async function barisReturPembeliUntukRetur(storeId: string, ids: string[]): Promise<RusakPembeliHp[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.spgSaleReturnLine.findMany({
    where: { id: { in: ids }, condition: { in: ["RUSAK", "EXPIRED"] }, saleReturn: { storeId } },
    orderBy: [{ saleLine: { productName: "asc" } }, { id: "asc" }],
    select: PILIH_RUSAK_PEMBELI,
  });
  return (await bentukRusakPembeli(prisma, rows)).filter((r) => r.sisa > 0);
}
