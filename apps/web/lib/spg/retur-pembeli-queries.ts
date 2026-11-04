import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDateTime } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { wibYearMonth } from "@/lib/spg-commission/month";
import { ENTITAS_BEBAN_SPG, nilaiBebanReturPembeli, nilaiBersihBarisRetur, type KeadaanBebanSpg } from "./beban-spg";
import { bebanMenungguKeputusanBarang, bebanUntukRetur, bebanUntukReturBanyak, type BebanReturKantor, type BebanReturRingkas } from "./beban-spg-queries";
import { urlFotoReturPembeli } from "./foto-retur-pembeli";
import { kunciFotoReturPembeliSah } from "./foto-retur-pembeli-kunci";
import type { KondisiRetur } from "./retur-pembeli";
import { RETUR_PEMBELI_DITAHAN_BEBAN, RETUR_PEMBELI_MENUNGGU, qtyDitahanBebanPerBaris, qtyMenungguPerBaris } from "./retur-pembeli-berlaku";
import {
  ENTITAS_RETUR_PEMBELI,
  KATEGORI_NOTIF_RETUR_PEMBELI,
  STATUS_RETUR_PEMBELI,
  bacaStatusReturPembeli,
  keadaanUangRetur,
  uangReturTercatat,
  type KeadaanUangRetur,
  type SaringanReturPembeliKantor,
  type StatusReturPembeli,
} from "./retur-pembeli-status";

/**
 * Bacaan laporan retur pembeli SPG — antrean kantor (`/backoffice/retur-spg`),
 * rinciannya, hitungan Beranda, daftar laporan SPG di HP
 * (`/pwa/spg/retur-pembeli`), dan barang yang disisihkan di toko. Hanya server
 * (menarik Prisma); komponen klien hanya boleh `import type` dari sini.
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
  /** Keadaan uang pembeli. */
  uang: KeadaanUangRetur;
  /** Beban SPG laporan ini (ditolak padahal uangnya sudah dikembalikan), atau null. */
  beban: BebanReturRingkas | null;
};

/**
 * Antrean kantor. Tab Menunggu (dan "Perlu keputusan barang") terlama dulu —
 * yang paling lama menunggu diputuskan lebih dulu; tab lain terbaru dulu.
 * Hitungan per tab memakai saringan toko + nomor nota yang SAMA dengan barisnya.
 */
