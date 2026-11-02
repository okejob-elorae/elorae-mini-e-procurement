import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDateTime } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { wibYearMonth } from "@/lib/spg-commission/month";
import { terhitungSesudah } from "./opname-hitung";
import { kunciBaris } from "./stok";
import { hargaBersihPotong } from "./tutup-hari";
import type { KondisiRetur } from "./retur-pembeli";
import { RETUR_PEMBELI_MENUNGGU, qtyMenungguPerBaris } from "./retur-pembeli-berlaku";
import {
  ENTITAS_RETUR_PEMBELI,
  STATUS_RETUR_PEMBELI,
  bacaStatusReturPembeli,
  type SaringanReturPembeliKantor,
  type StatusReturPembeli,
} from "./retur-pembeli-status";

/**
 * Bacaan laporan retur pembeli SPG — antrean kantor (`/backoffice/retur-spg`),
 * rinciannya, hitungan Beranda, dan daftar laporan SPG di HP
 * (`/pwa/spg/retur-pembeli`). Hanya server (menarik Prisma); komponen klien
 * hanya boleh `import type` dari sini.
 *
 * Berbeda dari pembaca yang MENGHITUNG retur (yang wajib lewat
 * `returPembeliBerlaku`), layar-layar ini sengaja menampilkan SEMUA status —
 * itulah gunanya: menunggu, disetujui, ditolak, ditarik.
 */

const angka = (v: unknown) => Number(v ?? 0);
const namaOrang = (u: { name: string | null; email: string } | null | undefined) => u?.name?.trim() || u?.email || "—";

async function namaPengguna(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, namaOrang(u)]));
}

async function namaToko(ids: (string | null | undefined)[]): Promise<Map<string, { name: string; termsType: "PUTUS" | "KONSI" }>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.store.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, termsType: true } });
  return new Map(rows.map((s) => [s.id, { name: s.name, termsType: s.termsType }]));
}

/** "Kaos A (M) ×2, Kaos B ×1, …" — paling banyak tiga baris, sisanya disingkat. */
function ringkas(baris: { productName: string; variantSku: string; qty: number }[]): string {
  const teks = baris.slice(0, 3).map((b) => `${b.productName}${b.variantSku ? ` (${b.variantSku})` : ""} ×${b.qty}`);
  return baris.length > 3 ? `${teks.join(", ")}, …` : teks.join(", ");
}

/* --------------------------------------------------------------- kantor */

export type BarisReturPembeliKantor = {
  id: string;
  status: StatusReturPembeli;
  dilaporkanPada: Date;
  storeId: string;
  toko: string;
  pelapor: string;
  spgSaleId: string;
  docNo: string;
  pcs: number;
  ringkasBarang: string;
  alasan: string;
  diputuskanOleh: string | null;
  diputuskanPada: Date | null;
  /** Alasan kantor menolak (DITOLAK), atau alasan SPG menarik (DIBATALKAN). */
  alasanTolak: string | null;
  /** Baris lama: berlaku langsung saat dicatat, sebelum persetujuan kantor ada. */
  langsungBerlaku: boolean;
};

/**
 * Antrean kantor. Tab Menunggu terlama dulu (yang paling lama menunggu
 * diputuskan lebih dulu); tab lain terbaru dulu. Hitungan per tab memakai
 * saringan toko + nomor nota yang SAMA dengan barisnya.
 */
