import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import {
  REF_BEBAN_KE_UTANG,
  bacaJenisTokoBeban,
  bacaKeputusanBarangBeban,
  bacaStatusBebanSpg,
  bebanSudahDiganti,
  keadaanBebanSpg,
  type BebanSpgTerbuka,
  type JenisTokoBeban,
  type KeadaanBebanSpg,
  type KembaliBebanTerbuka,
  type KeputusanBarangBeban,
  type StatusBebanSpg,
} from "./beban-spg";

/**
 * Pembaca beban SPG — perencana bayar, HP ("Beban saya"), kantor (kartu beban
 * di rincian retur, tab "Perlu keputusan barang", Beranda). Hanya membaca
 * `SpgCharge`/`SpgChargeDeduction` (dan status utang SPG); nomor nota dan
 * tanggal laporan diambil dari salinannya di beban (`sourceDocNo`,
 * `reportedAt`), jadi tidak ada bacaan `SpgSaleReturn` di sini.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);
const keSen = (rupiah: number) => Math.round(rupiah * 100);
const bulat2 = (n: number) => Math.round(n * 100) / 100;
const namaOrang = (u: { name: string | null; email: string } | null | undefined) => u?.name?.trim() || u?.email || "—";

const unik = (xs: readonly (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];

/** Status utang SPG per id (`true` = LUNAS). */
async function utangLunas(klien: Klien, debtIds: readonly string[]): Promise<Map<string, boolean>> {
  const ids = unik(debtIds);
  if (ids.length === 0) return new Map();
  const rows = await klien.spgDebt.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return new Map(rows.map((r) => [r.id, r.status === "LUNAS"]));
}

/** `bebanSudahDiganti` per beban, membaca utang SPG yang menanggung sisanya. */
async function petaDiganti(
  klien: Klien,
  beban: readonly { id: string; status: string; deductions: readonly { paidRefType: string; paidRefId: string }[] }[],
): Promise<Map<string, boolean>> {
  const lunas = await utangLunas(
    klien,
    beban.flatMap((b) => b.deductions.filter((d) => d.paidRefType === REF_BEBAN_KE_UTANG).map((d) => d.paidRefId)),
  );
  return new Map(
    beban.map((b) => [
      b.id,
      bebanSudahDiganti({
        status: b.status,
        utang: b.deductions.filter((d) => d.paidRefType === REF_BEBAN_KE_UTANG).map((d) => ({ lunas: lunas.get(d.paidRefId) ?? false })),
      }),
    ]),
  );
}

/* ---------------------------------------------------------- perencana bayar */

/**
 * Beban TERBUKA setiap SPG, terlama dulu (createdAt, lalu id) — masukan WAJIB
 * setiap pemanggil rencana bayar, supaya yang ditampilkan = yang dibayar.
 */
export async function bebanSpgTerbukaPerOrang(klien: Klien, userIds: readonly string[]): Promise<Map<string, BebanSpgTerbuka[]>> {
  const ids = unik(userIds);
  const hasil = new Map<string, BebanSpgTerbuka[]>();
  if (ids.length === 0) return hasil;
  const rows = await klien.spgCharge.findMany({
    where: { spgUserId: { in: ids }, status: "TERBUKA" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, spgUserId: true, source: true, sourceId: true, sourceDocNo: true, storeId: true, sourceKind: true, createdAt: true, amount: true, settledAmount: true },
  });
  for (const r of rows) {
    const sisa = bulat2(angka(r.amount) - angka(r.settledAmount));
    if (keSen(sisa) <= 0) continue;
    const daftar = hasil.get(r.spgUserId) ?? [];
    daftar.push({
      id: r.id,
      sumber: "RETUR_PEMBELI",
      sumberId: r.sourceId,
      docNo: r.sourceDocNo,
      storeId: r.storeId,
      jenisToko: bacaJenisTokoBeban(r.sourceKind),
      dibuatPada: r.createdAt.toISOString(),
      sisa,
    });
    hasil.set(r.spgUserId, daftar);
  }
  return hasil;
}

