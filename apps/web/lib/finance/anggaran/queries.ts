import { prisma, type Prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { signedDelta } from "@/lib/finance/journals/normal-side";
import { saringJurnalLaporan, type BalanceRow } from "@/lib/finance/reports/balances";
import { rollupBanyak, totalAkar, type SimpulNilai } from "@/lib/finance/reports/tampil-pohon";
import { BULAN, JENIS_AKUN_ANGGARAN, rentangBulan } from "./aturan";

type Klien = Prisma.TransactionClient | typeof prisma;

export type AkunAnggaran = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  depth: number;
  isActive: boolean;
  /** Akun induk — tidak bisa dianggarkan (sama dengan tidak bisa diposting). */
  adaAnak: boolean;
};

/**
 * Akun laba rugi: semua aktif (dan induknya), plus yang nonaktif bila sudah
 * punya anggaran tahun itu. `semua` = termasuk seluruh akun nonaktif (laporan:
 * akun nonaktif yang masih bermutasi harus ikut supaya totalnya sama dengan
 * Laba Rugi; yang nol disembunyikan tampilan).
 */
export async function daftarAkunAnggaran(tahun?: number, klien: Klien = prisma, opsi: { semua?: boolean } = {}): Promise<AkunAnggaran[]> {
  const [akun, beranggaran] = await Promise.all([
    klien.chartAccount.findMany({
      where: { type: { in: [...JENIS_AKUN_ANGGARAN] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true, parentId: true, depth: true, isActive: true },
    }),
    tahun ? klien.budget.findMany({ where: { year: tahun }, select: { chartAccountId: true }, distinct: ["chartAccountId"] }) : Promise.resolve([]),
  ]);
  const punyaAnggaran = new Set(beranggaran.map((b) => b.chartAccountId));
  const induk = new Set(akun.map((a) => a.parentId).filter((x): x is string => x !== null));
  return akun
    .filter((a) => opsi.semua || a.isActive || punyaAnggaran.has(a.id) || induk.has(a.id))
    .map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type as AccountType,
      parentId: a.parentId,
      depth: a.depth,
      isActive: a.isActive,
      adaAnak: induk.has(a.id),
    }));
}

/** Anggaran satu tahun: akun → 12 sel (null = belum dianggarkan). */
export async function bacaAnggaranTahun(tahun: number, klien: Klien = prisma): Promise<Map<string, (number | null)[]>> {
  const rows = await klien.budget.findMany({ where: { year: tahun }, select: { chartAccountId: true, month: true, amount: true } });
  const peta = new Map<string, (number | null)[]>();
  for (const r of rows) {
    if (r.month < 1 || r.month > 12) continue;
    const sel = peta.get(r.chartAccountId) ?? new Array<number | null>(12).fill(null);
    sel[r.month - 1] = Number(r.amount);
    peta.set(r.chartAccountId, sel);
  }
  return peta;
}

const dua = (n: number) => String(n).padStart(2, "0");

/** Awal dan akhir bulan WIB sebagai instan. */
export function batasBulan(tahun: number, bulan: number): { from: Date; to: Date } {
  const akhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  return {
    from: parseDateOnly(`${tahun}-${dua(bulan)}-01`)!,
    to: parseDateOnlyEnd(`${tahun}-${dua(bulan)}-${dua(akhir)}`)!,
  };
}

/**
 * Realisasi per akun laba rugi per bulan satu tahun (per sisi normal akun),
 * tanpa jurnal penutup tahun — sama dengan Laba Rugi bulan itu.
 */
export async function bacaRealisasiBulanan(tahun: number): Promise<Map<string, number[]>> {
  const akun = await prisma.chartAccount.findMany({
    where: { type: { in: [...JENIS_AKUN_ANGGARAN] } },
    select: { id: true, type: true },
  });
  const jenis = new Map(akun.map((a) => [a.id, a.type as AccountType]));
  const perBulan = await Promise.all(
    BULAN.map((b) =>
      prisma.journalLine.groupBy({
        by: ["chartAccountId"],
        _sum: { debit: true, credit: true },
        where: { account: { type: { in: [...JENIS_AKUN_ANGGARAN] } }, journal: saringJurnalLaporan(batasBulan(tahun, b)) },
      }),
    ),
  );
  const peta = new Map<string, number[]>();
  perBulan.forEach((grup, i) => {
    for (const g of grup) {
      const t = jenis.get(g.chartAccountId);
      if (!t) continue;
      const sel = peta.get(g.chartAccountId) ?? new Array<number>(12).fill(0);
      sel[i] = signedDelta(t, Number(g._sum.debit ?? 0), Number(g._sum.credit ?? 0));
      peta.set(g.chartAccountId, sel);
    }
  });
  return peta;
}