export async function daftarReturPembeliKantor(
  s: SaringanReturPembeliKantor,
): Promise<{ baris: BarisReturPembeliKantor[]; total: number; perStatus: Record<StatusReturPembeli, number> }> {
  const dasar: Prisma.SpgSaleReturnWhereInput = {
    ...(s.storeId ? { storeId: s.storeId } : {}),
    ...(s.cari ? { spgSale: { docNo: cariTeks(s.cari) } } : {}),
  };
  const where: Prisma.SpgSaleReturnWhereInput = s.status === "SEMUA" ? dasar : { ...dasar, status: s.status };
  const arah = s.status === "MENUNGGU" ? "asc" : "desc";
  const [rows, total, grup] = await Promise.all([
    prisma.spgSaleReturn.findMany({
      where,
      orderBy: [{ createdAt: arah }, { id: arah }],
      skip: (s.halaman - 1) * s.ukuran,
      take: s.ukuran,
      select: {
        id: true,
        status: true,
        createdAt: true,
        storeId: true,
        createdById: true,
        reason: true,
        decidedById: true,
        decidedAt: true,
        rejectReason: true,
        spgSaleId: true,
        spgSale: { select: { docNo: true } },
        lines: { select: { qty: true, saleLine: { select: { productName: true, variantSku: true } } } },
      },
    }),
    prisma.spgSaleReturn.count({ where }),
    prisma.spgSaleReturn.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
  ]);
  const [nama, toko] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.createdById, r.decidedById])),
    namaToko(rows.map((r) => r.storeId)),
  ]);
  const perStatus = Object.fromEntries(STATUS_RETUR_PEMBELI.map((x) => [x, 0])) as Record<StatusReturPembeli, number>;
  for (const g of grup) {
    const st = bacaStatusReturPembeli(g.status);
    if (st) perStatus[st] = g._count._all;
  }
  return {
    total,
    perStatus,
    baris: rows.map((r) => {
      const status = bacaStatusReturPembeli(r.status) ?? "DISETUJUI";
      const lines = r.lines.map((l) => ({ productName: l.saleLine.productName, variantSku: l.saleLine.variantSku, qty: l.qty }));
      return {
        id: r.id,
        status,
        dilaporkanPada: r.createdAt,
        storeId: r.storeId,
        toko: toko.get(r.storeId)?.name ?? "—",
        pelapor: nama.get(r.createdById) ?? "—",
        spgSaleId: r.spgSaleId,
        docNo: r.spgSale.docNo,
        pcs: lines.reduce((n, l) => n + l.qty, 0),
        ringkasBarang: ringkas(lines),
        alasan: r.reason,
        diputuskanOleh: r.decidedById ? (nama.get(r.decidedById) ?? "—") : null,
        diputuskanPada: r.decidedAt,
        alasanTolak: r.rejectReason,
        langsungBerlaku: status === "DISETUJUI" && r.decidedAt === null,
      };
    }),
  };
}