/** Uang beban yang dikembalikan (KEMBALI_STOK) dan belum dibayarkan, per SPG — dibayar penuh di pembayaran berikutnya. */
export async function kembaliBebanTerbukaPerOrang(klien: Klien, userIds: readonly string[]): Promise<Map<string, KembaliBebanTerbuka[]>> {
  const ids = unik(userIds);
  const hasil = new Map<string, KembaliBebanTerbuka[]>();
  if (ids.length === 0) return hasil;
  const rows = await klien.spgCharge.findMany({
    where: { spgUserId: { in: ids }, goodsDecision: "KEMBALI_STOK", paybackPaidAt: null },
    orderBy: [{ goodsDecidedAt: "asc" }, { id: "asc" }],
    select: { id: true, spgUserId: true, sourceDocNo: true, storeId: true, sourceKind: true, paybackAmount: true },
  });
  for (const r of rows) {
    const jumlah = angka(r.paybackAmount);
    if (keSen(jumlah) <= 0) continue;
    const daftar = hasil.get(r.spgUserId) ?? [];
    daftar.push({ id: r.id, docNo: r.sourceDocNo, storeId: r.storeId, jenisToko: bacaJenisTokoBeban(r.sourceKind), jumlah });
    hasil.set(r.spgUserId, daftar);
  }
  return hasil;
}

export type BebanPembayaran = {
  potong: { chargeId: string; docNo: string; jumlah: number; dariKomisi: number; dariGaji: number; storeId: string; jenisToko: JenisTokoBeban }[];
  kembali: { chargeId: string; docNo: string; jumlah: number; storeId: string; jenisToko: JenisTokoBeban }[];
};

/**
 * Potongan dan pengembalian beban yang dibawa baris-baris yang SUDAH dibayar,
 * dikunci `refId` baris itu — untuk layar gaji, slip, dan jurnal pembayaran.
 */
export async function bebanPadaPembayaran(
  klien: Klien,
  refs: ReadonlyArray<{ refType: string; refId: string }>,
): Promise<Map<string, BebanPembayaran>> {
  const hasil = new Map<string, BebanPembayaran>();
  const pasangan = refs.filter((r) => r.refType && r.refId);
  if (pasangan.length === 0) return hasil;
  const ambil = (refId: string) => {
    const ada = hasil.get(refId);
    if (ada) return ada;
    const baru: BebanPembayaran = { potong: [], kembali: [] };
    hasil.set(refId, baru);
    return baru;
  };
  const [potong, kembali] = await Promise.all([
    klien.spgChargeDeduction.findMany({
      where: { OR: pasangan.map((r) => ({ paidRefType: r.refType, paidRefId: r.refId })) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        paidRefId: true,
        amount: true,
        fromCommission: true,
        fromSalary: true,
        charge: { select: { id: true, sourceDocNo: true, storeId: true, sourceKind: true } },
      },
    }),
    klien.spgCharge.findMany({
      where: { OR: pasangan.map((r) => ({ paybackPaidRefType: r.refType, paybackPaidRefId: r.refId })) },
      select: { id: true, sourceDocNo: true, storeId: true, sourceKind: true, paybackAmount: true, paybackPaidRefId: true },
    }),
  ]);
  for (const p of potong) {
    ambil(p.paidRefId).potong.push({
      chargeId: p.charge.id,
      docNo: p.charge.sourceDocNo,
      jumlah: angka(p.amount),
      dariKomisi: angka(p.fromCommission),
      dariGaji: angka(p.fromSalary),
      storeId: p.charge.storeId,
      jenisToko: bacaJenisTokoBeban(p.charge.sourceKind),
    });
  }
  for (const k of kembali) {
    if (!k.paybackPaidRefId) continue;
    ambil(k.paybackPaidRefId).kembali.push({
      chargeId: k.id,
      docNo: k.sourceDocNo,
      jumlah: angka(k.paybackAmount),
      storeId: k.storeId,
      jenisToko: bacaJenisTokoBeban(k.sourceKind),
    });
  }
  return hasil;
}

