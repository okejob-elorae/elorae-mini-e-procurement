import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { akunPeran } from "./akun-peran";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { dppDariMemo } from "./jurnal-ppn";
import { tarifEfektif } from "./ppn";
import { bacaPengaturanPpn } from "./ppn-pengaturan";
import {
  SUMBER_BUKAN_PPN_MASA,
  geserMasaPajak,
  hitungRekapPpn,
  kompensasiBerikut,
  rentangMasa,
  type RekapPpn,
} from "./masa";

/**
 * Bacaan buku besar untuk rekap masa PPN — KHUSUS SERVER. Aturan & rumusnya
 * di `./masa.ts`. Hanya jurnal berlaku (`POSTED`); jurnal penyelesaian masa
 * sendiri tidak ikut dibaca.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const JENIS_REKAP_PPN = "PPN";
export const JENIS_REKAP_PPH_FINAL = "PPH_FINAL";

const keSen = (n: number) => Math.round(Number((n * 100).toFixed(4)));

/** Jurnal berlaku yang bukan jurnal penyelesaian masa PPN, bertanggal di [mulai, sampai). */
function saringJurnalPpn(mulai: Date | null, sampai: Date): Prisma.JournalWhereInput {
  return {
    ...SARING_JURNAL_BERLAKU,
    date: mulai ? { gte: mulai, lt: sampai } : { lt: sampai },
    // `notIn` membuang baris bersumber null (jurnal manual) — null harus diikutkan terang-terangan.
    OR: [{ sourceType: null }, { sourceType: { notIn: [...SUMBER_BUKAN_PPN_MASA] } }],
  };
}

export type AkunPpn = { keluaran: string | null; masukan: string | null; hutang: string | null; sama: boolean };

export async function akunPpn(client: Klien = prisma): Promise<AkunPpn> {
  const peta = await akunPeran(client, ["PPN_KELUARAN", "PPN_MASUKAN", "PPN_PAYABLE"]);
  const keluaran = peta.get("PPN_KELUARAN") ?? null;
  const masukan = peta.get("PPN_MASUKAN") ?? null;
  return { keluaran, masukan, hutang: peta.get("PPN_PAYABLE") ?? null, sama: keluaran != null && keluaran === masukan };
}

/** Σ PPN keluaran & masukan satu masa (agregat, tanpa DPP) — untuk daftar masa. */
export async function jumlahPpnMasa(masa: string, akun: AkunPpn, client: Klien = prisma): Promise<{ keluaran: number; masukan: number }> {
  const { mulai, sampai } = rentangMasa(masa);
  const jumlah = async (id: string | null) => {
    if (!id) return { d: 0, k: 0 };
    const a = await client.journalLine.aggregate({
      where: { chartAccountId: id, journal: saringJurnalPpn(mulai, sampai) },
      _sum: { debit: true, credit: true },
    });
    return { d: keSen(Number(a._sum.debit ?? 0)), k: keSen(Number(a._sum.credit ?? 0)) };
  };
  if (akun.sama) return { keluaran: 0, masukan: 0 };
  const [k, m] = await Promise.all([jumlah(akun.keluaran), jumlah(akun.masukan)]);
  return { keluaran: (k.k - k.d) / 100, masukan: (m.d - m.k) / 100 };
}

export type RincianSumberPpn = { sourceType: string | null; keluaran: number; masukan: number; baris: number };

export type RincianPpnMasa = {
  keluaran: number;
  keluaranDpp: number;
  masukan: number;
  masukanDpp: number;
  /**
   * Baris PPN tanpa memo DPP (jurnal manual, atau penulis yang tidak memakai
   * `memoDpp`) — DPP-nya DIPERKIRAKAN = PPN ÷ tarif efektif dan sudah ikut
   * di `keluaranDpp`/`masukanDpp`.
   */
  barisTanpaDpp: number;
  perSumber: RincianSumberPpn[];
};