/** Pilihan saringan toko: toko yang punya SPG sekarang, ditambah toko yang punya laporan. */
export async function pilihanTokoReturPembeli(): Promise<{ id: string; name: string }[]> {
  const [berLaporan, spg] = await Promise.all([
    prisma.spgSaleReturn.groupBy({ by: ["storeId"], _count: { _all: true } }),
    prisma.user.findMany({ where: { assignedStoreId: { not: null } }, select: { assignedStoreId: true } }),
  ]);
  const toko = await namaToko([...berLaporan.map((g) => g.storeId), ...spg.map((u) => u.assignedStoreId)]);
  return [...toko.entries()].map(([id, t]) => ({ id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name, "id"));
}

export type RincianReturPembeliKantor = {
  id: string;
  status: StatusReturPembeli;
  dilaporkanPada: Date;
  pelapor: { id: string; nama: string };
  toko: { id: string; nama: string; termsType: "PUTUS" | "KONSI" };
  nota: { id: string; docNo: string; waktu: Date; total: number };
  alasan: string;
  diputuskan: { olehId: string | null; oleh: string | null; pada: Date | null; alasanTolak: string | null };
  langsungBerlaku: boolean;
  baris: {
    id: string;
    saleLineId: string;
    productName: string;
    variantSku: string;
    kondisi: KondisiRetur;
    /** Potong di laporan ini. */
    qty: number;
    /** Terjual di baris nota itu. */
    terjual: number;
    /** Sudah kembali dan disetujui (`SpgSaleLine.returnedQty`). */
    sudahKembali: number;
    /** Masih menunggu di laporan LAIN atas baris nota yang sama. */
    menungguLain: number;
    /** Nilai bersih potong laporan ini (harga bersih baris nota × qty) — hanya kantor. */
    nilaiBersih: number;
    /** LAYAK, masih menunggu, dan sudah dihitung opname toko sesudah dilaporkan: rak tidak ditambah lagi saat disetujui. */
    terhitungOpnameSesudah: boolean;
  }[];
  peringatan: {
    /** Bulan WIB saat dilaporkan, "YYYY-MM" — bulan pengaruhnya. */
    bulan: string;
    /** Laporan penjualan SPG toko putus bulan itu sudah dicek (`SpgSalesCheck`). */
    komisiPutusDicek: boolean;
    /** Angka resmi siklus konsinyasi toko itu bulan itu sudah dikunci. */
    siklusKonsiTerkunci: boolean;
  };
  jejak: { action: string; oleh: string; pada: Date; reason: string | null }[];
};

export async function rincianReturPembeliKantor(id: string): Promise<RincianReturPembeliKantor | null> {
  if (!id) return null;
  const r = await prisma.spgSaleReturn.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      createdById: true,
      storeId: true,
      reason: true,
      decidedById: true,
      decidedAt: true,
      rejectReason: true,
      spgSale: { select: { id: true, docNo: true, createdAt: true, total: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          spgSaleLineId: true,
          itemId: true,
          variantSku: true,
          qty: true,
          condition: true,
          saleLine: { select: { productName: true, variantSku: true, qty: true, returnedQty: true, lineTotal: true, unitPrice: true } },
        },
      },
    },
  });
  if (!r) return null;
  const status = bacaStatusReturPembeli(r.status) ?? "DISETUJUI";
  const bulan = wibYearMonth(r.createdAt);
  const [tahun, nomorBulan] = bulan.split("-").map(Number);

  const layak = r.lines.filter((l) => l.condition === "LAYAK");
  const [nama, toko, menungguLain, terhitung, dicek, siklus, jejak] = await Promise.all([
    namaPengguna([r.createdById, r.decidedById]),
    namaToko([r.storeId]),
    qtyMenungguPerBaris(
      prisma,
      r.lines.map((l) => l.spgSaleLineId),
      { kecualiReturnId: r.id },
    ),
    status === "MENUNGGU" && layak.length
      ? terhitungSesudah(prisma, r.storeId, [...new Set(layak.map((l) => l.itemId))], r.createdAt)
      : Promise.resolve(new Set<string>()),
    prisma.spgSalesCheck.findFirst({ where: { storeId: r.storeId, period: bulan }, select: { id: true } }),
    prisma.consignmentCycle.findFirst({
      where: { storeId: r.storeId, periodYear: tahun, periodMonth: nomorBulan, lockedAt: { not: null } },
      select: { id: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_RETUR_PEMBELI, entityId: r.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, userId: true, createdAt: true, reason: true },
    }),
  ]);
  const namaJejak = await namaPengguna(jejak.map((j) => j.userId));
  const t = toko.get(r.storeId);

  return {
    id: r.id,
    status,
    dilaporkanPada: r.createdAt,
    pelapor: { id: r.createdById, nama: nama.get(r.createdById) ?? "—" },
    toko: { id: r.storeId, nama: t?.name ?? "—", termsType: t?.termsType ?? "PUTUS" },
    nota: { id: r.spgSale.id, docNo: r.spgSale.docNo, waktu: r.spgSale.createdAt, total: angka(r.spgSale.total) },
    alasan: r.reason,
    diputuskan: {
      olehId: r.decidedById,
      oleh: r.decidedById ? (nama.get(r.decidedById) ?? "—") : null,
      pada: r.decidedAt,
      alasanTolak: r.rejectReason,
    },
    langsungBerlaku: status === "DISETUJUI" && r.decidedAt === null,
    baris: r.lines.map((l) => ({
      id: l.id,
      saleLineId: l.spgSaleLineId,
      productName: l.saleLine.productName,
      variantSku: l.saleLine.variantSku || l.variantSku,
      kondisi: l.condition,
      qty: l.qty,
      terjual: l.saleLine.qty,
      sudahKembali: l.saleLine.returnedQty,
      menungguLain: menungguLain.get(l.spgSaleLineId) ?? 0,
      nilaiBersih:
        Math.round(
          l.qty *
            hargaBersihPotong({
              qty: l.saleLine.qty,
              lineTotal: angka(l.saleLine.lineTotal),
              unitPrice: angka(l.saleLine.unitPrice),
            }) *
            100,
        ) / 100,
      terhitungOpnameSesudah: l.condition === "LAYAK" && terhitung.has(kunciBaris(l.itemId, l.variantSku)),
    })),
    peringatan: { bulan, komisiPutusDicek: dicek !== null, siklusKonsiTerkunci: siklus !== null },
    jejak: jejak.map((j) => ({ action: j.action, oleh: namaJejak.get(j.userId) ?? "—", pada: j.createdAt, reason: j.reason })),
  };
}

