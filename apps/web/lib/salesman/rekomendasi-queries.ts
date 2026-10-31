import { prisma } from "@elorae/db";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { tautanWhatsApp } from "./dasbor";
import type { PeriodeAnalisa } from "./analisa-toko";
import { bacaTokoTerkunci, KUNCI_TOKO_TERKUNCI } from "./pengaturan";
import { pesanRekomendasiWa } from "./pesan-rekomendasi-wa";
import type { StatusSerap, SumberPenyerapan, VarianSerap } from "./penyerapan";
import { penyerapanToko } from "./penyerapan-queries";
import {
  ALASAN_REKOMENDASI,
  alasanDariSaranTawar,
  bisaDibatalkan,
  bisaDijawab,
  bisaDipesan,
  bolehBuatRekomendasi,
  FILTER_REKOMENDASI,
  opsiVarianBarang,
  saringSaranUmum,
  type AlasanRekomendasi,
  type FilterRekomendasi,
  type StatusRekomendasi,
} from "./rekomendasi-aturan";
import { saranTawarToko } from "./saran-tawar-queries";

export { bacaFilterRekomendasi, type FilterRekomendasi } from "./rekomendasi-aturan";

/**
 * Kueri rekomendasi barang: bahan formulir di HP salesman, daftar dan rincian
 * untuk salesman pembuatnya, dan daftar dan rincian untuk SPG toko tujuannya.
 *
 * TIDAK ADA HARGA di bentuk mana pun di sini — rekomendasi hanya barang,
 * ukuran, jumlah, dan alasan. Untuk toko konsinyasi itu aturan tetap (harga
 * konsinyasi tidak pernah sampai ke HP); SPG tidak butuh harga untuk menjawab
 * saran. Tes memeriksa JSON-nya.
 */

// ─── Bahan formulir ──────────────────────────────────────────────────────────

/** Batas barang "lain yang ada di toko ini" di formulir. */
export const BATAS_KANDIDAT_DI_TOKO = 30;

export type InfoKandidat =
  | { kode: "ISI_ULANG"; laku: number; sisa: number; persen: number | null }
  | { kode: "DI_TOKO"; status: StatusSerap; laku: number; sisa: number; persen: number | null }
  | { kode: "ANDALAN_TOKO"; jedaBiasa: number; hariSejakPesan: number }
  | { kode: "LARIS_DI_AREA"; pcs: number; toko: number; hari: number }
  | { kode: "BARU"; umurHari: number };

export type BarisKandidat = {
  /** "" untuk barang tanpa varian. */
  variantSku: string;
  label: string | null;
  /** Jumlah awal di formulir: saran isi ulang, selain itu 0 (salesman yang mengisi). */
  qtyAwal: number;
  /** Laku dan sisa ukuran ini di toko, bila toko melaporkannya. */
  laku: number | null;
  sisa: number | null;
};

export type KandidatRekomendasi = {
  itemId: string;
  nama: string;
  sku: string;
  alasan: AlasanRekomendasi;
  info: InfoKandidat;
  baris: BarisKandidat[];
};

export type BahanFormRekomendasi = {
  toko: { id: string; nama: string; jenis: "PUTUS" | "KONSI" };
  /** Pengguna ini boleh membuat rekomendasi untuk toko ini. */
  boleh: boolean;
  sumber: SumberPenyerapan;
  periode: PeriodeAnalisa;
  kandidat: KandidatRekomendasi[];
};

/**
 * Pilihan barang untuk rekomendasi, dari yang paling kuat:
 *   1. laku di toko ini, cepat terserap dan hampir habis (penyerapan) — ukuran
 *      yang hampir habis sudah terisi jumlah sarannya;
 *   2. saran tawar: andalan toko yang lama tidak dipesan, laris di toko
 *      sejenis, barang baru;
 *   3. barang lain yang terserap biasa/cepat di toko ini (pilihan manual).
 * Barang yang lambat atau belum ada datanya tidak ditawarkan. Satu barang
 * muncul sekali — dari sumber pertamanya.
 */