export type LaporanAnggaran = {
  tahun: number;
  bulan: number[];
  /** Kolom 0 = anggaran, kolom 1 = realisasi. */
  pendapatan: SimpulNilai[];
  hpp: SimpulNilai[];
  beban: SimpulNilai[];
  total: {
    pendapatan: [number, number];
    hpp: [number, number];
    beban: [number, number];
    labaKotor: [number, number];
    labaBersih: [number, number];
  };
  /** Akun (dan induknya) yang punya sedikitnya satu sel anggaran di bulan-bulan ini. */
  akunBeranggaran: string[];
  adaAnggaran: boolean;
  adaRealisasi: boolean;
};

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));
const kurang = (a: number, b: number) => (keSen(a) - keSen(b)) / 100 + 0;

/** Realisasi vs anggaran untuk satu bulan, atau sejak Januari sampai bulan itu. */
export async function muatRealisasiVsAnggaran(input: { tahun: number; bulan: number; cakupan: "bulan" | "ytd" }): Promise<LaporanAnggaran> {
  const bulan = rentangBulan(input.bulan, input.cakupan);
  const from = batasBulan(input.tahun, bulan[0]).from;
  const to = batasBulan(input.tahun, bulan[bulan.length - 1]).to;

  const [akun, anggaran, realisasiGrup] = await Promise.all([
    daftarAkunAnggaran(input.tahun, prisma, { semua: true }),
    bacaAnggaranTahun(input.tahun),
    prisma.journalLine.groupBy({
      by: ["chartAccountId"],
      _sum: { debit: true, credit: true },
      where: { account: { type: { in: [...JENIS_AKUN_ANGGARAN] } }, journal: saringJurnalLaporan({ from, to }) },
    }),
  ]);

  const anak = new Set(akun.map((a) => a.parentId).filter((x): x is string => x !== null));
  const dasar = (a: AkunAnggaran): Omit<BalanceRow, "debit" | "credit" | "signed"> => ({
    accountId: a.accountId,
    code: a.code,
    name: a.name,
    type: a.type,
    parentId: a.parentId,
    depth: a.depth,
    isActive: a.isActive,
    hasChildren: anak.has(a.accountId),
  });
  const realisasi = new Map(realisasiGrup.map((g) => [g.chartAccountId, g]));
  const induk = new Map(akun.map((a) => [a.accountId, a.parentId]));

  const beranggaran = new Set<string>();
  const kolomAnggaran: BalanceRow[] = [];
  const kolomRealisasi: BalanceRow[] = [];
  for (const a of akun) {
    const sel = anggaran.get(a.accountId);
    const isi = sel ? bulan.map((b) => sel[b - 1]).filter((v): v is number => v !== null) : [];
    if (isi.length > 0) {
      for (let id: string | null = a.accountId; id; id = induk.get(id) ?? null) beranggaran.add(id);
    }
    kolomAnggaran.push({ ...dasar(a), debit: 0, credit: 0, signed: isi.reduce((s, v) => s + keSen(v), 0) / 100 + 0 });
    const r = realisasi.get(a.accountId);
    const debit = Number(r?._sum.debit ?? 0);
    const credit = Number(r?._sum.credit ?? 0);
    kolomRealisasi.push({ ...dasar(a), debit, credit, signed: signedDelta(a.type, debit, credit) });
  }

  const pendapatan = rollupBanyak([kolomAnggaran, kolomRealisasi], ["PENDAPATAN"]);
  const hpp = rollupBanyak([kolomAnggaran, kolomRealisasi], ["HPP"]);
  const beban = rollupBanyak([kolomAnggaran, kolomRealisasi], ["BEBAN"]);
  const tp = totalAkar(pendapatan, 2) as [number, number];
  const th = totalAkar(hpp, 2) as [number, number];
  const tb = totalAkar(beban, 2) as [number, number];
  const labaKotor: [number, number] = [kurang(tp[0], th[0]), kurang(tp[1], th[1])];

  return {
    tahun: input.tahun,
    bulan,
    pendapatan,
    hpp,
    beban,
    total: {
      pendapatan: tp,
      hpp: th,
      beban: tb,
      labaKotor,
      labaBersih: [kurang(labaKotor[0], tb[0]), kurang(labaKotor[1], tb[1])],
    },
    akunBeranggaran: [...beranggaran],
    adaAnggaran: beranggaran.size > 0,
    adaRealisasi: kolomRealisasi.some((r) => r.debit !== 0 || r.credit !== 0),
  };
}