/**
 * Laporan yang masih menunggu keputusan — angka Beranda (antrean
 * `spgReturnsPending`). Hitungan per toko × bulan untuk layar komisi ada di
 * `returMenungguPerLaporan` (`lib/spg/koreksi-queries.ts`), dengan saringan yang sama.
 */
export async function jumlahReturPembeliMenunggu(): Promise<number> {
  return prisma.spgSaleReturn.count({ where: RETUR_PEMBELI_MENUNGGU });
}

/* ------------------------------------------------------------------- HP */

export type ReturPembeliHp = {
  id: string;
  status: StatusReturPembeli;
  /** Saat dilaporkan, sudah diformat WIB untuk kedua bahasa. */
  dilaporkan: { id: string; en: string };
  spgSaleId: string;
  docNo: string;
  alasan: string;
  /** Alasan kantor menolak (DITOLAK) atau alasan Anda menarik (DIBATALKAN). */
  alasanKeputusan: string | null;
  baris: { productName: string; variantSku: string; qty: number; kondisi: KondisiRetur }[];
  bisaDitarik: boolean;
};

/**
 * Laporan retur pembeli SPG ini di toko tetapnya, terbaru dulu. TANPA harga
 * dan total apa pun — di toko putus maupun konsi (dikunci tes pada muatan yang
 * diserialkan).
 */
export async function returPembeliSaya(userId: string, storeId: string, opsi: { batas?: number } = {}): Promise<ReturPembeliHp[]> {
  if (!userId || !storeId) return [];
  const rows = await prisma.spgSaleReturn.findMany({
    where: { createdById: userId, storeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opsi.batas ?? 50, 1), 200),
    select: {
      id: true,
      status: true,
      createdAt: true,
      reason: true,
      rejectReason: true,
      spgSaleId: true,
      spgSale: { select: { docNo: true } },
      lines: { orderBy: { id: "asc" }, select: { qty: true, condition: true, variantSku: true, saleLine: { select: { productName: true, variantSku: true } } } },
    },
  });
  return rows.map((r) => {
    const status = bacaStatusReturPembeli(r.status) ?? "DISETUJUI";
    return {
      id: r.id,
      status,
      dilaporkan: { id: formatDisplayDateTime(r.createdAt, "id"), en: formatDisplayDateTime(r.createdAt, "en") },
      spgSaleId: r.spgSaleId,
      docNo: r.spgSale.docNo,
      alasan: r.reason,
      alasanKeputusan: status === "DITOLAK" || status === "DIBATALKAN" ? r.rejectReason : null,
      baris: r.lines.map((l) => ({
        productName: l.saleLine.productName,
        variantSku: l.saleLine.variantSku || l.variantSku,
        qty: l.qty,
        kondisi: l.condition,
      })),
      bisaDitarik: status === "MENUNGGU",
    };
  });
}
