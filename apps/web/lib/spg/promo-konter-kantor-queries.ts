import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { ringkasPromoKonter, promoNota, type JenisPromoKonter, type KomponenPaket } from "./promo-konter";
import {
  hitungPemakaianPromo,
  keHariWib,
  statusPromoKonter,
  STATUS_PROMO_KONTER,
  type IsianPromoKonter,
  type NotaPemakaian,
  type PemakaianPromo,
  type StatusPromoKonter,
} from "./promo-konter-kantor";
import { promoKonterUntukToko } from "./promo-konter-queries";

/**
 * Kueri layar kantor "Promo konter" dan layar HP SPG "Promo di toko ini".
 * Tanggal diformat di server (WIB) — format di peramban bisa berbeda antara
 * Node dan Safari. Nama barang/kategori/toko diselesaikan di sini, supaya
 * layar tidak pernah menampilkan id.
 */

const angka = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const angkaAtauNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Batas baris yang dibaca sekaligus — layar ini untuk mengawasi, bukan ekspor. */
const BATAS_PROMO = 500;
const BATAS_NOTA_MANUAL = 500;

/** Rentang waktu nota; `storeIds` membatasi ke toko tertentu (dipakai tes, dan kelak saringan toko). */
type RentangInstan = { dari: Date | null; sampai: Date | null; storeIds?: string[] };

// ---------------------------------------------------------------------------
// Nama sasaran
// ---------------------------------------------------------------------------

type PetaNama = { barang: Map<string, string>; kategori: Map<string, string>; toko: Map<string, string> };