export async function bahanFormRekomendasi(
  storeId: string,
  userId: string,
  periode: PeriodeAnalisa,
  hariIni: Date,
): Promise<BahanFormRekomendasi | null> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, termsType: true, salesmanId: true } });
  if (!toko) return null;
  const [setelan, serap, tawar] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: KUNCI_TOKO_TERKUNCI }, select: { value: true } }),
    penyerapanToko(storeId, periode, hariIni),
    saranTawarToko(storeId, hariIni),
  ]);
  const boleh = bolehBuatRekomendasi({ terkunci: bacaTokoTerkunci(setelan?.value), pemegangId: toko.salesmanId, userId });

  type Calon = { itemId: string; nama: string; sku: string; alasan: AlasanRekomendasi; info: InfoKandidat; varian: VarianSerap[] };
  const calon: Calon[] = [];
  const sudah = new Set<string>();
  const tambah = (c: Calon) => {
    if (sudah.has(c.itemId)) return;
    sudah.add(c.itemId);
    calon.push(c);
  };

  const artikel = serap?.artikel ?? [];
  for (const a of artikel) {
    if (a.saran !== "ISI_ULANG") continue;
    tambah({ itemId: a.itemId, nama: a.nama, sku: a.sku, alasan: "LAKU_DI_SINI", info: { kode: "ISI_ULANG", laku: a.laku, sisa: a.sisa, persen: a.persen }, varian: a.varian });
  }
  for (const s of saringSaranUmum(tawar?.saran ?? [], artikel.map((a) => a.itemId))) {
    const info: InfoKandidat =
      s.alasan === "ANDALAN_TOKO"
        ? { kode: "ANDALAN_TOKO", jedaBiasa: s.jedaBiasa, hariSejakPesan: s.hariSejakPesan }
        : s.alasan === "LARIS_DI_AREA"
          ? { kode: "LARIS_DI_AREA", pcs: s.pcs, toko: s.toko, hari: tawar?.hariArea ?? 0 }
          : { kode: "BARU", umurHari: s.umurHari };
    tambah({ itemId: s.itemId, nama: s.nama, sku: s.sku, alasan: alasanDariSaranTawar(s.alasan), info, varian: [] });
  }
  let diToko = 0;
  for (const a of artikel) {
    if (diToko >= BATAS_KANDIDAT_DI_TOKO) break;
    if (a.saran === "ISI_ULANG" || (a.status !== "CEPAT" && a.status !== "NORMAL") || sudah.has(a.itemId)) continue;
    diToko += 1;
    tambah({
      itemId: a.itemId,
      nama: a.nama,
      sku: a.sku,
      alasan: "MANUAL",
      info: { kode: "DI_TOKO", status: a.status, laku: a.laku, sisa: a.sisa, persen: a.persen },
      varian: a.varian,
    });
  }

  const itemIds = calon.map((c) => c.itemId);
  const [items, stok] = itemIds.length
    ? await Promise.all([
        prisma.item.findMany({ where: { id: { in: itemIds }, isActive: true }, select: { id: true, sku: true, variants: true } }),
        prisma.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true } }),
      ])
    : [[], []];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const kandidat: KandidatRekomendasi[] = [];
  for (const c of calon) {
    const item = itemById.get(c.itemId);
    // Barang yang sudah tidak dijual tidak bisa direkomendasikan (penulis menolaknya).
    if (!item) continue;
    const opsi = opsiVarianBarang({
      variants: item.variants,
      skuInduk: item.sku,
      skuStok: stok.filter((s) => s.itemId === c.itemId).map((s) => s.variantSku),
    });
    const diSerap = new Map(c.varian.map((v) => [v.variantSku, v]));
    const baris = (opsi.length > 0 ? opsi : [{ sku: "", label: null as string | null }]).map((o): BarisKandidat => {
      const v = diSerap.get(o.sku);
      return {
        variantSku: o.sku,
        label: o.label,
        qtyAwal: v?.saran === "ISI_ULANG" ? v.saranQty : 0,
        laku: v ? v.laku : null,
        sisa: v ? v.sisa : null,
      };
    });
    kandidat.push({ itemId: c.itemId, nama: c.nama, sku: c.sku, alasan: c.alasan, info: c.info, baris });
  }

  return {
    toko: { id: toko.id, nama: toko.name, jenis: toko.termsType },
    boleh,
    sumber: serap?.sumber ?? "TANPA_LAPORAN",
    periode,
    kandidat,
  };
}

// ─── Bentuk bersama daftar & rincian ─────────────────────────────────────────

export type BarisRekomendasiTampil = {
  id: string;
  productName: string;
  variantSku: string;
  qty: number;
  alasan: AlasanRekomendasi | null;
};

export type RincianRekomendasi = {
  id: string;
  status: StatusRekomendasi;
  dibuat: string;
  catatan: string | null;
  toko: { id: string; nama: string; jenis: "PUTUS" | "KONSI"; adaSpg: boolean };
  pembuat: string | null;
  baris: BarisRekomendasiTampil[];
  totalPcs: number;
  jawaban: { oleh: string | null; pada: string; catatan: string | null } | null;
  pesanan: { id: string; orderNo: string } | null;
};

