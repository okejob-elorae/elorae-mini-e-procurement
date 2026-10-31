import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import {
  bacaAturanMutasi,
  ENTITAS_MUTASI,
  keputusanArah,
  KUNCI_ATURAN_MUTASI,
  STATUS_BELUM_DIKIRIM,
  STATUS_MUTASI,
  sudahMacet,
  type AturanMutasi,
  type KeputusanArah,
  type SelisihMutasi,
  type StatusMutasi,
} from "./mutasi-aturan";
import { kunciBaris } from "./stok";

/**
 * Kueri mutasi antar toko: layar HP SPG dan layar kantor.
 *
 * Mutasi tidak membawa harga sama sekali — tidak ada yang perlu disembunyikan
 * dari HP. Tanggal diformat di server (WIB) supaya Node dan Safari tidak berbeda.
 */

export async function aturanMutasi(): Promise<AturanMutasi> {
  const s = await prisma.systemSetting.findUnique({ where: { key: KUNCI_ATURAN_MUTASI }, select: { value: true } });
  return bacaAturanMutasi(s?.value);
}

const pcs = (lines: { qty: number }[]) => lines.reduce((n, l) => n + l.qty, 0);

async function namaPengguna(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unik.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

/** Mutasi DIKEMBALIKAN yang barangnya sudah diterima kembali toko asal. */
async function sudahDiterimaKembali(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = await prisma.storeReceipt.findMany({ where: { sourceType: "MUTASI_KEMBALI", sourceId: { in: ids } }, select: { sourceId: true } });
  return new Set(r.map((x) => x.sourceId));
}

// ─── HP SPG ──────────────────────────────────────────────────────────────────

export type MutasiHp = {
  id: string;
  docNo: string;
  arah: "KELUAR" | "MASUK";
  status: StatusMutasi;
  selisihStatus: SelisihMutasi | null;
  tokoLain: string;
  tanggal: string;
  baris: number;
  pcs: number;
  /** Ada yang harus dilakukan SPG toko ini: kirim, terima, atau terima kembali. */
  tindakan: "KIRIM" | "TERIMA" | "TERIMA_KEMBALI" | null;
};

const PILIH_HP = {
  id: true,
  docNo: true,
  fromStoreId: true,
  toStoreId: true,
  status: true,
  selisihStatus: true,
  createdAt: true,
  shippedAt: true,
  fromStore: { select: { name: true } },
  toStore: { select: { name: true } },
  lines: { select: { qty: true } },
} as const;

/**
 * Mutasi toko ini untuk HP SPG, dikelompokkan: keluar (dari toko ini), masuk
 * (ke toko ini — hanya yang sudah dikirim; ajuan toko lain bukan urusannya),
 * dan di jalan (dikirim/dikembalikan, belum diterima).
 */
export async function daftarMutasiHp(storeId: string): Promise<{ keluar: MutasiHp[]; masuk: MutasiHp[]; diJalan: MutasiHp[] }> {
  const [keluar, masuk] = await Promise.all([
    prisma.storeTransfer.findMany({ where: { fromStoreId: storeId }, orderBy: { createdAt: "desc" }, take: 60, select: PILIH_HP }),
    prisma.storeTransfer.findMany({
      where: { toStoreId: storeId, status: { in: ["DIKIRIM", "DITERIMA"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: PILIH_HP,
    }),
  ]);
  const kembali = await sudahDiterimaKembali(keluar.filter((m) => m.status === "DIKEMBALIKAN").map((m) => m.id));

  const bentuk = (m: (typeof keluar)[number], arah: "KELUAR" | "MASUK"): MutasiHp => {
    const tindakan =
      arah === "KELUAR"
        ? m.status === "DISETUJUI"
          ? "KIRIM"
          : m.status === "DIKEMBALIKAN" && m.shippedAt && !kembali.has(m.id)
            ? "TERIMA_KEMBALI"
            : null
        : m.status === "DIKIRIM"
          ? "TERIMA"
          : null;
    return {
      id: m.id,
      docNo: m.docNo,
      arah,
      status: m.status,
      selisihStatus: m.selisihStatus,
      tokoLain: arah === "KELUAR" ? m.toStore.name : m.fromStore.name,
      tanggal: formatDisplayDate(m.shippedAt ?? m.createdAt),
      baris: m.lines.length,
      pcs: pcs(m.lines),
      tindakan,
    };
  };
  const k = keluar.map((m) => bentuk(m, "KELUAR"));
  const ma = masuk.map((m) => bentuk(m, "MASUK"));
  return {
    keluar: k,
    masuk: ma,
    diJalan: [...k.filter((m) => m.status === "DIKIRIM" || m.tindakan === "TERIMA_KEMBALI"), ...ma.filter((m) => m.status === "DIKIRIM")],
  };
}

export type RincianMutasiHp = {
  id: string;
  docNo: string;
  arah: "KELUAR" | "MASUK";
  status: StatusMutasi;
  selisihStatus: SelisihMutasi | null;
  asal: string;
  tujuan: string;
  alasan: string;
  catatanKantor: string | null;
  diajukan: string;
  dikirim: string | null;
  baris: { id: string; productName: string; variantSku: string; qty: number; diterima: number | null }[];
  tindakan: MutasiHp["tindakan"];
  bolehBatal: boolean;
};

/** Satu mutasi untuk HP — hanya bila toko ini asal atau tujuannya. */
export async function rincianMutasiHp(id: string, storeId: string): Promise<RincianMutasiHp | null> {
  const m = await prisma.storeTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      fromStoreId: true,
      toStoreId: true,
      status: true,
      selisihStatus: true,
      reason: true,
      reviewNote: true,
      createdAt: true,
      shippedAt: true,
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
      lines: { orderBy: { productName: "asc" }, select: { id: true, itemId: true, productName: true, variantSku: true, qty: true } },
    },
  });
  if (!m) return null;
  const arah = m.fromStoreId === storeId ? "KELUAR" : m.toStoreId === storeId ? "MASUK" : null;
  // Toko tujuan baru melihat mutasi sesudah barangnya berangkat.
  if (!arah || (arah === "MASUK" && m.status !== "DIKIRIM" && m.status !== "DITERIMA")) return null;

  const terima = await prisma.storeReceipt.findMany({
    where: { sourceId: m.id, sourceType: { in: ["MUTASI", "MUTASI_KEMBALI"] } },
    select: { sourceType: true, lines: { select: { itemId: true, variantSku: true, qtyReceived: true } } },
  });
  const tandaTerima = terima.find((r) => r.sourceType === (m.status === "DIKEMBALIKAN" ? "MUTASI_KEMBALI" : "MUTASI"));
  const diterima = new Map((tandaTerima?.lines ?? []).map((l) => [kunciBaris(l.itemId ?? "", l.variantSku), l.qtyReceived]));
  const kembaliDiterima = terima.some((r) => r.sourceType === "MUTASI_KEMBALI");

  const tindakan: MutasiHp["tindakan"] =
    arah === "KELUAR"
      ? m.status === "DISETUJUI"
        ? "KIRIM"
        : m.status === "DIKEMBALIKAN" && m.shippedAt && !kembaliDiterima
          ? "TERIMA_KEMBALI"
          : null
      : m.status === "DIKIRIM"
        ? "TERIMA"
        : null;

  return {
    id: m.id,
    docNo: m.docNo,
    arah,
    status: m.status,
    selisihStatus: m.selisihStatus,
    asal: m.fromStore.name,
    tujuan: m.toStore.name,
    alasan: m.reason,
    catatanKantor: m.reviewNote,
    diajukan: formatDisplayDateTime(m.createdAt),
    dikirim: m.shippedAt ? formatDisplayDateTime(m.shippedAt) : null,
    baris: m.lines.map((l) => ({
      id: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      diterima: tandaTerima ? (diterima.get(kunciBaris(l.itemId, l.variantSku)) ?? 0) : null,
    })),
    tindakan,
    bolehBatal: arah === "KELUAR" && (STATUS_BELUM_DIKIRIM as readonly string[]).includes(m.status),
  };
}

export type TujuanMutasi = { id: string; name: string; code: string; termsType: "PUTUS" | "KONSI"; punyaSpg: boolean; keputusan: KeputusanArah };

/** Toko tujuan yang boleh dipilih dari toko ini — aturan yang sama dengan penulisnya. */
export async function tujuanMutasi(dariStoreId: string, aturan: AturanMutasi): Promise<TujuanMutasi[]> {
  const asal = await prisma.store.findUnique({ where: { id: dariStoreId }, select: { termsType: true } });
  if (!asal) return [];
  const [toko, spg] = await Promise.all([
    prisma.store.findMany({
      where: { isActive: true, id: { not: dariStoreId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, termsType: true },
    }),
    prisma.user.groupBy({ by: ["assignedStoreId"], where: { assignedStoreId: { not: null } }, _count: { _all: true } }),
  ]);
  const berSpg = new Set(spg.map((s) => s.assignedStoreId));
  return toko
    .map((t) => ({ ...t, punyaSpg: berSpg.has(t.id), keputusan: keputusanArah(aturan, asal.termsType, t.termsType) }))
    .filter((t) => t.keputusan !== "TOLAK" && (aturan.tujuanTanpaSpg || t.punyaSpg));
}

/** Barang di mutasi keluar lain yang belum dikirim, per barang+varian — janji atas saldo buku. */
export async function dijanjikanMutasi(storeId: string): Promise<Map<string, number>> {
  const rows = await prisma.storeTransferLine.findMany({
    where: { transfer: { fromStoreId: storeId, status: { in: [...STATUS_BELUM_DIKIRIM] } } },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const peta = new Map<string, number>();
  for (const r of rows) peta.set(kunciBaris(r.itemId, r.variantSku), (peta.get(kunciBaris(r.itemId, r.variantSku)) ?? 0) + r.qty);
  return peta;
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

export type BarisMutasiKantor = {
  id: string;
  docNo: string;
  status: StatusMutasi;
  selisihStatus: SelisihMutasi | null;
  asal: string;
  tujuan: string;
  pengaju: string;
  dibuat: string;
  baris: number;
  pcs: number;
  macet: boolean;
};

export type DaftarMutasiKantor = {
  baris: BarisMutasiKantor[];
  perStatus: Record<StatusMutasi, number>;
  selisihTerbuka: number;
  total: number;
};

export async function daftarMutasiKantor(opsi: {
  status: StatusMutasi | null;
  selisih: boolean;
  cari: string | null;
  sekarang?: Date;
}): Promise<DaftarMutasiKantor> {
  const sekarang = opsi.sekarang ?? new Date();
  const aturan = await aturanMutasi();
  const cari = opsi.cari?.trim();
  const where = {
    ...(opsi.status ? { status: opsi.status } : {}),
    ...(opsi.selisih ? { selisihStatus: "TERBUKA" as const } : {}),
    ...(cari
      ? {
          OR: [
            { docNo: cariTeks(cari) },
            { fromStore: { name: cariTeks(cari) } },
            { toStore: { name: cariTeks(cari) } },
          ],
        }
      : {}),
  };
  const [rows, grup, selisihTerbuka, total] = await Promise.all([
    prisma.storeTransfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        docNo: true,
        status: true,
        selisihStatus: true,
        createdAt: true,
        shippedAt: true,
        createdById: true,
        fromStore: { select: { name: true } },
        toStore: { select: { name: true } },
        lines: { select: { qty: true } },
      },
    }),
    prisma.storeTransfer.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.storeTransfer.count({ where: { selisihStatus: "TERBUKA" } }),
    prisma.storeTransfer.count(),
  ]);
  const nama = await namaPengguna(rows.map((r) => r.createdById));
  const perStatus = Object.fromEntries(STATUS_MUTASI.map((s) => [s, 0])) as Record<StatusMutasi, number>;
  for (const g of grup) perStatus[g.status] = g._count._all;
  return {
    baris: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      status: r.status,
      selisihStatus: r.selisihStatus,
      asal: r.fromStore.name,
      tujuan: r.toStore.name,
      pengaju: nama.get(r.createdById) ?? "—",
      dibuat: formatDisplayDate(r.createdAt),
      baris: r.lines.length,
      pcs: pcs(r.lines),
      macet: r.status === "DIKIRIM" && sudahMacet(r.shippedAt, aturan.hariPengingat, sekarang),
    })),
    perStatus,
    selisihTerbuka,
    total,
  };
}