/* ------------------------------------------------------------------ kantor */

export type BebanReturRingkas = {
  chargeId: string;
  status: StatusBebanSpg;
  keadaan: KeadaanBebanSpg;
  jumlah: number;
  dipotong: number;
  sisa: number;
};

const PILIH_BEBAN = {
  id: true,
  sourceId: true,
  spgUserId: true,
  status: true,
  amount: true,
  computedAmount: true,
  amountReason: true,
  settledAmount: true,
  goodsDecision: true,
  deductions: { select: { paidRefType: true, paidRefId: true } },
} satisfies Prisma.SpgChargeSelect;

/** Ringkasan beban per laporan (daftar kantor). Laporan tanpa beban tidak ada di peta. */
export async function bebanUntukReturBanyak(returnIds: readonly string[]): Promise<Map<string, BebanReturRingkas>> {
  const ids = unik(returnIds);
  const hasil = new Map<string, BebanReturRingkas>();
  if (ids.length === 0) return hasil;
  const rows = await prisma.spgCharge.findMany({ where: { source: "RETUR_PEMBELI", sourceId: { in: ids } }, select: PILIH_BEBAN });
  const diganti = await petaDiganti(prisma, rows);
  for (const r of rows) {
    const status = bacaStatusBebanSpg(r.status) ?? "TERBUKA";
    const jumlah = angka(r.amount);
    const dipotong = angka(r.settledAmount);
    hasil.set(r.sourceId, {
      chargeId: r.id,
      status,
      keadaan: keadaanBebanSpg({ status, goodsDecision: r.goodsDecision, diganti: diganti.get(r.id) ?? false }),
      jumlah,
      dipotong,
      sisa: status === "BATAL" ? 0 : bulat2(jumlah - dipotong),
    });
  }
  return hasil;
}

export type BebanReturKantor = {
  chargeId: string;
  spgUserId: string;
  spg: string;
  status: StatusBebanSpg;
  keadaan: KeadaanBebanSpg;
  dihitung: number;
  jumlah: number;
  alasanJumlah: string | null;
  dipotong: number;
  sisa: number;
  potongan: { bulan: string; jumlah: number; dariKomisi: number; dariGaji: number; keUtang: boolean; utangLunas: boolean | null; pada: Date }[];
  barang: { keputusan: KeputusanBarangBeban; oleh: string; pada: Date; catatan: string | null } | null;
  kembali: { jumlah: number; mengurangiUtang: number; dibayarPada: Date | null; bulan: string | null } | null;
  dibatalkan: { oleh: string; pada: Date; alasan: string | null } | null;
  /** P82: belum ada satu pun potongan atas beban ini — tidak dari bayaran, tidak dipindah ke utang SPG (sama dengan `bisaBatalkanBebanTx`). */
  bisaDibatalkan: boolean;
  /** P81: belum ada yang dipotong sama sekali. */
  bisaDiubah: boolean;
  /** P79: sudah diganti penuh dan barangnya belum diputuskan. */
  bisaDiputuskan: boolean;
};