export async function daftarReturPembeliKantor(s: SaringanReturPembeliKantor): Promise<{
  baris: BarisReturPembeliKantor[];
  total: number;
  perStatus: Record<StatusReturPembeli, number>;
  /** Laporan yang bebannya sudah diganti SPG dan barangnya menunggu keputusan (P79). */
  keputusanBarang: number;
}> {
  const dasar: Prisma.SpgSaleReturnWhereInput = {
    ...(s.storeId ? { storeId: s.storeId } : {}),
    ...(s.cari ? { spgSale: { docNo: cariTeks(s.cari) } } : {}),
  };
  const perluKeputusan = await bebanMenungguKeputusanBarang({ storeId: s.storeId });
  const idKeputusan = perluKeputusan.map((x) => x.returnId);
  const where: Prisma.SpgSaleReturnWhereInput =
    s.status === "SEMUA" ? dasar : s.status === "KEPUTUSAN_BARANG" ? { ...dasar, id: { in: idKeputusan } } : { ...dasar, status: s.status };
  const arah = s.status === "MENUNGGU" || s.status === "KEPUTUSAN_BARANG" ? "asc" : "desc";
  const [rows, total, grup, keputusanBarang] = await Promise.all([
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
        refundedAt: true,
        refundMarkedById: true,
        spgSaleId: true,
        spgSale: { select: { docNo: true } },
        lines: { select: { qty: true, saleLine: { select: { productName: true, variantSku: true } } } },
      },
    }),
    prisma.spgSaleReturn.count({ where }),
    prisma.spgSaleReturn.groupBy({ by: ["status"], where: dasar, _count: { _all: true } }),
    idKeputusan.length ? prisma.spgSaleReturn.count({ where: { ...dasar, id: { in: idKeputusan } } }) : Promise.resolve(0),
  ]);
  const [nama, toko, beban] = await Promise.all([
    namaPengguna(rows.flatMap((r) => [r.createdById, r.decidedById])),
    namaToko(rows.map((r) => r.storeId)),
    bebanUntukReturBanyak(rows.map((r) => r.id)),
  ]);
  const perStatus = Object.fromEntries(STATUS_RETUR_PEMBELI.map((x) => [x, 0])) as Record<StatusReturPembeli, number>;
  for (const g of grup) {
    const st = bacaStatusReturPembeli(g.status);
    if (st) perStatus[st] = g._count._all;
  }
  return {
    total,
    perStatus,
    keputusanBarang,
    baris: rows.map((r) => {
      const status = bacaStatusReturPembeli(r.status) ?? "MENUNGGU";
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
        uang: keadaanUangRetur({ status, uangTercatat: uangReturTercatat(r) }),
        beban: beban.get(r.id) ?? null,
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
  /** Uang pembeli: keadaannya, kapan dicatat SPG, atau siapa yang menandainya di kantor (P78) dan kenapa. */
  uang: { keadaan: KeadaanUangRetur; pada: Date | null; olehKantor: { oleh: string; alasan: string | null } | null };
  /** URL foto dari kunci tersimpannya — null bila tidak ada atau kuncinya tidak cocok. */
  foto: { barang: string | null; struk: string | null };
  /**
   * Foto struk yang dicatat SPG tetapi TIDAK tercatat di laporan ini — laporannya sudah ditarik,
   * atau potongnya sudah dilaporkan lagi di laporan lain (`catatUangDikembalikan`). Kuncinya hanya
   * ada di lonceng kantor yang membuka rincian ini; uangnya tidak menjadi beban apa pun.
   */
  strukTidakTercatat: { url: string; pada: Date }[];
  /** Beban yang lahir kalau laporan ini ditolak sekarang dengan uang dikembalikan (P81: harga bersih nota). */
  bebanJikaDitolak: number;
  /** Beban SPG laporan ini (sesudah ditolak), atau null. */
  beban: BebanReturKantor | null;
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
  }[];
  peringatan: {
    /**
     * Bulan WIB nota ASLINYA, "YYYY-MM" — bulan komisi yang dikurangi retur ini
     * (P9: "komisi di kurangi untuk bulan Oktober", lewat koreksi).
     */
    bulanKomisi: string;
    /**
     * Komisi SPG bulan nota itu sudah ditutup: laporan toko putus sudah dicek
     * (`SpgSalesCheck`) atau siklus konsinyasinya sudah dikunci — definisi yang
     * sama dengan `laporanTertutupDi` di `koreksi-queries.ts`.
     */
    komisiDitutup: boolean;
    /** Bulan WIB saat dilaporkan, "YYYY-MM" — bulan laporan konsinyasi yang berkurang (R25). */
    bulanLaporan: string;
    /** Angka resmi siklus konsinyasi toko itu di bulan laporan sudah dikunci. */
    siklusKonsiTerkunci: boolean;
  };
  /** Jejak laporan DAN bebannya, terlama dulu. */
  jejak: { action: string; entityType: string; oleh: string; pada: Date; reason: string | null }[];
};

/**
 * Foto struk dari lonceng "uang retur pembeli tidak tercatat" laporan ini. Laporannya tidak
 * berubah, jadi kunci foto itu hanya hidup di `AdminNotification.metadata.fotoStrukKey` — tanpa
 * pembaca ini foto yang dirujuk lonceng tidak bisa dibuka. Metadata disaring di JS (penyaringan
 * jalur JSON berbeda di MariaDB dan PostgreSQL); lonceng laporan ini tidak lebih tua dari
 * notanya. Hanya kunci struk di folder laporan ini sendiri (aturan yang sama dengan penulisnya),
 * satu baris per kunci (terlama dulu), dan bukan struk yang kemudian memang tercatat di laporan
 * ini (`refundSlipR2Key`).
 */
async function strukTidakTercatatUntuk(r: {
  id: string;
  storeId: string;
  idempotencyKey: string;
  refundSlipR2Key: string | null;
  sejak: Date;
}): Promise<{ url: string; pada: Date }[]> {
  const lonceng = await prisma.adminNotification.findMany({
    where: { category: KATEGORI_NOTIF_RETUR_PEMBELI, createdAt: { gte: r.sejak } },
    orderBy: { createdAt: "asc" },
    select: { metadata: true, createdAt: true },
  });
  const terlihat = new Set<string>();
  const hasil: { url: string; pada: Date }[] = [];
  for (const n of lonceng) {
    const m = n.metadata;
    if (m === null || typeof m !== "object" || Array.isArray(m)) continue;
    const isi = m as Record<string, unknown>;
    if (isi.returnId !== r.id || isi.tidakTercatat !== true) continue;
    const key = isi.fotoStrukKey;
    if (!kunciFotoReturPembeliSah(key, { storeId: r.storeId, kunci: r.idempotencyKey, jenis: "struk" })) continue;
    if (key === r.refundSlipR2Key || terlihat.has(key)) continue;
    const url = urlFotoReturPembeli({ storeId: r.storeId, key }, "struk");
    if (!url) continue;
    terlihat.add(key);
    hasil.push({ url, pada: n.createdAt });
  }
  return hasil;
}

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
      idempotencyKey: true,
      reason: true,
      decidedById: true,
      decidedAt: true,
      rejectReason: true,
      goodsPhotoR2Key: true,
      refundedAt: true,
      refundSlipR2Key: true,
      refundMarkedById: true,
      refundMarkReason: true,
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
  const status = bacaStatusReturPembeli(r.status) ?? "MENUNGGU";
  // Dua bulan yang berbeda: komisi berkurang di bulan nota ASLINYA (P9), laporan
  // konsinyasi dan penjualan bersih di bulan laporannya (R25).
  const bulanKomisi = wibYearMonth(r.spgSale.createdAt);
  const bulanLaporan = wibYearMonth(r.createdAt);
  const siklusTerkunci = (bulan: string) => {
    const [tahun, nomorBulan] = bulan.split("-").map(Number);
    return prisma.consignmentCycle.findFirst({
      where: { storeId: r.storeId, periodYear: tahun, periodMonth: nomorBulan, lockedAt: { not: null } },
      select: { id: true },
    });
  };

  const [nama, toko, menungguLain, dicek, siklusKomisi, siklus, jejak, beban, strukTidakTercatat] = await Promise.all([
    namaPengguna([r.createdById, r.decidedById, r.refundMarkedById]),
    namaToko([r.storeId]),
    qtyMenungguPerBaris(
      prisma,
      r.lines.map((l) => l.spgSaleLineId),
      { kecualiReturnId: r.id },
    ),
    prisma.spgSalesCheck.findFirst({ where: { storeId: r.storeId, period: bulanKomisi }, select: { id: true } }),
    siklusTerkunci(bulanKomisi),
    siklusTerkunci(bulanLaporan),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_RETUR_PEMBELI, entityId: r.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityType: true, userId: true, createdAt: true, reason: true },
    }),
    bebanUntukRetur(r.id),
    strukTidakTercatatUntuk({
      id: r.id,
      storeId: r.storeId,
      idempotencyKey: r.idempotencyKey,
      refundSlipR2Key: r.refundSlipR2Key,
      sejak: r.spgSale.createdAt,
    }),
  ]);
  if (beban) {
    const jejakBeban = await prisma.auditLog.findMany({
      where: { entityType: ENTITAS_BEBAN_SPG, entityId: beban.chargeId },
      orderBy: { createdAt: "asc" },
      select: { action: true, entityType: true, userId: true, createdAt: true, reason: true },
    });
    jejak.push(...jejakBeban);
    jejak.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  const namaJejak = await namaPengguna(jejak.map((j) => j.userId));
  const t = toko.get(r.storeId);
  const nilai = r.lines.map((l) => ({
    qty: l.qty,
    saleLine: { qty: l.saleLine.qty, lineTotal: l.saleLine.lineTotal === null ? null : angka(l.saleLine.lineTotal), unitPrice: angka(l.saleLine.unitPrice) },
  }));

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
    uang: {
      keadaan: keadaanUangRetur({ status, uangTercatat: uangReturTercatat(r) }),
      pada: r.refundedAt,
      olehKantor: r.refundMarkedById ? { oleh: nama.get(r.refundMarkedById) ?? "—", alasan: r.refundMarkReason } : null,
    },
    foto: {
      barang: urlFotoReturPembeli({ storeId: r.storeId, key: r.goodsPhotoR2Key }, "barang"),
      struk: urlFotoReturPembeli({ storeId: r.storeId, key: r.refundSlipR2Key }, "struk"),
    },
    strukTidakTercatat,
    bebanJikaDitolak: nilaiBebanReturPembeli(nilai),
    beban,
    baris: r.lines.map((l, i) => ({
      id: l.id,
      saleLineId: l.spgSaleLineId,
      productName: l.saleLine.productName,
      variantSku: l.saleLine.variantSku || l.variantSku,
      kondisi: l.condition,
      qty: l.qty,
      terjual: l.saleLine.qty,
      sudahKembali: l.saleLine.returnedQty,
      menungguLain: menungguLain.get(l.spgSaleLineId) ?? 0,
      nilaiBersih: nilaiBersihBarisRetur(nilai[i]),
    })),
    peringatan: {
      bulanKomisi,
      komisiDitutup: dicek !== null || siklusKomisi !== null,
      bulanLaporan,
      siklusKonsiTerkunci: siklus !== null,
    },
    jejak: jejak.map((j) => ({ action: j.action, entityType: j.entityType, oleh: namaJejak.get(j.userId) ?? "—", pada: j.createdAt, reason: j.reason })),
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
  /** Keadaan uang pembeli. */
  uang: KeadaanUangRetur;
  /** Keadaan beban (laporan ditolak yang uangnya sudah dikembalikan), tanpa angka — angkanya di "Beban saya". */
  beban: KeadaanBebanSpg | null;
  /**
   * Tombol "Uang sudah dikembalikan", uang belum tercatat: menunggu, disetujui, atau ditolak
   * (uang yang terlanjur keluar menjadi beban Anda, P13/P13a) — yang ditolak hanya selama
   * potongnya belum dilaporkan lagi di laporan lain, aturan yang sama dengan penulisnya.
   */
  bisaCatatUangKembali: boolean;
  /** Tombol "Tarik": menunggu dan uang belum tercatat — sesudahnya kantor yang memutuskan. */
  bisaDitarik: boolean;
};