/** Rincian satu masa dengan DPP (dari memo baris PPN) dan per sumber jurnal. */
export async function rincianPpnMasa(masa: string, akun: AkunPpn, client: Klien = prisma): Promise<RincianPpnMasa> {
  const kosong: RincianPpnMasa = { keluaran: 0, keluaranDpp: 0, masukan: 0, masukanDpp: 0, barisTanpaDpp: 0, perSumber: [] };
  const ids = [akun.keluaran, akun.masukan].filter((x): x is string => !!x);
  if (ids.length === 0 || akun.sama) return kosong;
  const { mulai, sampai } = rentangMasa(masa);
  const [baris, pengaturan] = await Promise.all([
    client.journalLine.findMany({
      where: { chartAccountId: { in: ids }, journal: saringJurnalPpn(mulai, sampai) },
      select: { chartAccountId: true, debit: true, credit: true, memo: true, journal: { select: { sourceType: true } } },
    }),
    bacaPengaturanPpn(client),
  ]);
  // DPP baris tanpa memo DPP: PPN ÷ tarif efektif (11% untuk 12% × 11/12).
  const efektif = tarifEfektif(pengaturan) / 100;
  const dppPerkiraanSen = (ppnSen: number) => (efektif > 0 ? Math.round(ppnSen / efektif) : 0);
  let kel = 0;
  let kelDpp = 0;
  let mas = 0;
  let masDpp = 0;
  let tanpa = 0;
  const per = new Map<string, RincianSumberPpn>();
  for (const b of baris) {
    const d = keSen(Number(b.debit));
    const k = keSen(Number(b.credit));
    const dpp = dppDariMemo(b.memo);
    const kunci = b.journal.sourceType ?? "";
    const s = per.get(kunci) ?? { sourceType: b.journal.sourceType, keluaran: 0, masukan: 0, baris: 0 };
    s.baris += 1;
    if (b.chartAccountId === akun.keluaran) {
      kel += k - d;
      s.keluaran += (k - d) / 100;
      if (dpp == null) {
        tanpa += 1;
        kelDpp += dppPerkiraanSen(k - d);
      } else kelDpp += (k > 0 ? 1 : -1) * keSen(dpp);
    } else {
      mas += d - k;
      s.masukan += (d - k) / 100;
      if (dpp == null) {
        tanpa += 1;
        masDpp += dppPerkiraanSen(d - k);
      } else masDpp += (d > 0 ? 1 : -1) * keSen(dpp);
    }
    per.set(kunci, s);
  }
  return {
    keluaran: kel / 100,
    keluaranDpp: kelDpp / 100,
    masukan: mas / 100,
    masukanDpp: masDpp / 100,
    barisTanpaDpp: tanpa,
    perSumber: [...per.values()]
      .map((s) => ({ ...s, keluaran: Math.round(s.keluaran * 100) / 100, masukan: Math.round(s.masukan * 100) / 100 }))
      .sort((a, b) => (a.sourceType ?? "").localeCompare(b.sourceType ?? "")),
  };
}

/** Ada baris PPN (bukan penyelesaian) sebelum masa ini? Dipakai penjaga urutan finalisasi. */
export async function adaPpnSebelum(masa: string, akun: AkunPpn, client: Klien = prisma): Promise<boolean> {
  const ids = [akun.keluaran, akun.masukan].filter((x): x is string => !!x);
  if (ids.length === 0) return false;
  const { mulai } = rentangMasa(masa);
  const ada = await client.journalLine.findFirst({
    where: { chartAccountId: { in: ids }, journal: saringJurnalPpn(null, mulai) },
    select: { id: true },
  });
  return ada != null;
}

export type BarisRekapTersimpan = {
  id: string;
  masa: string;
  status: "DRAFT" | "FINAL";
  keluaran: number;
  keluaranDpp: number;
  masukan: number;
  masukanDpp: number;
  kompensasi: number;
  saldo: number;
  finalizedAt: string | null;
  journalId: string | null;
  catatan: string | null;
};

type BarisTaxRecap = {
  id: string;
  period: string;
  status: string;
  outputDpp: unknown;
  outputTax: unknown;
  inputDpp: unknown;
  inputTax: unknown;
  compensation: unknown;
  balance: unknown;
  finalizedAt: Date | null;
  journalId: string | null;
  note: string | null;
};