/** Kartu beban di rincian retur kantor. `null` = laporan ini tidak punya beban. */
export async function bebanUntukRetur(returnId: string): Promise<BebanReturKantor | null> {
  if (!returnId) return null;
  const c = await prisma.spgCharge.findUnique({
    where: { source_sourceId: { source: "RETUR_PEMBELI", sourceId: returnId } },
    select: {
      id: true,
      spgUserId: true,
      status: true,
      computedAmount: true,
      amount: true,
      amountReason: true,
      settledAmount: true,
      goodsDecision: true,
      goodsDecidedAt: true,
      goodsDecidedById: true,
      goodsDecisionNote: true,
      paybackAmount: true,
      paybackPaidAt: true,
      paybackPayoutMonth: true,
      cancelledAt: true,
      cancelledById: true,
      cancelReason: true,
      deductions: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { amount: true, fromCommission: true, fromSalary: true, paidRefType: true, paidRefId: true, payoutMonth: true, createdAt: true },
      },
    },
  });
  if (!c) return null;
  const utangIds = c.deductions.filter((d) => d.paidRefType === REF_BEBAN_KE_UTANG).map((d) => d.paidRefId);
  const [utang, orang] = await Promise.all([
    utangIds.length ? prisma.spgDebt.findMany({ where: { id: { in: utangIds } }, select: { id: true, status: true } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { id: { in: unik([c.spgUserId, c.goodsDecidedById, c.cancelledById]) } }, select: { id: true, name: true, email: true } }),
  ]);
  const nama = new Map(orang.map((o) => [o.id, namaOrang(o)]));
  const utangPer = new Map(utang.map((u) => [u.id, u]));
  const status = bacaStatusBebanSpg(c.status) ?? "TERBUKA";
  const diganti = bebanSudahDiganti({ status, utang: utangIds.map((id) => ({ lunas: utangPer.get(id)?.status === "LUNAS" })) });
  const jumlah = angka(c.amount);
  const dipotong = angka(c.settledAmount);
  const keputusan = bacaKeputusanBarangBeban(c.goodsDecision);
  const kembaliJumlah = angka(c.paybackAmount);
  return {
    chargeId: c.id,
    spgUserId: c.spgUserId,
    spg: nama.get(c.spgUserId) ?? "—",
    status,
    keadaan: keadaanBebanSpg({ status, goodsDecision: c.goodsDecision, diganti }),
    dihitung: angka(c.computedAmount),
    jumlah,
    alasanJumlah: c.amountReason,
    dipotong,
    sisa: status === "BATAL" ? 0 : bulat2(jumlah - dipotong),
    potongan: c.deductions.map((d) => {
      const keUtang = d.paidRefType === REF_BEBAN_KE_UTANG;
      return {
        bulan: d.payoutMonth,
        jumlah: angka(d.amount),
        dariKomisi: angka(d.fromCommission),
        dariGaji: angka(d.fromSalary),
        keUtang,
        utangLunas: keUtang ? utangPer.get(d.paidRefId)?.status === "LUNAS" : null,
        pada: d.createdAt,
      };
    }),
    barang:
      keputusan && c.goodsDecidedAt
        ? { keputusan, oleh: c.goodsDecidedById ? (nama.get(c.goodsDecidedById) ?? "—") : "—", pada: c.goodsDecidedAt, catatan: c.goodsDecisionNote }
        : null,
    kembali:
      keputusan === "KEMBALI_STOK"
        ? { jumlah: kembaliJumlah, mengurangiUtang: bulat2(dipotong - kembaliJumlah), dibayarPada: c.paybackPaidAt, bulan: c.paybackPayoutMonth }
        : null,
    dibatalkan: c.cancelledAt ? { oleh: c.cancelledById ? (nama.get(c.cancelledById) ?? "—") : "—", pada: c.cancelledAt, alasan: c.cancelReason } : null,
    bisaDibatalkan: status !== "BATAL" && status !== "DIUTANGKAN" && keputusan === null && c.deductions.length === 0 && keSen(dipotong) === 0,
    bisaDiubah:
      (status === "TERBUKA" || (status === "LUNAS" && keSen(jumlah) === 0)) && keSen(dipotong) === 0 && c.deductions.length === 0 && keputusan === null,
    bisaDiputuskan: diganti && keputusan === null,
  };
}

/**
 * Beban yang sudah diganti penuh dan barangnya belum diputuskan (P79), untuk
 * tab "Perlu keputusan barang" dan Beranda. LUNAS, atau DIUTANGKAN dengan
 * setiap utangnya lunas.
 */