/**
 * Laporan retur pembeli SPG ini di toko tetapnya, terbaru dulu. TANPA harga,
 * total, atau angka beban apa pun — di toko putus maupun konsi (dikunci tes
 * pada muatan yang diserialkan).
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
      refundedAt: true,
      refundMarkedById: true,
      spgSaleId: true,
      spgSale: { select: { docNo: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          qty: true,
          condition: true,
          variantSku: true,
          spgSaleLineId: true,
          saleLine: { select: { productName: true, variantSku: true, qty: true, returnedQty: true } },
        },
      },
    },
  });
  const beban = await bebanUntukReturBanyak(rows.filter((r) => r.status === "DITOLAK" || r.status === "DISETUJUI").map((r) => r.id));

  // Ditolak tanpa uang: potongnya sudah lepas. Pengembalian uangnya hanya bisa dicatat selama
  // potong itu masih muat — tidak dilaporkan lagi di laporan lain (`muatLagi` di penulisnya).
  const ditolakTanpaUang = rows.filter((r) => r.status === "DITOLAK" && !uangReturTercatat(r));
  const idBaris = [...new Set(ditolakTanpaUang.flatMap((r) => r.lines.map((l) => l.spgSaleLineId)))];
  // Daftar kosong → peta kosong tanpa kueri.
  const [menunggu, ditahan] = await Promise.all([qtyMenungguPerBaris(prisma, idBaris), qtyDitahanBebanPerBaris(prisma, idBaris)]);
  const masihMuat = (r: (typeof rows)[number]): boolean => {
    const minta = new Map<string, { n: number; qty: number; returnedQty: number }>();
    for (const l of r.lines) {
      const ada = minta.get(l.spgSaleLineId);
      if (ada) ada.n += l.qty;
      else minta.set(l.spgSaleLineId, { n: l.qty, qty: l.saleLine.qty, returnedQty: l.saleLine.returnedQty });
    }
    for (const [id, b] of minta) {
      if (b.returnedQty + (menunggu.get(id) ?? 0) + (ditahan.get(id) ?? 0) + b.n > b.qty) return false;
    }
    return true;
  };

  return rows.map((r) => {
    const status = bacaStatusReturPembeli(r.status) ?? "MENUNGGU";
    const tercatat = uangReturTercatat(r);
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
      uang: keadaanUangRetur({ status, uangTercatat: tercatat }),
      beban: beban.get(r.id)?.keadaan ?? null,
      bisaCatatUangKembali: !tercatat && (status === "MENUNGGU" || status === "DISETUJUI" || (status === "DITOLAK" && masihMuat(r))),
      bisaDitarik: status === "MENUNGGU" && !tercatat,
    };
  });
}

export type BarangDisisihkan = {
  productName: string;
  variantSku: string;
  qty: number;
  kondisi: KondisiRetur;
  docNo: string;
  /** MENUNGGU_KANTOR: laporannya menunggu kantor. TUNGGU_KEPUTUSAN: ditolak dengan beban, barangnya belum diputuskan. */
  tanda: "MENUNGGU_KANTOR" | "TUNGGU_KEPUTUSAN";
};