const bacaAlasan = (a: string | null): AlasanRekomendasi | null =>
  a && (ALASAN_REKOMENDASI as readonly string[]).includes(a) ? (a as AlasanRekomendasi) : null;

const PILIH_RINCIAN = {
  id: true,
  storeId: true,
  salesmanId: true,
  status: true,
  note: true,
  respondedById: true,
  respondedAt: true,
  responseNote: true,
  fieldSalesOrderId: true,
  createdAt: true,
  store: { select: { id: true, name: true, termsType: true, phone: true } },
  lines: { orderBy: { productName: "asc" as const }, select: { id: true, productName: true, variantSku: true, qty: true, alasan: true } },
} as const;

async function susunRincian(r: {
  id: string;
  storeId: string;
  salesmanId: string;
  status: StatusRekomendasi;
  note: string | null;
  respondedById: string | null;
  respondedAt: Date | null;
  responseNote: string | null;
  fieldSalesOrderId: string | null;
  createdAt: Date;
  store: { id: string; name: string; termsType: "PUTUS" | "KONSI" };
  lines: { id: string; productName: string; variantSku: string; qty: number; alasan: string | null }[];
}): Promise<RincianRekomendasi> {
  const orangIds = [r.salesmanId, r.respondedById].filter((x): x is string => !!x);
  const [orang, spg, pesanan] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: orangIds } }, select: { id: true, name: true, email: true } }),
    prisma.user.count({ where: { assignedStoreId: r.storeId } }),
    r.fieldSalesOrderId
      ? prisma.fieldSalesOrder.findUnique({ where: { id: r.fieldSalesOrderId }, select: { id: true, orderNo: true } })
      : Promise.resolve(null),
  ]);
  const nama = new Map(orang.map((o) => [o.id, o.name?.trim() || o.email]));
  return {
    id: r.id,
    status: r.status,
    dibuat: formatDisplayDateTime(r.createdAt),
    catatan: r.note,
    toko: { id: r.store.id, nama: r.store.name, jenis: r.store.termsType, adaSpg: spg > 0 },
    pembuat: nama.get(r.salesmanId) ?? null,
    baris: r.lines.map((l) => ({ id: l.id, productName: l.productName, variantSku: l.variantSku, qty: l.qty, alasan: bacaAlasan(l.alasan) })),
    totalPcs: r.lines.reduce((n, l) => n + l.qty, 0),
    jawaban: r.respondedAt
      ? { oleh: r.respondedById ? (nama.get(r.respondedById) ?? null) : null, pada: formatDisplayDateTime(r.respondedAt), catatan: r.responseNote }
      : null,
    pesanan: pesanan ? { id: pesanan.id, orderNo: pesanan.orderNo } : null,
  };
}

// ─── Salesman ────────────────────────────────────────────────────────────────

export type BarisDaftarRekomendasi = {
  id: string;
  storeId: string;
  toko: string;
  status: StatusRekomendasi;
  dibuat: string;
  baris: number;
  pcs: number;
  /** Salesman: nama SPG/orang yang menjawab. SPG: nama salesman pengirim. */
  orang: string | null;
};

export const BATAS_DAFTAR_REKOMENDASI = 100;

/** Rekomendasi milik salesman ini, terbaru dulu, dengan hitungan per status untuk pilihan saringnya. */
export async function daftarRekomendasiSaya(
  salesmanId: string,
  filter: FilterRekomendasi,
): Promise<{ baris: BarisDaftarRekomendasi[]; jumlah: Record<FilterRekomendasi, number> }> {
  const [rows, grup] = await Promise.all([
    prisma.storeRecommendation.findMany({
      where: { salesmanId, ...(filter === "SEMUA" ? {} : { status: filter }) },
      orderBy: { createdAt: "desc" },
      take: BATAS_DAFTAR_REKOMENDASI,
      select: {
        id: true,
        storeId: true,
        status: true,
        createdAt: true,
        respondedById: true,
        store: { select: { name: true } },
        lines: { select: { qty: true } },
      },
    }),
    prisma.storeRecommendation.groupBy({ by: ["status"], where: { salesmanId }, _count: { _all: true } }),
  ]);
  const penjawab = [...new Set(rows.map((r) => r.respondedById).filter((x): x is string => !!x))];
  const orang = penjawab.length ? await prisma.user.findMany({ where: { id: { in: penjawab } }, select: { id: true, name: true, email: true } }) : [];
  const nama = new Map(orang.map((o) => [o.id, o.name?.trim() || o.email]));

  const jumlah = Object.fromEntries(FILTER_REKOMENDASI.map((f) => [f, 0])) as Record<FilterRekomendasi, number>;
  for (const g of grup) {
    jumlah[g.status] = g._count._all;
    jumlah.SEMUA += g._count._all;
  }
  return {
    baris: rows.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      toko: r.store.name,
      status: r.status,
      dibuat: formatDisplayDate(r.createdAt),
      baris: r.lines.length,
      pcs: r.lines.reduce((n, l) => n + l.qty, 0),
      orang: r.respondedById && r.respondedById !== salesmanId ? (nama.get(r.respondedById) ?? null) : null,
    })),
    jumlah,
  };
}