export async function bebanMenungguKeputusanBarang(opsi: { storeId?: string | null } = {}): Promise<{ chargeId: string; returnId: string }[]> {
  const rows = await prisma.spgCharge.findMany({
    where: { source: "RETUR_PEMBELI", status: { in: ["LUNAS", "DIUTANGKAN"] }, goodsDecision: null, ...(opsi.storeId ? { storeId: opsi.storeId } : {}) },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: { id: true, sourceId: true, status: true, deductions: { select: { paidRefType: true, paidRefId: true } } },
  });
  const diganti = await petaDiganti(prisma, rows);
  return rows.filter((r) => diganti.get(r.id)).map((r) => ({ chargeId: r.id, returnId: r.sourceId }));
}

/** Angka Beranda `spgReturnGoodsPending`. */
export async function jumlahBebanPerluKeputusanBarang(): Promise<number> {
  return (await bebanMenungguKeputusanBarang()).length;
}

/* --------------------------------------------------------------------- HP */

export type BebanSpgSayaHp = {
  id: string;
  docNo: string;
  /** Tanggal laporan, sudah diformat untuk kedua bahasa. */
  dilaporkan: { id: string; en: string };
  jumlah: number;
  /** Diubah kantor dari angka nota (P81). */
  diubahKantor: boolean;
  alasanJumlah: string | null;
  potongan: { bulan: string; jumlah: number; dariKomisi: number; dariGaji: number; keUtang: boolean }[];
  sisa: number;
  keadaan: KeadaanBebanSpg;
  kembali: { jumlah: number; mengurangiUtang: number; dibayar: boolean; bulan: string | null } | null;
};

/**
 * "Beban saya" — beban retur pembeli SPG ini, terbaru dulu. Hanya angka
 * bebannya sendiri (seperti bagian beban barang hilangnya), tanpa harga
 * satuan apa pun.
 */
export async function bebanSpgSaya(userId: string, opsi: { batas?: number } = {}): Promise<BebanSpgSayaHp[]> {
  if (!userId) return [];
  const rows = await prisma.spgCharge.findMany({
    where: { spgUserId: userId, source: "RETUR_PEMBELI" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opsi.batas ?? 50, 1), 200),
    select: {
      id: true,
      sourceDocNo: true,
      reportedAt: true,
      status: true,
      amount: true,
      computedAmount: true,
      amountReason: true,
      settledAmount: true,
      goodsDecision: true,
      paybackAmount: true,
      paybackPaidAt: true,
      paybackPayoutMonth: true,
      deductions: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { amount: true, fromCommission: true, fromSalary: true, paidRefType: true, paidRefId: true, payoutMonth: true },
      },
    },
  });
  const diganti = await petaDiganti(prisma, rows);
  return rows.map((r) => {
    const status = bacaStatusBebanSpg(r.status) ?? "TERBUKA";
    const jumlah = angka(r.amount);
    const dipotong = angka(r.settledAmount);
    const kembali = angka(r.paybackAmount);
    return {
      id: r.id,
      docNo: r.sourceDocNo,
      dilaporkan: { id: formatDisplayDate(r.reportedAt, "id"), en: formatDisplayDate(r.reportedAt, "en") },
      jumlah,
      diubahKantor: keSen(jumlah) !== keSen(angka(r.computedAmount)),
      alasanJumlah: r.amountReason,
      potongan: r.deductions.map((d) => ({
        bulan: d.payoutMonth,
        jumlah: angka(d.amount),
        dariKomisi: angka(d.fromCommission),
        dariGaji: angka(d.fromSalary),
        keUtang: d.paidRefType === REF_BEBAN_KE_UTANG,
      })),
      sisa: status === "BATAL" ? 0 : bulat2(jumlah - dipotong),
      keadaan: keadaanBebanSpg({ status, goodsDecision: r.goodsDecision, diganti: diganti.get(r.id) ?? false }),
      kembali:
        r.goodsDecision === "KEMBALI_STOK"
          ? { jumlah: kembali, mengurangiUtang: bulat2(dipotong - kembali), dibayar: r.paybackPaidAt !== null, bulan: r.paybackPayoutMonth }
          : null,
    };
  });
}