export type RincianMutasiKantor = {
  id: string;
  docNo: string;
  status: StatusMutasi;
  selisihStatus: SelisihMutasi | null;
  selisihCatatan: string | null;
  asal: { id: string; name: string; termsType: string; spg: string[] };
  tujuan: { id: string; name: string; termsType: string; spg: string[] };
  alasan: string;
  catatanKantor: string | null;
  pengajuId: string;
  pengaju: string;
  diajukan: string;
  disetujui: { oleh: string | null; pada: string } | null;
  dikirim: { oleh: string; pada: string } | null;
  dibatalkan: { oleh: string; pada: string } | null;
  baris: { id: string; productName: string; variantSku: string; qty: number; diterima: number | null }[];
  tandaTerima: { sumber: "MUTASI" | "MUTASI_KEMBALI"; oleh: string; pada: string; catatan: string | null } | null;
  macet: boolean;
  /** Kantor boleh menerima atas nama toko: tujuan (atau asal, untuk barang kembali) tanpa SPG, atau macet. */
  terimaKantor: "MUTASI" | "MUTASI_KEMBALI" | null;
  /** Toko tujuan pengganti yang sah (untuk alihkan tujuan). */
  pilihanTujuan: { id: string; name: string; punyaSpg: boolean }[];
  riwayat: { id: string; action: string; oleh: string; pada: string; alasan: string | null }[];
  hariPengingat: number;
};

