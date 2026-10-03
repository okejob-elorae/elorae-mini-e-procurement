import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { capaianRinciSpg } from "@/lib/salesman/target-rinci-queries";
import { variantDetailForSku } from "@/lib/items/variants";
import { bacaTargetBulan, bulanWib, KUNCI_TARGET } from "@/lib/salesman/pengaturan";
import { kirimanMenunggu } from "./kiriman";
import { hampirHabis, kunciBaris } from "./stok";
import { komisiPutusResmiSaya, perkiraanKomisiHp, type PerkiraanKomisiHp } from "./komisi-queries";
import type { DasarKomisi } from "./pengaturan";

/**
 * Kueri layar SPG. SEMUA dibatasi ke toko tetap SPG (`User.assignedStoreId`)
 * atau ke SPG itu sendiri — HP SPG tidak pernah memuat toko lain.
 */

const angka = (v: unknown) => Number(v ?? 0);
const HARI_MS = 86_400_000;
/** Batas "hampir habis" di toko: 2 potong atau kurang. */
export const BATAS_HAMPIR_HABIS = 2;

/** Awal hari & awal bulan menurut kalender Jakarta, sebagai instant UTC. */
function awalHariWib(d: Date): Date {
  return new Date(`${kunciHariWib(d)}T00:00:00+07:00`);
}
function awalBulanWib(d: Date): Date {
  return new Date(`${bulanWib(d)}-01T00:00:00+07:00`);
}

export type TokoSpg = { id: string; name: string; code: string; address: string; termsType: "PUTUS" | "KONSI"; lat: number | null; lng: number | null };

export async function tokoSpg(userId: string): Promise<TokoSpg | null> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return null;
  const s = await prisma.store.findUnique({
    where: { id: me.assignedStoreId },
    select: { id: true, name: true, code: true, address: true, termsType: true, lat: true, lng: true },
  });
  if (!s) return null;
  return { ...s, lat: s.lat === null ? null : angka(s.lat), lng: s.lng === null ? null : angka(s.lng) };
}

export type BarisStok = {
  itemId: string;
  variantSku: string;
  sku: string;
  nama: string;
  varian: string | null;
  qty: number;
};

/** Stok toko: setiap barang yang pernah bergerak di toko ini, dengan saldonya. */
export async function stokToko(storeId: string): Promise<BarisStok[]> {
  const grup = await prisma.storeStockMovement.groupBy({
    by: ["itemId", "variantSku"],
    where: { storeId },
    _sum: { qty: true },
  });
  if (grup.length === 0) return [];
  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(grup.map((g) => g.itemId))] } },
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return grup
    .map((g) => {
      const item = byId.get(g.itemId);
      return {
        itemId: g.itemId,
        variantSku: g.variantSku,
        sku: g.variantSku || item?.sku || "",
        nama: item?.nameId ?? g.itemId,
        varian: item ? variantDetailForSku(item.variants, g.variantSku || null) : null,
        qty: g._sum.qty ?? 0,
      };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama) || a.sku.localeCompare(b.sku));
}

/**
 * Satu nota di daftar HP. `total`/`jumlahBarang` = angka di kertas nota;
 * `totalBersih`/`barangBersih` = sesudah barang yang dikembalikan pembeli —
 * yang dipakai ringkasan "Hari ini", sama dengan "Bulan ini".
 */
export type NotaSingkat = { id: string; docNo: string; waktu: string; total: number; jumlahBarang: number; totalBersih: number; barangBersih: number };