async function petaNama(ref: { barang: string[]; kategori: string[]; toko: string[] }): Promise<PetaNama> {
  const [barang, kategori, toko] = await Promise.all([
    ref.barang.length
      ? prisma.item.findMany({ where: { id: { in: [...new Set(ref.barang)] } }, select: { id: true, sku: true, nameId: true } })
      : [],
    ref.kategori.length ? prisma.itemCategory.findMany({ where: { id: { in: [...new Set(ref.kategori)] } }, select: { id: true, name: true } }) : [],
    ref.toko.length ? prisma.store.findMany({ where: { id: { in: [...new Set(ref.toko)] } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    barang: new Map(barang.map((b) => [b.id, b.nameId || b.sku])),
    kategori: new Map(kategori.map((k) => [k.id, k.name])),
    toko: new Map(toko.map((s) => [s.id, s.name])),
  };
}

/** Nama yang sudah dihapus dari master tetap terlihat sebagai tanda, bukan menghilang diam-diam. */
const namai = (peta: Map<string, string>, ids: string[]) => ids.map((id) => peta.get(id) ?? "—").sort((a, b) => a.localeCompare(b, "id"));

/** Satu komponen paket untuk layar: nama (bukan id) dan jumlahnya. */
export type KomponenPaketTampil = { jenis: "ITEM" | "CATEGORY"; nama: string; qty: number };

/** Komponen paket dari sasaran berjumlah (sasaran TOKO diabaikan). Sasaran lama tanpa jumlah dibaca 1. */
function komponenDariSasaran(targets: readonly { kind: string; refId: string; qty?: number | null }[]): KomponenPaket[] {
  return targets
    .filter((t) => t.kind === "ITEM" || t.kind === "CATEGORY")
    .map((t) => ({ jenis: t.kind as KomponenPaket["jenis"], refId: t.refId, qty: t.qty ?? 1 }));
}

/** Komponen dengan nama: barang tertentu dulu, lalu kategori, masing-masing urut nama. */
function namaiKomponen(peta: PetaNama, komponen: readonly KomponenPaket[]): KomponenPaketTampil[] {
  return komponen
    .map((k) => ({ jenis: k.jenis, nama: (k.jenis === "ITEM" ? peta.barang : peta.kategori).get(k.refId) ?? "—", qty: k.qty }))
    .sort((a, b) => (a.jenis === b.jenis ? a.nama.localeCompare(b.nama, "id") : a.jenis === "ITEM" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Pemakaian
// ---------------------------------------------------------------------------

/**
 * Nota SPG yang memakai promo konter (barang atau belanja) dalam rentang
 * waktu nota, dijumlahkan per promo lewat `hitungPemakaianPromo`. Nilainya nilai
 * saat nota dibuat — barang yang kemudian dikembalikan pembeli tidak mengurangi.
 */
export async function pemakaianPromoKonter(opsi: RentangInstan & { promoIds?: string[] }): Promise<Map<string, PemakaianPromo>> {
  if (opsi.promoIds && opsi.promoIds.length === 0) return new Map();
  const waktu: Prisma.DateTimeFilter = {};
  if (opsi.dari) waktu.gte = opsi.dari;
  if (opsi.sampai) waktu.lte = opsi.sampai;
  // Promo kedua di satu baris hanya tercatat di rincian (`SpgSalePromo`), bukan di `counterPromoId`.
  const dariRincian = opsi.promoIds
    ? [...new Set((await prisma.spgSalePromo.findMany({ where: { promoId: { in: opsi.promoIds } }, select: { spgSaleId: true } })).map((r) => r.spgSaleId))]
    : [];
  const pakaiPromo: Prisma.SpgSaleWhereInput = opsi.promoIds
    ? {
        OR: [
          { orderPromoId: { in: opsi.promoIds } },
          { lines: { some: { counterPromoId: { in: opsi.promoIds } } } },
          ...(dariRincian.length ? [{ id: { in: dariRincian } }] : []),
        ],
      }
    : { OR: [{ orderPromoId: { not: null } }, { lines: { some: { counterPromoId: { not: null } } } }] };
  const rows = await prisma.spgSale.findMany({
    where: {
      ...(opsi.dari || opsi.sampai ? { createdAt: waktu } : {}),
      ...(opsi.storeIds ? { storeId: { in: opsi.storeIds } } : {}),
      ...pakaiPromo,
    },
    select: {
      id: true,
      total: true,
      discountTotal: true,
      orderDiscount: true,
      manualDiscount: true,
      memberDiscount: true,
      orderPromoId: true,
      lines: {
        where: { counterPromoId: { not: null } },
        select: { counterPromoId: true, qty: true, unitPrice: true, lineTotal: true, discount: true },
      },
    },
  });
  const rincian = rows.length
    ? await prisma.spgSalePromo.findMany({ where: { spgSaleId: { in: rows.map((r) => r.id) } }, select: { spgSaleId: true, promoId: true, discount: true } })
    : [];
  const rincianPer = new Map<string, { promoId: string | null; discount: number }[]>();
  for (const r of rincian) rincianPer.set(r.spgSaleId, [...(rincianPer.get(r.spgSaleId) ?? []), { promoId: r.promoId, discount: angka(r.discount) }]);
  const nota: NotaPemakaian[] = rows.map((r) => ({
    id: r.id,
    total: angka(r.total),
    discountTotal: angka(r.discountTotal),
    orderDiscount: angka(r.orderDiscount),
    manualDiscount: angka(r.manualDiscount),
    memberDiscount: angka(r.memberDiscount),
    rincian: rincianPer.get(r.id),
    orderPromoId: r.orderPromoId,
    baris: r.lines.map((l) => ({
      counterPromoId: l.counterPromoId,
      qty: l.qty,
      unitPrice: angka(l.unitPrice),
      lineTotal: angka(l.lineTotal),
      discount: angka(l.discount),
    })),
  }));
  const hasil = hitungPemakaianPromo(nota);
  if (!opsi.promoIds) return hasil;
  const diminta = new Set(opsi.promoIds);
  return new Map([...hasil].filter(([id]) => diminta.has(id)));
}

// ---------------------------------------------------------------------------
// Daftar promo (tab "Daftar")
// ---------------------------------------------------------------------------

export type BarisPromoKantor = {
  id: string;
  name: string;
  type: JenisPromoKonter | string;
  ringkasan: string;
  semuaBarang: boolean;
  barang: string[];
  kategori: string[];
  semuaToko: boolean;
  toko: string[];
  /** Tanggal tampil (WIB), null = tanpa batas. */
  mulai: string | null;
  akhir: string | null;
  status: StatusPromoKonter;
  priority: number;
  isActive: boolean;
  /** Bagian toko konsinyasi dari potongan, persen (0 = penuh Elorae). */
  bagianToko: number;
  /** Hanya berlaku bila nota punya member. */
  memberOnly: boolean;
  /** Hanya PAKET: isi satu paket dengan nama; kosong untuk jenis lain. */
  isiPaket: KomponenPaketTampil[];
  nota: number;
  potongan: number;
};

export type DaftarPromoKantor = {
  baris: BarisPromoKantor[];
  perStatus: Record<StatusPromoKonter, number>;
  total: number;
};

const pilihDaftar = {
  id: true,
  name: true,
  type: true,
  value: true,
  buyQty: true,
  freeQty: true,
  minSubtotal: true,
  allItems: true,
  allStores: true,
  startsAt: true,
  endsAt: true,
  priority: true,
  isActive: true,
  storeSharePercent: true,
  memberOnly: true,
  targets: { select: { kind: true, refId: true, qty: true } },
} satisfies Prisma.CounterPromoSelect;

function ringkas(r: {
  type: string;
  value: unknown;
  buyQty: number | null;
  freeQty: number | null;
  minSubtotal: unknown;
  targets?: readonly { kind: string; refId: string; qty?: number | null }[];
}): string {
  return ringkasPromoKonter({
    type: r.type as JenisPromoKonter,
    value: angkaAtauNull(r.value),
    buyQty: r.buyQty,
    freeQty: r.freeQty,
    minSubtotal: angkaAtauNull(r.minSubtotal),
    // Paket menyebut jumlah potongnya ("Paket 3 potong Rp…") dari komponennya.
    komponen: r.type === "PAKET" && r.targets ? komponenDariSasaran(r.targets) : undefined,
  });
}

/**
 * Semua promo konter dengan status turunannya dan pemakaian sepanjang masa.
 * Urutan: berlaku → terjadwal → berakhir → nonaktif, lalu prioritas tertinggi.
 */
export async function daftarPromoKonterKantor(opsi: { status: StatusPromoKonter | null; sekarang?: Date }): Promise<DaftarPromoKantor> {
  const sekarang = opsi.sekarang ?? new Date();
  const rows = await prisma.counterPromo.findMany({
    select: pilihDaftar,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: BATAS_PROMO,
  });
  const perStatus = Object.fromEntries(STATUS_PROMO_KONTER.map((s) => [s, 0])) as Record<StatusPromoKonter, number>;
  const berstatus = rows.map((r) => ({ r, status: statusPromoKonter(r, sekarang) }));
  for (const b of berstatus) perStatus[b.status] += 1;
  const tampil = berstatus
    .filter((b) => !opsi.status || b.status === opsi.status)
    .sort((a, b) => STATUS_PROMO_KONTER.indexOf(a.status) - STATUS_PROMO_KONTER.indexOf(b.status));

  const ref = (kind: string) => tampil.flatMap((b) => b.r.targets.filter((t) => t.kind === kind).map((t) => t.refId));
  const [nama, pakai] = await Promise.all([
    petaNama({ barang: ref("ITEM"), kategori: ref("CATEGORY"), toko: ref("STORE") }),
    pemakaianPromoKonter({ dari: null, sampai: null, promoIds: tampil.map((b) => b.r.id) }),
  ]);

  return {
    total: rows.length,
    perStatus,
    baris: tampil.map(({ r, status }) => {
      const ids = (kind: string) => r.targets.filter((t) => t.kind === kind).map((t) => t.refId);
      const p = pakai.get(r.id);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        ringkasan: ringkas(r),
        semuaBarang: r.allItems,
        barang: r.allItems ? [] : namai(nama.barang, ids("ITEM")),
        kategori: r.allItems ? [] : namai(nama.kategori, ids("CATEGORY")),
        semuaToko: r.allStores,
        toko: r.allStores ? [] : namai(nama.toko, ids("STORE")),
        mulai: r.startsAt ? formatDisplayDate(r.startsAt) : null,
        akhir: r.endsAt ? formatDisplayDate(r.endsAt) : null,
        status,
        priority: r.priority,
        isActive: r.isActive,
        bagianToko: Number(r.storeSharePercent),
        memberOnly: r.memberOnly,
        isiPaket: r.type === "PAKET" ? namaiKomponen(nama, komponenDariSasaran(r.targets)) : [],
        nota: p?.nota ?? 0,
        potongan: p?.potongan ?? 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tab "Pemakaian"
// ---------------------------------------------------------------------------

export type BarisPemakaian = {
  id: string;
  name: string;
  ringkasan: string | null;
  nota: number;
  potongan: number;
  /** Promo belanja (nota) atau promo barang. */
  belanja: boolean;
  /** Bagian toko konsinyasi yang KINI diatur di promo ini (persen); null = promo tidak ada lagi. */
  bagianToko: number | null;
};

/**
 * Siapa menanggung potongan — dari kolom yang DIBEKUKAN di baris nota
 * (`SpgSaleLine.storeDiscount`), bukan dari pengaturan promo hari ini.
 * Mencakup seluruh potongan nota (promo barang, diskon member, promo belanja, diskon manual).
 * Toko konsinyasi: bagian Elorae = potongan − bagian toko. Toko putus: barangnya
 * milik toko, angkanya hanya dicatat.
 */
export type TanggunganPotongan = {
  konsi: { potongan: number; toko: number; elorae: number };
  putus: { potongan: number };
};

export type LaporanPemakaian = { baris: BarisPemakaian[]; totalPotongan: number; tanggungan: TanggunganPotongan };

async function tanggunganPotongan(rentang: RentangInstan): Promise<TanggunganPotongan> {
  const waktu: Prisma.DateTimeFilter = {};
  if (rentang.dari) waktu.gte = rentang.dari;
  if (rentang.sampai) waktu.lte = rentang.sampai;
  const nota = (termsType: "KONSI" | "PUTUS"): Prisma.SpgSaleLineWhereInput => ({
    discount: { gt: 0 },
    spgSale: {
      ...(rentang.dari || rentang.sampai ? { createdAt: waktu } : {}),
      ...(rentang.storeIds ? { storeId: { in: rentang.storeIds } } : {}),
      store: { termsType },
    },
  });
  const [konsi, putus] = await Promise.all([
    prisma.spgSaleLine.aggregate({ where: nota("KONSI"), _sum: { discount: true, storeDiscount: true } }),
    prisma.spgSaleLine.aggregate({ where: nota("PUTUS"), _sum: { discount: true } }),
  ]);
  const potonganKonsi = angka(konsi._sum.discount);
  const tokoKonsi = angka(konsi._sum.storeDiscount);
  return {
    konsi: { potongan: potonganKonsi, toko: tokoKonsi, elorae: Math.round((potonganKonsi - tokoKonsi) * 100) / 100 },
    putus: { potongan: angka(putus._sum.discount) },
  };
}

/** Pemakaian per promo dalam rentang tanggal nota, potongan terbesar dulu. */
export async function laporanPemakaianPromo(rentang: RentangInstan): Promise<LaporanPemakaian> {
  const [pakai, tanggungan] = await Promise.all([pemakaianPromoKonter(rentang), tanggunganPotongan(rentang)]);
  const ids = [...pakai.keys()];
  const promos = ids.length ? await prisma.counterPromo.findMany({ where: { id: { in: ids } }, select: pilihDaftar }) : [];
  const peta = new Map(promos.map((p) => [p.id, p]));
  // Promo yang sudah tidak ada (seharusnya mustahil: yang terpakai tidak bisa dihapus) memakai nama di nota.
  const hilang = ids.filter((id) => !peta.has(id));
  const namaNota = new Map<string, string>();
  if (hilang.length) {
    const [baris, nota] = await Promise.all([
      prisma.spgSaleLine.findMany({ where: { counterPromoId: { in: hilang } }, select: { counterPromoId: true, promoName: true }, take: 500 }),
      prisma.spgSale.findMany({ where: { orderPromoId: { in: hilang } }, select: { orderPromoId: true, orderPromoName: true }, take: 500 }),
    ]);
    for (const b of baris) if (b.counterPromoId && b.promoName) namaNota.set(b.counterPromoId, b.promoName);
    for (const n of nota) if (n.orderPromoId && n.orderPromoName) namaNota.set(n.orderPromoId, n.orderPromoName);
  }
  const baris = ids
    .map((id) => {
      const p = peta.get(id);
      const v = pakai.get(id)!;
      return {
        id,
        name: p?.name ?? namaNota.get(id) ?? "—",
        ringkasan: p ? ringkas(p) : null,
        nota: v.nota,
        potongan: v.potongan,
        belanja: p ? promoNota(p.type as JenisPromoKonter) : false,
        bagianToko: p ? Number(p.storeSharePercent) : null,
      };
    })
    .sort((a, b) => b.potongan - a.potongan || b.nota - a.nota || a.name.localeCompare(b.name, "id"));
  return { baris, totalPotongan: Math.round(baris.reduce((s, b) => s + b.potongan * 100, 0)) / 100, tanggungan };
}

// ---------------------------------------------------------------------------
// Tab "Diskon manual"
// ---------------------------------------------------------------------------

export type BarisDiskonManual = {
  id: string;
  docNo: string;
  tanggal: string;
  toko: string;
  spg: string;
  nilai: number;
  /** Total nota sesudah semua potongan. */
  total: number;
  /** Diskon manual ÷ nilai nota sebelum diskon manual, persen (1 desimal). */
  persen: number;
  alasan: string | null;
};

export type LaporanDiskonManual = { baris: BarisDiskonManual[]; jumlahNota: number; totalNilai: number; terpotong: boolean };

/** Nota SPG dengan diskon manual, terbaru dulu — supaya pemilik bisa mengawasi potongan yang diberi SPG. */
export async function laporanDiskonManual(rentang: RentangInstan): Promise<LaporanDiskonManual> {
  const waktu: Prisma.DateTimeFilter = {};
  if (rentang.dari) waktu.gte = rentang.dari;
  if (rentang.sampai) waktu.lte = rentang.sampai;
  const where: Prisma.SpgSaleWhereInput = { manualDiscount: { gt: 0 }, ...(rentang.dari || rentang.sampai ? { createdAt: waktu } : {}) };
  const [rows, agregat] = await Promise.all([
    prisma.spgSale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: BATAS_NOTA_MANUAL,
      select: {
        id: true,
        docNo: true,
        createdAt: true,
        total: true,
        manualDiscount: true,
        manualDiscountReason: true,
        store: { select: { name: true } },
        salesman: { select: { name: true, email: true } },
      },
    }),
    prisma.spgSale.aggregate({ where, _count: { _all: true }, _sum: { manualDiscount: true } }),
  ]);
  return {
    jumlahNota: agregat._count._all,
    totalNilai: angka(agregat._sum.manualDiscount),
    terpotong: agregat._count._all > rows.length,
    baris: rows.map((r) => {
      const nilai = angka(r.manualDiscount);
      const total = angka(r.total);
      const dasar = total + nilai;
      return {
        id: r.id,
        docNo: r.docNo,
        tanggal: formatDisplayDateTime(r.createdAt),
        toko: r.store.name,
        spg: r.salesman.name ?? r.salesman.email,
        nilai,
        total,
        persen: dasar > 0 ? Math.round((nilai / dasar) * 1000) / 10 : 0,
        alasan: r.manualDiscountReason,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Formulir
// ---------------------------------------------------------------------------

export type OpsiBarang = { id: string; sku: string; nama: string; kategoriId: string | null; aktif: boolean; /** Harga jual Elorae; null = belum diset. */ harga: number | null };
export type OpsiKategori = { id: string; nama: string; aktif: boolean };
export type OpsiToko = { id: string; nama: string; kode: string; termsType: string; aktif: boolean; spg: number };
export type OpsiFormPromoKonter = { barang: OpsiBarang[]; kategori: OpsiKategori[]; toko: OpsiToko[] };

/**
 * Pilihan formulir: barang jadi aktif, kategori aktif, toko aktif (dengan jumlah
 * SPG-nya) — DITAMBAH yang sudah dipilih promo ini walau kini nonaktif, supaya
 * pilihan lama tidak hilang diam-diam saat disimpan ulang.
 */
export async function opsiFormPromoKonter(terpilih?: { itemIds: string[]; categoryIds: string[]; storeIds: string[] }): Promise<OpsiFormPromoKonter> {
  const t = terpilih ?? { itemIds: [], categoryIds: [], storeIds: [] };
  const [barang, kategori, toko, spg] = await Promise.all([
    prisma.item.findMany({
      where: { type: "FINISHED_GOOD", OR: [{ isActive: true }, { id: { in: t.itemIds } }] },
      select: { id: true, sku: true, nameId: true, categoryId: true, isActive: true, sellingPrice: true },
      orderBy: [{ nameId: "asc" }, { sku: "asc" }],
    }),
    prisma.itemCategory.findMany({
      where: { OR: [{ isActive: true }, { id: { in: t.categoryIds } }] },
      select: { id: true, name: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.store.findMany({
      where: { OR: [{ isActive: true }, { id: { in: t.storeIds } }] },
      select: { id: true, name: true, code: true, termsType: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.groupBy({ by: ["assignedStoreId"], where: { assignedStoreId: { not: null } }, _count: { _all: true } }),
  ]);
  const spgPerToko = new Map(spg.map((g) => [g.assignedStoreId, g._count._all]));
  return {
    barang: barang.map((b) => ({
      id: b.id,
      sku: b.sku,
      nama: b.nameId || b.sku,
      kategoriId: b.categoryId,
      aktif: b.isActive,
      harga: b.sellingPrice === null ? null : Number(b.sellingPrice),
    })),
    kategori: kategori.map((k) => ({ id: k.id, nama: k.name, aktif: k.isActive })),
    toko: toko.map((s) => ({ id: s.id, nama: s.name, kode: s.code, termsType: String(s.termsType), aktif: s.isActive, spg: spgPerToko.get(s.id) ?? 0 })),
  };
}

export type PromoUntukUbah = { id: string; isian: IsianPromoKonter; isActive: boolean; status: StatusPromoKonter; nota: number };

/** Promo + sasarannya dalam bentuk isian formulir (tanggal sebagai hari WIB). */
export async function promoKonterUntukUbah(id: string, sekarang: Date = new Date()): Promise<PromoUntukUbah | null> {
  if (!id) return null;
  const r = await prisma.counterPromo.findUnique({ where: { id }, select: { ...pilihDaftar, note: true } });
  if (!r) return null;
  const ids = (kind: string) => r.targets.filter((t) => t.kind === kind).map((t) => t.refId);
  const hari = keHariWib(r.startsAt, r.endsAt);
  const pakai = await pemakaianPromoKonter({ dari: null, sampai: null, promoIds: [r.id] });
  return {
    id: r.id,
    isActive: r.isActive,
    status: statusPromoKonter(r, sekarang),
    nota: pakai.get(r.id)?.nota ?? 0,
    isian: {
      name: r.name,
      type: r.type,
      value: angkaAtauNull(r.value),
      buyQty: r.buyQty,
      freeQty: r.freeQty,
      minSubtotal: angkaAtauNull(r.minSubtotal),
      allItems: r.allItems,
      itemIds: ids("ITEM"),
      categoryIds: ids("CATEGORY"),
      allStores: r.allStores,
      storeIds: ids("STORE"),
      dari: hari.dari,
      sampai: hari.sampai,
      priority: r.priority,
      note: r.note ?? "",
      storeSharePercent: Number(r.storeSharePercent),
      memberOnly: r.memberOnly,
      komponen: r.type === "PAKET" ? komponenDariSasaran(r.targets) : [],
    },
  };
}

// ---------------------------------------------------------------------------
// HP SPG: promo di toko ini
// ---------------------------------------------------------------------------

export type PromoHp = {
  id: string;
  name: string;
  ringkasan: string;
  status: "BERLAKU" | "TERJADWAL";
  mulai: string | null;
  akhir: string | null;
  semuaBarang: boolean;
  barang: string[];
  kategori: string[];
  belanja: boolean;
  /** Hanya berlaku bila pembeli member. */
  memberOnly: boolean;
  /** Hanya PAKET: isi satu paket dengan nama; kosong untuk jenis lain. */
  isiPaket: KomponenPaketTampil[];
};

/**
 * Promo konter yang berlaku sekarang atau akan datang di toko SPG ini. Sasaran
 * dikirim sebagai NAMA, tidak pernah id; daftar toko tidak dikirim sama sekali.
 * Promo khusus member ikut terkirim (dan ditandai): SPG menawarkannya ke pembeli
 * yang mau mendaftar.
 */
export async function promoKonterHp(storeId: string, sekarang: Date = new Date()): Promise<PromoHp[]> {
  const promos = await promoKonterUntukToko(storeId, sekarang);
  const nama = await petaNama({
    barang: promos.flatMap((p) => p.itemIds),
    kategori: promos.flatMap((p) => p.categoryIds),
    toko: [],
  });
  const berstatus = promos
    .map((p) => ({ p, status: statusPromoKonter(p, sekarang) }))
    .filter((x): x is { p: (typeof promos)[number]; status: "BERLAKU" | "TERJADWAL" } => x.status === "BERLAKU" || x.status === "TERJADWAL")
    // Yang berlaku dulu, lalu yang paling cepat mulai.
    .sort((a, b) =>
      a.status !== b.status
        ? a.status === "BERLAKU"
          ? -1
          : 1
        : (a.p.startsAt ? new Date(a.p.startsAt).getTime() : 0) - (b.p.startsAt ? new Date(b.p.startsAt).getTime() : 0),
    );
  return berstatus.map(({ p, status }) => ({
    id: p.id,
    name: p.name,
    ringkasan: ringkasPromoKonter(p),
    status,
    mulai: p.startsAt ? formatDisplayDate(p.startsAt) : null,
    akhir: p.endsAt ? formatDisplayDate(p.endsAt) : null,
    semuaBarang: p.allItems,
    barang: p.allItems ? [] : namai(nama.barang, p.itemIds),
    kategori: p.allItems ? [] : namai(nama.kategori, p.categoryIds),
    belanja: promoNota(p.type),
    memberOnly: p.memberOnly === true,
    isiPaket: p.type === "PAKET" ? namaiKomponen(nama, p.komponen ?? []) : [],
  }));
}