export async function rincianMutasiKantor(id: string, sekarang = new Date()): Promise<RincianMutasiKantor | null> {
  const m = await prisma.storeTransfer.findUnique({
    where: { id },
    select: {
      id: true,
      docNo: true,
      status: true,
      selisihStatus: true,
      selisihNote: true,
      reason: true,
      reviewNote: true,
      createdById: true,
      createdAt: true,
      approvedById: true,
      approvedAt: true,
      shippedById: true,
      shippedAt: true,
      cancelledById: true,
      cancelledAt: true,
      fromStore: { select: { id: true, name: true, termsType: true } },
      toStore: { select: { id: true, name: true, termsType: true } },
      lines: { orderBy: { productName: "asc" }, select: { id: true, itemId: true, productName: true, variantSku: true, qty: true } },
    },
  });
  if (!m) return null;
  const aturan = await aturanMutasi();
  const [terima, jejak, spgAsal, spgTujuan] = await Promise.all([
    prisma.storeReceipt.findMany({
      where: { sourceId: m.id, sourceType: { in: ["MUTASI", "MUTASI_KEMBALI"] } },
      select: { sourceType: true, receivedById: true, receivedAt: true, note: true, lines: { select: { itemId: true, variantSku: true, qtyReceived: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: ENTITAS_MUTASI, entityId: m.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, userId: true, createdAt: true, reason: true },
    }),
    prisma.user.findMany({ where: { assignedStoreId: m.fromStore.id }, select: { name: true, email: true } }),
    prisma.user.findMany({ where: { assignedStoreId: m.toStore.id }, select: { name: true, email: true } }),
  ]);
  const nama = await namaPengguna([
    m.createdById,
    m.approvedById,
    m.shippedById,
    m.cancelledById,
    ...terima.map((t) => t.receivedById),
    ...jejak.map((j) => j.userId),
  ]);
  const sumberAktif = m.status === "DIKEMBALIKAN" ? "MUTASI_KEMBALI" : "MUTASI";
  const tandaTerima = terima.find((t) => t.sourceType === sumberAktif) ?? null;
  const diterima = new Map((tandaTerima?.lines ?? []).map((l) => [kunciBaris(l.itemId ?? "", l.variantSku), l.qtyReceived]));
  const macet = m.status === "DIKIRIM" && sudahMacet(m.shippedAt, aturan.hariPengingat, sekarang);

  let terimaKantor: RincianMutasiKantor["terimaKantor"] = null;
  if (m.status === "DIKIRIM" && (spgTujuan.length === 0 || macet)) terimaKantor = "MUTASI";
  if (
    m.status === "DIKEMBALIKAN" &&
    m.shippedAt &&
    !tandaTerima &&
    (spgAsal.length === 0 || sudahMacet(m.cancelledAt ?? m.shippedAt, aturan.hariPengingat, sekarang))
  ) {
    terimaKantor = "MUTASI_KEMBALI";
  }

  let pilihanTujuan: RincianMutasiKantor["pilihanTujuan"] = [];
  if (m.status === "DIKIRIM") {
    const asalJenis = m.fromStore.termsType;
    const [toko, spg] = await Promise.all([
      prisma.store.findMany({
        where: { isActive: true, id: { notIn: [m.fromStore.id, m.toStore.id] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, termsType: true },
      }),
      prisma.user.groupBy({ by: ["assignedStoreId"], where: { assignedStoreId: { not: null } }, _count: { _all: true } }),
    ]);
    const berSpg = new Set(spg.map((s) => s.assignedStoreId));
    pilihanTujuan = toko
      .filter((t) => keputusanArah(aturan, asalJenis, t.termsType) !== "TOLAK" && (aturan.tujuanTanpaSpg || berSpg.has(t.id)))
      .map((t) => ({ id: t.id, name: t.name, punyaSpg: berSpg.has(t.id) }));
  }

  const orang = (u: { name: string | null; email: string }) => u.name ?? u.email;
  return {
    id: m.id,
    docNo: m.docNo,
    status: m.status,
    selisihStatus: m.selisihStatus,
    selisihCatatan: m.selisihNote,
    asal: { id: m.fromStore.id, name: m.fromStore.name, termsType: m.fromStore.termsType, spg: spgAsal.map(orang) },
    tujuan: { id: m.toStore.id, name: m.toStore.name, termsType: m.toStore.termsType, spg: spgTujuan.map(orang) },
    alasan: m.reason,
    catatanKantor: m.reviewNote,
    pengajuId: m.createdById,
    pengaju: nama.get(m.createdById) ?? "—",
    diajukan: formatDisplayDateTime(m.createdAt),
    disetujui: m.approvedAt ? { oleh: m.approvedById ? (nama.get(m.approvedById) ?? "—") : null, pada: formatDisplayDateTime(m.approvedAt) } : null,
    dikirim: m.shippedAt ? { oleh: nama.get(m.shippedById ?? "") ?? "—", pada: formatDisplayDateTime(m.shippedAt) } : null,
    dibatalkan: m.cancelledAt ? { oleh: nama.get(m.cancelledById ?? "") ?? "—", pada: formatDisplayDateTime(m.cancelledAt) } : null,
    baris: m.lines.map((l) => ({
      id: l.id,
      productName: l.productName,
      variantSku: l.variantSku,
      qty: l.qty,
      diterima: tandaTerima ? (diterima.get(kunciBaris(l.itemId, l.variantSku)) ?? 0) : null,
    })),
    tandaTerima: tandaTerima
      ? {
          sumber: tandaTerima.sourceType as "MUTASI" | "MUTASI_KEMBALI",
          oleh: nama.get(tandaTerima.receivedById) ?? "—",
          pada: formatDisplayDateTime(tandaTerima.receivedAt),
          catatan: tandaTerima.note,
        }
      : null,
    macet,
    terimaKantor,
    pilihanTujuan,
    riwayat: jejak.map((j) => ({
      id: j.id,
      action: j.action,
      oleh: nama.get(j.userId) ?? "—",
      pada: formatDisplayDateTime(j.createdAt),
      alasan: j.reason,
    })),
    hariPengingat: aturan.hariPengingat,
  };
}