export async function notaSpg(userId: string, opsi: { sejak?: Date; batas?: number } = {}): Promise<NotaSingkat[]> {
  const rows = await prisma.spgSale.findMany({
    where: { salesmanId: userId, ...(opsi.sejak ? { createdAt: { gte: opsi.sejak } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opsi.batas ?? 50,
    select: { id: true, docNo: true, createdAt: true, total: true, lines: { select: { qty: true, returnedQty: true, lineTotal: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    waktu: r.createdAt.toISOString(),
    total: angka(r.total),
    jumlahBarang: r.lines.reduce((n, l) => n + l.qty, 0),
    // Bersih dari barang yang dikembalikan pembeli (termasuk separuh retur dari tukar barang).
    totalBersih: Math.round(r.lines.reduce((n, l) => n + (l.qty > 0 ? (angka(l.lineTotal) * (l.qty - l.returnedQty)) / l.qty : 0), 0) * 100) / 100,
    barangBersih: r.lines.reduce((n, l) => n + l.qty - l.returnedQty, 0),
  }));
}

export type Terlaris = { itemId: string; variantSku: string; nama: string; qty: number };

/** Barang paling laku di toko ini (semua SPG-nya), 30 hari terakhir. */
export async function terlarisToko(storeId: string, hariIni: Date, batas = 5): Promise<Terlaris[]> {
  const sejak = new Date(awalHariWib(hariIni).getTime() - 29 * HARI_MS);
  const grup = await prisma.spgSaleLine.groupBy({
    by: ["itemId", "variantSku", "productName"],
    where: { spgSale: { storeId, createdAt: { gte: sejak } } },
    _sum: { qty: true },
  });
  // Nama tampilan bisa berbeda antar nota untuk varian yang sama (label
  // varian diubah di master) — jumlahkan per varian, ambil nama terakhir.
  const peta = new Map<string, Terlaris>();
  for (const g of grup) {
    const k = kunciBaris(g.itemId, g.variantSku);
    const ada = peta.get(k);
    if (ada) ada.qty += g._sum.qty ?? 0;
    else peta.set(k, { itemId: g.itemId, variantSku: g.variantSku, nama: g.productName, qty: g._sum.qty ?? 0 });
  }
  return [...peta.values()].sort((a, b) => b.qty - a.qty).slice(0, batas);
}

export type GajiKomisi = {
  /**
   * Angka resmi, terbaru dulu: gaji + komisi siklus konsinyasi
   * (`ConsignmentCommission`) dan komisi toko putus yang ditetapkan kantor
   * (`SpgCommission`). Hanya milik SPG ini.
   */
  resmi: {
    kunci: string;
    jenis: "KONSI" | "PUTUS";
    siklusId: string | null;
    periode: string;
    toko: string;
    gaji: number;
    komisi: number;
    total: number;
    /** Beban barang hilang yang dipotong dari pembayaran ini (dibekukan saat dikunci/ditetapkan). */
    potonganHilang: number;
    /** PUTUS: potong bersih dan dasar yang dipakai saat ditetapkan. */
    potong: number | null;
    dasar: DasarKomisi | null;
    ditetapkan: string | null;
    dibayar: string | null;
  }[];
  /** Perkiraan bulan berjalan — toko konsinyasi, dan toko putus selama komisinya aktif. */
  perkiraan: PerkiraanKomisiHp | null;
};

export async function gajiKomisiSpg(userId: string, toko: TokoSpg | null, hariIni: Date): Promise<GajiKomisi> {
  const [konsi, putus, perkiraan] = await Promise.all([
    prisma.consignmentCommission.findMany({
      where: { spgUserId: userId },
      orderBy: [{ cycle: { periodYear: "desc" } }, { cycle: { periodMonth: "desc" } }],
      take: 6,
      select: {
        cycleId: true,
        baseSalary: true,
        commission: true,
        total: true,
        deduction: true,
        paidAt: true,
        cycle: { select: { periodYear: true, periodMonth: true, store: { select: { name: true } } } },
      },
    }),
    komisiPutusResmiSaya(userId, 6),
    toko ? perkiraanKomisiHp(userId, toko, hariIni) : Promise.resolve(null),
  ]);

  const resmi: GajiKomisi["resmi"] = [
    ...konsi.map((r) => ({
      kunci: `konsi:${r.cycleId}`,
      jenis: "KONSI" as const,
      siklusId: r.cycleId,
      periode: `${r.cycle.periodYear}-${String(r.cycle.periodMonth).padStart(2, "0")}`,
      toko: r.cycle.store.name,
      gaji: angka(r.baseSalary),
      komisi: angka(r.commission),
      total: angka(r.total),
      potonganHilang: angka(r.deduction),
      potong: null,
      dasar: null,
      ditetapkan: null,
      dibayar: r.paidAt ? r.paidAt.toISOString() : null,
    })),
    ...putus.map((r) => ({
      kunci: `putus:${r.id}`,
      jenis: "PUTUS" as const,
      siklusId: null,
      periode: r.periode,
      toko: r.toko,
      gaji: 0,
      komisi: r.komisi,
      total: r.komisi,
      potonganHilang: r.potonganHilang,
      potong: r.potong,
      dasar: r.dasar,
      ditetapkan: r.ditetapkan,
      dibayar: r.dibayar,
    })),
  ].sort((a, b) => b.periode.localeCompare(a.periode) || a.jenis.localeCompare(b.jenis));

  return { resmi: resmi.slice(0, 6), perkiraan };
}

export type RingkasanSpg = {
  hariIni: { nota: number; total: number; barang: number };
  bulanIni: { total: number; target: number | null };
  hariMasukBulanIni: number;
  terlaris: Terlaris[];
  hampirHabis: BarisStok[];
  stokDilacak: boolean;
  kirimanMenunggu: number;
  notaHariIni: NotaSingkat[];
  gajiKomisi: GajiKomisi;
};

/** Semua angka beranda SPG, satu panggilan. */
export async function ringkasanSpg(userId: string, toko: TokoSpg, hariIni: Date): Promise<RingkasanSpg> {
  const awalHari = awalHariWib(hariIni);
  const awalBulan = awalBulanWib(hariIni);
  const [notaHari, bulan, target, kunjungan, terlaris, stok, kiriman, gajiKomisi] = await Promise.all([
    notaSpg(userId, { sejak: awalHari, batas: 200 }),
    // Bersih dari barang yang dikembalikan pembeli — angka yang sama dengan
    // halaman Target dan papan peringkat SPG.
    capaianRinciSpg([userId], bulanWib(hariIni), hariIni),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_TARGET }, select: { value: true } }),
    prisma.storeVisit.findMany({ where: { userId, checkinAt: { gte: awalBulan } }, select: { checkinAt: true } }),
    terlarisToko(toko.id, hariIni),
    stokToko(toko.id),
    kirimanMenunggu(toko.id, hariIni),
    gajiKomisiSpg(userId, toko, hariIni),
  ]);

  return {
    hariIni: {
      nota: notaHari.length,
      total: notaHari.reduce((n, x) => n + x.totalBersih, 0),
      barang: notaHari.reduce((n, x) => n + x.barangBersih, 0),
    },
    bulanIni: { total: bulan.get(userId)?.total ?? 0, target: bacaTargetBulan(target?.value, userId, bulanWib(hariIni)) },
    hariMasukBulanIni: new Set(kunjungan.map((k) => kunciHariWib(k.checkinAt))).size,
    terlaris,
    hampirHabis: hampirHabis(stok, BATAS_HAMPIR_HABIS),
    stokDilacak: stok.length > 0,
    kirimanMenunggu: kiriman.length,
    notaHariIni: notaHari.slice(0, 5),
    gajiKomisi,
  };
}