export type RincianRekomendasiSaya = RincianRekomendasi & {
  /** Teks + tautan WhatsApp ke nomor toko (atau tanpa nomor). null bila sudah tidak relevan. */
  wa: { tautan: string; adaNomor: boolean } | null;
  bolehBatal: boolean;
  /** Toko tanpa SPG: salesman menandai jawaban manager. */
  bolehTandaiSetuju: boolean;
  bolehPesan: boolean;
};

/** Rincian untuk pembuatnya saja; null untuk rekomendasi orang lain. */
export async function rincianRekomendasiSaya(id: string, salesmanId: string): Promise<RincianRekomendasiSaya | null> {
  const r = await prisma.storeRecommendation.findFirst({ where: { id, salesmanId }, select: PILIH_RINCIAN });
  if (!r) return null;
  const rincian = await susunRincian(r);
  let wa: RincianRekomendasiSaya["wa"] = null;
  if (r.status === "TERKIRIM" || r.status === "DITERIMA") {
    const teks = pesanRekomendasiWa({
      toko: r.store.name,
      jenis: r.store.termsType,
      tanggal: r.createdAt,
      baris: r.lines.map((l) => ({ nama: l.productName, qty: l.qty, alasan: l.alasan })),
      catatan: r.note,
      salesman: rincian.pembuat,
    });
    const keToko = tautanWhatsApp(r.store.phone, teks);
    wa = { tautan: keToko ?? `https://wa.me/?text=${encodeURIComponent(teks)}`, adaNomor: keToko !== null };
  }
  return {
    ...rincian,
    wa,
    bolehBatal: bisaDibatalkan(r.status),
    bolehTandaiSetuju: bisaDijawab(r.status) && !rincian.toko.adaSpg,
    bolehPesan: bisaDipesan(r.status),
  };
}

// ─── SPG ─────────────────────────────────────────────────────────────────────

/** Rekomendasi untuk toko tetap SPG, terbaru dulu; `menunggu` = yang perlu dijawab. */
export async function daftarRekomendasiSpg(storeId: string): Promise<{ baris: BarisDaftarRekomendasi[]; menunggu: number }> {
  const rows = await prisma.storeRecommendation.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: BATAS_DAFTAR_REKOMENDASI,
    select: { id: true, storeId: true, status: true, createdAt: true, salesmanId: true, store: { select: { name: true } }, lines: { select: { qty: true } } },
  });
  const ids = [...new Set(rows.map((r) => r.salesmanId))];
  const orang = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nama = new Map(orang.map((o) => [o.id, o.name?.trim() || o.email]));
  // Yang menunggu jawaban di atas: itulah pekerjaan SPG di layar ini.
  const urut = [...rows].sort((a, b) => Number(b.status === "TERKIRIM") - Number(a.status === "TERKIRIM"));
  return {
    baris: urut.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      toko: r.store.name,
      status: r.status,
      dibuat: formatDisplayDate(r.createdAt),
      baris: r.lines.length,
      pcs: r.lines.reduce((n, l) => n + l.qty, 0),
      orang: nama.get(r.salesmanId) ?? null,
    })),
    menunggu: rows.filter((r) => r.status === "TERKIRIM").length,
  };
}

export type RincianRekomendasiSpg = RincianRekomendasi & { bolehJawab: boolean };

/** Rincian untuk SPG toko tujuannya saja; null untuk toko lain. */
export async function rincianRekomendasiSpg(id: string, storeId: string): Promise<RincianRekomendasiSpg | null> {
  const r = await prisma.storeRecommendation.findFirst({ where: { id, storeId }, select: PILIH_RINCIAN });
  if (!r) return null;
  return { ...(await susunRincian(r)), bolehJawab: bisaDijawab(r.status) };
}