export function keBarisRekap(r: BarisTaxRecap): BarisRekapTersimpan {
  return {
    id: r.id,
    masa: r.period,
    status: r.status === "FINAL" ? "FINAL" : "DRAFT",
    keluaran: Number(r.outputTax),
    keluaranDpp: Number(r.outputDpp),
    masukan: Number(r.inputTax),
    masukanDpp: Number(r.inputDpp),
    kompensasi: Number(r.compensation),
    saldo: Number(r.balance),
    finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
    journalId: r.journalId,
    catatan: r.note,
  };
}

/** Kompensasi lebih bayar yang dibawa ke `masa` dari rekap FINAL masa sebelumnya (0 bila tidak ada). */
export async function kompensasiMasuk(masa: string, client: Klien = prisma): Promise<number> {
  const prev = await client.taxPeriodRecap.findUnique({
    where: { type_period: { type: JENIS_REKAP_PPN, period: geserMasaPajak(masa, -1) } },
    select: { status: true, balance: true },
  });
  return prev?.status === "FINAL" ? kompensasiBerikut(Number(prev.balance)) : 0;
}

export type RekapPpnLengkap = {
  masa: string;
  akun: AkunPpn;
  /** Angka hidup dari buku besar (FINAL: angka yang dibekukan saat final). */
  rekap: RekapPpn;
  rincian: RincianPpnMasa;
  tersimpan: BarisRekapTersimpan | null;
};

/** Rekap satu masa: angka hidup dari buku besar + baris tersimpan (bila ada). */
export async function rekapPpnMasa(masa: string, client: Klien = prisma): Promise<RekapPpnLengkap> {
  const akun = await akunPpn(client);
  const [rincian, kompensasi, row] = await Promise.all([
    rincianPpnMasa(masa, akun, client),
    kompensasiMasuk(masa, client),
    client.taxPeriodRecap.findUnique({ where: { type_period: { type: JENIS_REKAP_PPN, period: masa } } }),
  ]);
  const tersimpan = row ? keBarisRekap(row) : null;
  const rekap =
    tersimpan?.status === "FINAL"
      ? hitungRekapPpn({
          keluaran: tersimpan.keluaran,
          keluaranDpp: tersimpan.keluaranDpp,
          masukan: tersimpan.masukan,
          masukanDpp: tersimpan.masukanDpp,
          kompensasi: tersimpan.kompensasi,
        })
      : hitungRekapPpn({ ...rincian, kompensasi });
  return { masa, akun, rekap, rincian, tersimpan };
}

export type RingkasMasaPpn = {
  masa: string;
  keluaran: number;
  masukan: number;
  status: "FINAL" | "DRAFT" | "BELUM";
  saldo: number | null;
  /** Σ setoran PPN tercatat untuk masa ini. */
  disetor: number;
};

/** Daftar masa satu tahun (sampai bulan berjalan) untuk halaman rekap. */
export async function daftarMasaPpn(tahun: number, masaSekarang: string, client: Klien = prisma): Promise<RingkasMasaPpn[]> {
  const akun = await akunPpn(client);
  const semua = Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= masaSekarang);
  const [rows, setoran] = await Promise.all([
    client.taxPeriodRecap.findMany({ where: { type: JENIS_REKAP_PPN, period: { in: semua } } }),
    client.taxPayment.groupBy({ by: ["period"], where: { type: "PPN", status: "POSTED", period: { in: semua } }, _sum: { amount: true } }),
  ]);
  const perMasa = new Map(rows.map((r) => [r.period, r]));
  const setor = new Map(setoran.map((s) => [s.period, Number(s._sum.amount ?? 0)]));
  const angka = await Promise.all(semua.map((m) => jumlahPpnMasa(m, akun, client)));
  return semua
    .map((m, i) => {
      const r = perMasa.get(m);
      return {
        masa: m,
        keluaran: r?.status === "FINAL" ? Number(r.outputTax) : angka[i].keluaran,
        masukan: r?.status === "FINAL" ? Number(r.inputTax) : angka[i].masukan,
        status: (r ? (r.status === "FINAL" ? "FINAL" : "DRAFT") : "BELUM") as RingkasMasaPpn["status"],
        saldo: r?.status === "FINAL" ? Number(r.balance) : null,
        disetor: setor.get(m) ?? 0,
      };
    })
    .reverse();
}
