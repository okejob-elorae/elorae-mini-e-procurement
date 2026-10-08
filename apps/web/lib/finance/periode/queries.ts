import { prisma } from "@elorae/db";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { daftarJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { ppnBerlaku } from "@/lib/finance/pajak/ppn";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { cariSemuaTanpaJurnal, rentangSapuan } from "@/lib/finance/sapuan/runner";
import { sumberSapuanTerdaftar } from "@/lib/finance/sapuan/semua";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import {
  STATUS_PERIODE,
  bandingBulan,
  bulanPertamaBuku,
  bulanSudahBerakhir,
  bulanWib,
  deretBulan,
  kunciBulan,
  nilaiDaftarPeriksa,
  rentangBulan,
  type DaftarPeriksa,
  type DataPeriksa,
  type StatusPeriode,
  type TahunBulan,
} from "./periode";

/*
 * Bacaan halaman Tutup buku. Hanya di server.
 */

/** Bulan pertama buku: bulan tanggal mulai buku besar; tanpa itu, bulan jurnal berlaku paling awal (`bulanPertamaBuku`). */
export async function bacaBulanPertamaBuku(): Promise<{
  pertama: TahunBulan | null;
  tanggalMulai: Date | null;
  jurnalAwal: TahunBulan | null;
}> {
  const [tanggalMulai, awal] = await Promise.all([
    readGlCutover(),
    prisma.journal.findFirst({ where: SARING_JURNAL_BERLAKU, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const jurnalAwal = awal ? bulanWib(awal.date) : null;
  return {
    pertama: bulanPertamaBuku(tanggalMulai ? bulanWib(tanggalMulai) : null, jurnalAwal),
    tanggalMulai,
    jurnalAwal,
  };
}

/** Paling jauh sekian bulan ke belakang yang didaftar (jurnal salah tanggal tidak membuat daftar ratusan baris). */
const MAKS_BULAN_TAMPIL = 36;

export type BarisBulan = {
  kunci: string;
  tahun: number;
  bulan: number;
  status: StatusPeriode;
  sudahBerakhir: boolean;
  jumlahJurnal: number;
  closedAt: string | null;
  closedByName: string | null;
  closeNote: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
  reopenReason: string | null;
};

export type BarisTahun = {
  tahun: number;
  status: StatusPeriode;
  bulanTertutup: number;
  sudahBerakhir: boolean;
  closedAt: string | null;
  closedByName: string | null;
  closingJournalId: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};

export type DaftarPeriode = {
  bulan: BarisBulan[];
  tahun: BarisTahun[];
  bulanPertama: TahunBulan | null;
  tanggalMulai: string | null;
};

/**
 * Bulan dari bulan pertama buku (atau bulan jurnal paling awal bila lebih
 * dulu — mis. bulan jurnal saldo awal) sampai bulan berjalan, terbaru dulu,
 * paling banyak `MAKS_BULAN_TAMPIL` bulan, ditambah bulan lain yang sudah
 * punya baris periode tertutup. Tanpa keduanya daftarnya hanya bulan berjalan.
 */
export async function daftarPeriode(sekarang: Date = new Date()): Promise<DaftarPeriode> {
  const { pertama, tanggalMulai, jurnalAwal } = await bacaBulanPertamaBuku();
  const kini = bulanWib(sekarang);
  const [periode, tahunRows] = await Promise.all([
    prisma.accountingPeriod.findMany({ orderBy: [{ year: "asc" }, { month: "asc" }] }),
    prisma.accountingYear.findMany({ orderBy: { year: "asc" } }),
  ]);

  const kunciSet = new Map<string, TahunBulan>();
  const kandidat = [pertama, jurnalAwal].filter((b): b is TahunBulan => b != null && bandingBulan(b, kini) <= 0);
  let mulai = kandidat.length ? kandidat.reduce((a, b) => (bandingBulan(a, b) <= 0 ? a : b)) : kini;
  const terjauh = deretBulan({ tahun: kini.tahun - 3, bulan: kini.bulan }, kini).at(-MAKS_BULAN_TAMPIL) ?? kini;
  if (bandingBulan(mulai, terjauh) < 0) mulai = terjauh;
  for (const b of deretBulan(mulai, kini)) kunciSet.set(kunciBulan(b), b);
  for (const p of periode) {
    if (p.status === STATUS_PERIODE.TERTUTUP) kunciSet.set(kunciBulan({ tahun: p.year, bulan: p.month }), { tahun: p.year, bulan: p.month });
  }
  const daftarBulan = [...kunciSet.values()].sort((a, b) => bandingBulan(b, a));

  const perKunci = new Map(periode.map((p) => [kunciBulan({ tahun: p.year, bulan: p.month }), p]));
  const penggunaIds = [
    ...new Set(
      [...periode.flatMap((p) => [p.closedById, p.reopenedById]), ...tahunRows.map((t) => t.closedById)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  const [pengguna, jumlah] = await Promise.all([
    penggunaIds.length
      ? prisma.user.findMany({ where: { id: { in: penggunaIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    Promise.all(
      daftarBulan.map((b) => {
        const r = rentangBulan(b);
        return prisma.journal.count({ where: { ...SARING_JURNAL_BERLAKU, date: { gte: r.awal, lte: r.akhir } } });
      }),
    ),
  ]);
  const nama = new Map(pengguna.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const bulan: BarisBulan[] = daftarBulan.map((b, i) => {
    const p = perKunci.get(kunciBulan(b));
    return {
      kunci: kunciBulan(b),
      tahun: b.tahun,
      bulan: b.bulan,
      status: p?.status === STATUS_PERIODE.TERTUTUP ? STATUS_PERIODE.TERTUTUP : STATUS_PERIODE.TERBUKA,
      sudahBerakhir: bulanSudahBerakhir(b, sekarang),
      jumlahJurnal: jumlah[i],
      closedAt: p?.closedAt?.toISOString() ?? null,
      closedByName: p?.closedById ? (nama.get(p.closedById) ?? null) : null,
      closeNote: p?.closeNote ?? null,
      reopenedAt: p?.reopenedAt?.toISOString() ?? null,
      reopenedByName: p?.reopenedById ? (nama.get(p.reopenedById) ?? null) : null,
      reopenReason: p?.reopenReason ?? null,
    };
  });

  const tahunSet = new Set<number>([...bulan.map((b) => b.tahun), ...tahunRows.map((t) => t.year)]);
  const perTahun = new Map(tahunRows.map((t) => [t.year, t]));
  const tahun: BarisTahun[] = [...tahunSet]
    .sort((a, b) => b - a)
    .map((y) => {
      const t = perTahun.get(y);
      return {
        tahun: y,
        status: t?.status === STATUS_PERIODE.TERTUTUP ? STATUS_PERIODE.TERTUTUP : STATUS_PERIODE.TERBUKA,
        bulanTertutup: periode.filter((p) => p.year === y && p.status === STATUS_PERIODE.TERTUTUP).length,
        sudahBerakhir: bulanSudahBerakhir({ tahun: y, bulan: 12 }, sekarang),
        closedAt: t?.closedAt?.toISOString() ?? null,
        closedByName: t?.closedById ? (nama.get(t.closedById) ?? null) : null,
        closingJournalId: t?.closingJournalId ?? null,
        reopenedAt: t?.reopenedAt?.toISOString() ?? null,
        reopenReason: t?.reopenReason ?? null,
      };
    });

  return {
    bulan,
    tahun,
    bulanPertama: pertama,
    tanggalMulai: tanggalMulai ? formatDateOnlyJakarta(tanggalMulai) : null,
  };
}

const NAMA_MARKETPLACE: Record<string, string> = { SHOPEE: "Shopee", TIKTOK: "TikTok", TOKOPEDIA: "Tokopedia" };

/** Batas dokumen per sumber yang dihitung daftar periksa; lebih dari ini ditulis "N+". */
export const BATAS_PERIKSA_PER_SUMBER = 50;

/**
 * Data daftar periksa sebelum menutup bulan. Setiap butir dibaca terpisah dan
 * kegagalannya tidak menjatuhkan butir lain: butir yang gagal dibaca dianggap
 * GAGAL (tidak bisa dipastikan lulus), bukan lulus.
 */
export async function bacaDataPeriksa(tb: TahunBulan): Promise<DataPeriksa> {
  const { awal, akhir } = rentangBulan(tb);
  const kunci = kunciBulan(tb);

  const jurnalDraf = prisma.journal.count({ where: { status: "DRAFT", date: { gte: awal, lte: akhir } } });

  const dokumen = (async (): Promise<DataPeriksa["dokumenTanpaJurnal"]> => {
    const tanggalMulai = await readGlCutover();
    if (!tanggalMulai) return { belum: "TANPA_TANGGAL_MULAI" };
    const rentang = await rentangSapuan({ sejak: awal, sampai: akhir, tanggalMulai });
    if (!rentang) return { belum: "SEBELUM_TANGGAL_MULAI" };
    const hasil = await cariSemuaTanpaJurnal({ ...rentang, batasPerSumber: BATAS_PERIKSA_PER_SUMBER });
    const rincian = hasil
      .filter((h) => h.dokumen.length > 0 || h.galat)
      .map((h) => ({
        label: h.galat ? `${h.label} (tidak bisa diperiksa)` : h.terpotong ? `${h.label} (${h.dokumen.length}+)` : h.label,
        jumlah: h.galat ? 1 : h.dokumen.length,
      }));
    return { jumlah: rincian.reduce((s, r) => s + r.jumlah, 0), rincian };
  })();

  const gagalTanpaTanggal = (async () => {
    const terdaftar = new Set(sumberSapuanTerdaftar().map((s) => s.sourceType));
    const tertunda = await daftarJurnalTertunda();
    return tertunda.filter((t) => !(t.sumber?.tipe === "dokumen" && terdaftar.has(t.sumber.sourceType))).length;
  })();

  const bank = (async (): Promise<DataPeriksa["rekonsiliasiBank"]> => {
    if ((await prisma.bankStatementImport.count()) === 0) return { belum: "BANK_BELUM_DIIMPOR" };
    const grup = await prisma.bankStatementLine.groupBy({
      by: ["chartAccountId"],
      where: { status: "UNMATCHED", date: { gte: awal, lte: akhir } },
      _count: { _all: true },
    });
    if (grup.length === 0) return { jumlah: 0, rincian: [] };
    const akun = await prisma.chartAccount.findMany({
      where: { id: { in: grup.map((g) => g.chartAccountId) } },
      select: { id: true, code: true, name: true },
    });
    const namaAkun = new Map(akun.map((a) => [a.id, `${a.code} ${a.name}`]));
    const rincian = grup.map((g) => ({ label: namaAkun.get(g.chartAccountId) ?? g.chartAccountId, jumlah: g._count._all }));
    return { jumlah: rincian.reduce((s, r) => s + r.jumlah, 0), rincian };
  })();

  const penyusutan = (async (): Promise<DataPeriksa["penyusutan"]> => {
    if ((await prisma.fixedAsset.count()) === 0) return { belum: "TANPA_ASET_TETAP" };
    const aset = await prisma.fixedAsset.findMany({
      where: {
        depreciationStartDate: { lte: akhir },
        OR: [{ status: "ACTIVE" }, { disposedAt: { gt: akhir } }],
      },
      select: { id: true, depreciationStartDate: true, usefulLifeMonths: true },
    });
    // Aset yang masa manfaatnya sudah habis sebelum bulan ini tidak disusutkan lagi.
    const masihDisusutkan = aset.filter((a) => {
      const mulai = bulanWib(a.depreciationStartDate);
      const ke = (tb.tahun - mulai.tahun) * 12 + (tb.bulan - mulai.bulan);
      return ke >= 0 && ke < a.usefulLifeMonths;
    });
    if (masihDisusutkan.length === 0) return { jumlah: 0 };
    const sudah = await prisma.fixedAssetDepreciation.findMany({
      where: { period: kunci, assetId: { in: masihDisusutkan.map((a) => a.id) } },
      select: { assetId: true },
    });
    const sudahSet = new Set(sudah.map((s) => s.assetId));
    return { jumlah: masihDisusutkan.filter((a) => !sudahSet.has(a.id)).length };
  })();

  const ppn = (async (): Promise<DataPeriksa["rekapPpn"]> => {
    const pengaturan = await bacaPengaturanPpn();
    if (!ppnBerlaku(pengaturan, akhir)) return { belum: "BUKAN_PKP" };
    const rekap = await prisma.taxPeriodRecap.findUnique({ where: { type_period: { type: "PPN", period: kunci } }, select: { status: true } });
    return { selesai: rekap?.status === "FINAL" };
  })();

  const settlement = (async (): Promise<DataPeriksa["settlement"]> => {
    const terjual = await prisma.salesOrder.groupBy({
      by: ["channel"],
      where: {
        channel: { in: ["SHOPEE", "TIKTOK", "TOKOPEDIA"] },
        shippedAt: { gte: awal, lte: akhir },
      },
      _count: { _all: true },
    });
    if (terjual.length === 0) return { belum: "TANPA_PENJUALAN_MARKETPLACE" };
    const unggahan = await prisma.settlement.findMany({
      where: { periodFrom: { lte: akhir }, periodTo: { gte: awal } },
      select: { marketplace: true },
    });
    const ada = new Set(unggahan.map((u) => u.marketplace));
    // Tokopedia dicairkan lewat TikTok Shop: unggahan TikTok ikut menutupnya.
    const tanpa = terjual
      .map((t) => t.channel as string)
      .filter((c) => !(ada.has(c) || (c === "TOKOPEDIA" && ada.has("TIKTOK"))))
      .map((c) => NAMA_MARKETPLACE[c] ?? c);
    return { tanpaUnggahan: tanpa };
  })();

  const aman = async <T>(nama: string, p: Promise<T>, gagal: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      console.error(`[tutup-buku] butir ${nama} gagal dibaca`, e);
      return gagal;
    }
  };

  const [draf, dok, gagal, b, s, p, st] = await Promise.all([
    aman("jurnalDraf", jurnalDraf, 1),
    aman("dokumenTanpaJurnal", dokumen, { jumlah: 1, rincian: [{ label: "Tidak bisa diperiksa", jumlah: 1 }] }),
    aman("jurnalGagal", gagalTanpaTanggal, 1),
    aman("bank", bank, { jumlah: 1, rincian: [{ label: "Tidak bisa diperiksa", jumlah: 1 }] }),
    aman("penyusutan", penyusutan, { jumlah: 1 }),
    aman("ppn", ppn, { selesai: false }),
    aman("settlement", settlement, { tanpaUnggahan: ["Tidak bisa diperiksa"] }),
  ]);
  return {
    jurnalDraf: draf,
    dokumenTanpaJurnal: dok,
    jurnalGagalTanpaTanggal: gagal,
    rekonsiliasiBank: b,
    penyusutan: s,
    rekapPpn: p,
    settlement: st,
  };
}

export async function bacaDaftarPeriksa(tb: TahunBulan): Promise<DaftarPeriksa> {
  return nilaiDaftarPeriksa(await bacaDataPeriksa(tb));
}