/**
 * Barang retur pembeli yang DISISIHKAN di toko (P12) — tidak di rak, tidak
 * dijual, tidak dihitung opname: baris laporan yang menunggu kantor, dan baris
 * laporan ditolak dengan beban yang barangnya belum diputuskan (P79). Tanpa harga.
 */
export async function barangDisisihkan(storeId: string): Promise<BarangDisisihkan[]> {
  if (!storeId) return [];
  const rows = await prisma.spgSaleReturn.findMany({
    where: { storeId, OR: [RETUR_PEMBELI_MENUNGGU, RETUR_PEMBELI_DITAHAN_BEBAN] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      spgSale: { select: { docNo: true } },
      lines: { orderBy: { id: "asc" }, select: { qty: true, condition: true, variantSku: true, saleLine: { select: { productName: true, variantSku: true } } } },
    },
  });
  const ditolak = rows.filter((r) => r.status === "DITOLAK").map((r) => r.id);
  const sudahDiputuskan = new Set(
    ditolak.length
      ? (
          await prisma.spgCharge.findMany({
            where: { source: "RETUR_PEMBELI", sourceId: { in: ditolak }, goodsDecision: { not: null } },
            select: { sourceId: true },
          })
        ).map((c) => c.sourceId)
      : [],
  );
  return rows
    .filter((r) => r.status === "MENUNGGU" || !sudahDiputuskan.has(r.id))
    .flatMap((r) =>
      r.lines.map((l) => ({
        productName: l.saleLine.productName,
        variantSku: l.saleLine.variantSku || l.variantSku,
        qty: l.qty,
        kondisi: l.condition,
        docNo: r.spgSale.docNo,
        tanda: r.status === "MENUNGGU" ? ("MENUNGGU_KANTOR" as const) : ("TUNGGU_KEPUTUSAN" as const),
      })),
    );
}

/** Tugas HP "Kembalikan uang pembeli": laporan SPG ini yang disetujui, uangnya belum tercatat kembali. */
export async function jumlahReturUangBelumKembali(userId: string, storeId: string): Promise<number> {
  if (!userId || !storeId) return 0;
  return prisma.spgSaleReturn.count({ where: { createdById: userId, storeId, status: "DISETUJUI", refundedAt: null, refundMarkedById: null } });
}
