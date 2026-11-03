import { prisma, type Prisma } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { commissionRates, lockedKonsiReports, putusReportsOf, wibMonthRange, type KonsiSalesReport } from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, konsiReportKey, payoutMonth, putusReportKey, type SpgReportCommission } from "@/lib/spg-commission/payout";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";
import { RETUR_PEMBELI_MENUNGGU } from "./retur-pembeli-berlaku";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { bacaDetailGaji, bekuDariRincian, type AlasanTahanBayar, type HasilGaji } from "./gaji-pokok";
import { kunciGaji, muatGajiPokok } from "./gaji-pokok-queries";
import { awalJendelaKoreksi, type RefBarisKomisi, type UnitKomisiSpg } from "./koreksi";

/**
 * Pemuat unit gaji & komisi SPG (satu laporan × satu SPG) dan koreksi yang sudah diterapkan — satu
 * pemuat di belakang halaman Komisi SPG, halaman siklus konsinyasi, rekap, HP SPG, dan penulis
 * pembayaran, jadi angka yang ditampilkan dan yang dibayar sama (`lib/spg/koreksi.ts`).
 *
 * Tidak ada yang ditulis di sini, dan tidak ada sapuan seluruh basis data: setiap pembaca dibatasi
 * ke SPG yang diminta (`userIds`) atau `scope`, kecuali bacaan halaman/Beranda yang memang untuk
 * semua SPG.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);
const bulanDari = (tahun: number, bulan: number) => `${tahun}-${String(bulan).padStart(2, "0")}`;
const kunciPasangan = (storeId: string, periode: string) => `${storeId}\u0000${periode}`;
const namaOrang = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

/** Filter siklus dengan bulan periode ≥ `awal` ("YYYY-MM"). */
function periodeSejak(awal: string): Prisma.ConsignmentCycleWhereInput {
  const [tahun, bulan] = awal.split("-").map(Number);
  return { OR: [{ periodYear: { gt: tahun } }, { periodYear: tahun, periodMonth: { gte: bulan } }] };
}

type Laporan = {
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  bulanJual: string;
  hitung: Map<string, SpgReportCommission>;
  laporanTertutup: boolean;
};

/** Bulan "YYYY-MM" dari `awal` sampai `akhir`, keduanya termasuk. */
function bulanAntara(awal: string, akhir: string): string[] {
  const hasil: string[] = [];
  for (let m = awal; m <= akhir; m = shiftYearMonth(m, 1)) hasil.push(m);
  return hasil;
}

/**
 * Penjual × toko × bulan penjualan sejak `awal`: SATU GROUP BY penjual × toko di basis data dengan
 * nota pertama dan terakhirnya di jendela, lalu dibentangkan per bulan WIB di antaranya. Bentangan
 * bisa memuat bulan tanpa nota di tengahnya; itu hanya membuat satu laporan ikut dimuat dan
 * dilewati, tidak pernah melewatkan laporan tempat ia menjual.
 */
async function penjualanPerBulan(
  klien: Klien,
  saring: { salesmanIds?: readonly string[]; storeIds?: readonly string[] },
  awal: string,
): Promise<{ salesmanId: string; storeId: string; bulan: string }[]> {
  if (saring.salesmanIds?.length === 0 || saring.storeIds?.length === 0) return [];
  const where: Prisma.SpgSaleWhereInput = { createdAt: { gte: wibMonthRange(awal).start } };
  if (saring.salesmanIds) where.salesmanId = { in: [...saring.salesmanIds] };
  if (saring.storeIds) where.storeId = { in: [...saring.storeIds] };
  const grup = await klien.spgSale.groupBy({ by: ["salesmanId", "storeId"], where, _min: { createdAt: true }, _max: { createdAt: true } });
  return grup.flatMap((g) => {
    const dari = g._min?.createdAt;
    const sampai = g._max?.createdAt;
    if (!dari || !sampai) return [];
    return bulanAntara(bulanWib(dari), bulanWib(sampai)).map((bulan) => ({ salesmanId: g.salesmanId, storeId: g.storeId, bulan }));
  });
}

/** Toko per bulan, dari daftar (toko, bulan). */
function tokoPerBulan(daftar: ReadonlyArray<{ storeId: string; bulan: string }>): Map<string, string[]> {
  const per = new Map<string, Set<string>>();
  for (const d of daftar) per.set(d.bulan, (per.get(d.bulan) ?? new Set<string>()).add(d.storeId));
  return new Map([...per].map(([bulan, toko]) => [bulan, [...toko]]));
}

/** Laporan TERTUTUP di jendela pada toko × bulan yang diminta: siklus terkunci, toko putus yang sudah dicek. */
async function laporanTertutupDi(
  klien: Klien,
  daftar: ReadonlyArray<{ storeId: string; bulan: string }>,
): Promise<{ siklus: { id: string; storeId: string; bulan: string }[]; putusDicek: { storeId: string; period: string; checkedAt: Date }[] }> {
  const per = tokoPerBulan(daftar);
  if (per.size === 0) return { siklus: [], putusDicek: [] };
  const [siklus, putus] = await Promise.all([
    klien.consignmentCycle.findMany({
      where: {
        lockedAt: { not: null },
        OR: [...per].map(([bulan, toko]) => ({ periodYear: Number(bulan.slice(0, 4)), periodMonth: Number(bulan.slice(5, 7)), storeId: { in: toko } })),
      },
      select: { id: true, storeId: true, periodYear: true, periodMonth: true },
    }),
    klien.spgSalesCheck.findMany({
      where: { OR: [...per].map(([bulan, toko]) => ({ period: bulan, storeId: { in: toko } })) },
      select: { storeId: true, period: true, checkedAt: true },
    }),
  ]);
  return {
    siklus: siklus.map((c) => ({ id: c.id, storeId: c.storeId, bulan: bulanDari(c.periodYear, c.periodMonth) })),
    putusDicek: putus,
  };
}

type BarisMentah = {
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  refType: RefBarisKomisi;
  refId: string;
  userId: string;
  storeId: string;
  bulanJual: string;
  komisi: number;
  potong: number | null;
  gaji: number;
  potongan: number;
  salaryDetail: unknown;
  dibayar: boolean;
  bulanBayar: string | null;
  dapatDibayar: boolean;
};

/**
 * Unit gaji & komisi setiap SPG yang diminta: setiap baris resminya (belum dibayar — berapa pun
 * umurnya — atau bulan penjualannya di jendela koreksi), ditambah setiap laporan TERTUTUP di jendela
 * tempat ia menjual tanpa punya baris, ditambah setiap laporan asal koreksinya. Komisi dihitung
 * ulang dari nota sekarang (`commissionPerSpg`); gaji pokok dari dasar hari bulan itu
 * (`muatGajiPokok`) — bulan yang sudah dibayar dengan masa dan pembagi yang dibekukan. Gaji satu SPG ×
 * satu bulan hanya dipegang SATU unit: baris yang tersimpan "dihitung di baris lain" tidak memegangnya.
 */
export async function unitKomisiSpg(klien: Klien, userIds: readonly string[], sekarang: Date = new Date()): Promise<Map<string, UnitKomisiSpg[]>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const hasil = new Map<string, UnitKomisiSpg[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return hasil;
  const bulanIni = bulanWib(sekarang);
  const awal = awalJendelaKoreksi(bulanIni);

  const [konsiRows, putusRows, koreksiRows, penjualan] = await Promise.all([
    klien.consignmentCommission.findMany({
      where: { spgUserId: { in: ids }, OR: [{ paidAt: null }, { cycle: periodeSejak(awal) }] },
      select: {
        id: true,
        cycleId: true,
        spgUserId: true,
        baseSalary: true,
        commission: true,
        deduction: true,
        salaryDetail: true,
        paidAt: true,
        cycle: { select: { storeId: true, periodYear: true, periodMonth: true, lockedAt: true } },
      },
    }),
    klien.spgCommission.findMany({
      where: { userId: { in: ids }, OR: [{ paidAt: null }, { period: { gte: awal } }] },
      select: { id: true, userId: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, baseSalary: true, salaryDetail: true, paidAt: true },
    }),
    klien.spgCommissionCorrection.findMany({
      where: { spgUserId: { in: ids } },
      select: { spgUserId: true, sourceKey: true, sourceKind: true, sourceStoreId: true, sourceSalesMonth: true, amount: true, salaryAmount: true },
    }),
    penjualanPerBulan(klien, { salesmanIds: ids }, awal),
  ]);

  const tertutup = await laporanTertutupDi(klien, penjualan);
  const idSiklus = [...new Set([...konsiRows.map((r) => r.cycleId), ...tertutup.siklus.map((c) => c.id)])];
  const pasangan = new Map<string, { storeId: string; period: string }>();
  for (const p of [...putusRows.map((r) => ({ storeId: r.storeId, period: r.period })), ...tertutup.putusDicek]) pasangan.set(kunciPasangan(p.storeId, p.period), p);
  const daftarPasangan = [...pasangan.values()];

  const [rates, konsiLaporan, cekPutus] = await Promise.all([
    commissionRates(klien),
    idSiklus.length ? lockedKonsiReports(klien, { cycleIds: idSiklus }) : Promise.resolve([] as KonsiSalesReport[]),
    daftarPasangan.length
      ? klien.spgSalesCheck.findMany({
          where: { storeId: { in: [...new Set(daftarPasangan.map((p) => p.storeId))] }, period: { in: [...new Set(daftarPasangan.map((p) => p.period))] } },
          select: { storeId: true, period: true, checkedAt: true },
        })
      : Promise.resolve([] as { storeId: string; period: string; checkedAt: Date }[]),
  ]);
  const cekPer = new Map(cekPutus.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
  const putusLaporan = await putusReportsOf(
    klien,
    daftarPasangan.map((p) => ({ storeId: p.storeId, salesMonth: p.period, checkedAt: cekPer.get(kunciPasangan(p.storeId, p.period)) ?? sekarang })),
  );

  const laporan = new Map<string, Laporan>();
  const siklusTerkunci = new Map<string, Date>();
  for (const r of konsiLaporan) {
    siklusTerkunci.set(r.cycleId, r.checkedAt);
    laporan.set(r.key, {
      kunci: r.key,
      jenis: "KONSI",
      storeId: r.storeId,
      bulanJual: r.salesMonth,
      hitung: new Map(commissionPerSpg(r, rates).map((h) => [h.salesmanId, h])),
      laporanTertutup: true,
    });
  }
  for (const r of putusLaporan) {
    laporan.set(r.key, {
      kunci: r.key,
      jenis: "PUTUS",
      storeId: r.storeId,
      bulanJual: r.salesMonth,
      hitung: new Map(commissionPerSpg(r, rates).map((h) => [h.salesmanId, h])),
      laporanTertutup: cekPer.has(kunciPasangan(r.storeId, r.salesMonth)),
    });
  }

  const mentah: BarisMentah[] = [
    ...konsiRows.map((r): BarisMentah => {
      const terkunci = siklusTerkunci.get(r.cycleId) ?? r.cycle.lockedAt;
      return {
        kunci: konsiReportKey(r.cycleId),
        jenis: "KONSI",
        refType: REF_KOMISI_KONSI,
        refId: r.id,
        userId: r.spgUserId,
        storeId: r.cycle.storeId,
        bulanJual: bulanDari(r.cycle.periodYear, r.cycle.periodMonth),
        komisi: angka(r.commission),
        potong: null,
        gaji: angka(r.baseSalary),
        potongan: angka(r.deduction),
        salaryDetail: r.salaryDetail,
        dibayar: r.paidAt !== null,
        bulanBayar: terkunci ? payoutMonth(terkunci) : null,
        dapatDibayar: r.paidAt === null && laporan.has(konsiReportKey(r.cycleId)),
      };
    }),
    ...putusRows.map((r): BarisMentah => {
      const cek = cekPer.get(kunciPasangan(r.storeId, r.period)) ?? null;
      return {
        kunci: putusReportKey(r.storeId, r.period),
        jenis: "PUTUS",
        refType: REF_KOMISI_SPG_PUTUS,
        refId: r.id,
        userId: r.userId,
        storeId: r.storeId,
        bulanJual: r.period,
        komisi: angka(r.commission),
        potong: r.unitsSold,
        gaji: angka(r.baseSalary),
        potongan: angka(r.deduction),
        salaryDetail: r.salaryDetail,
        dibayar: r.paidAt !== null,
        bulanBayar: cek ? payoutMonth(cek) : null,
        // Toko putus dibayar hanya sesudah laporannya dicek (keputusan 7) — tidak ada jalan lain.
        dapatDibayar: r.paidAt === null && cek !== null,
      };
    }),
  ];

  // Gaji pokok setiap SPG × bulan, dibekukan untuk baris yang sudah dibayar.
  const pasanganGaji = new Map<string, { userId: string; storeId: string; bulan: string; beku: ReturnType<typeof bekuDariRincian> }>();
  for (const m of mentah) {
    const d = bacaDetailGaji(m.salaryDetail);
    if (d?.jenis === "DI_BARIS_LAIN") continue;
    const k = kunciGaji(m.userId, m.bulanJual);
    const beku = m.dibayar && d?.jenis === "RINCIAN" ? bekuDariRincian(d.rincian) : null;
    if (!pasanganGaji.has(k) || beku) pasanganGaji.set(k, { userId: m.userId, storeId: m.storeId, bulan: m.bulanJual, beku });
  }
  for (const p of penjualan) {
    const k = kunciGaji(p.salesmanId, p.bulan);
    if (!pasanganGaji.has(k)) pasanganGaji.set(k, { userId: p.salesmanId, storeId: p.storeId, bulan: p.bulan, beku: null });
  }
  const gajiPer = await muatGajiPokok(klien, [...pasanganGaji.values()]);
  /** Pemegang gaji SPG × bulan: satu unit saja (yang pertama ditemui di urutan baris → laporan). */
  const pemegangGaji = new Map<string, string>();
  for (const m of mentah) {
    if (bacaDetailGaji(m.salaryDetail)?.jenis === "DI_BARIS_LAIN") continue;
    const k = kunciGaji(m.userId, m.bulanJual);
    if (!pemegangGaji.has(k)) pemegangGaji.set(k, m.kunci);
  }
  const gajiUnit = (userId: string, bulan: string, kunci: string): HasilGaji | null => {
    const k = kunciGaji(userId, bulan);
    const pemegang = pemegangGaji.get(k);
    if (pemegang && pemegang !== kunci) return null;
    if (!pemegang) pemegangGaji.set(k, kunci);
    return gajiPer.get(k) ?? null;
  };
  const tahanDari = (g: HasilGaji | null): { ditahan: AlasanTahanBayar | null; hariTahan: string[] } =>
    g && !g.ok ? { ditahan: g.alasan, hariTahan: g.hari } : { ditahan: null, hariTahan: [] };

  const tokoIds = [...new Set([...mentah.map((m) => m.storeId), ...[...laporan.values()].map((l) => l.storeId), ...koreksiRows.map((k) => k.sourceStoreId)])];
  const toko = tokoIds.length ? await klien.store.findMany({ where: { id: { in: tokoIds } }, select: { id: true, name: true } }) : [];
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  const nama = (storeId: string) => namaToko.get(storeId) ?? storeId;

  const terapan = new Map<string, { jumlah: number; gaji: number }>();
  const sumberKoreksi = new Map<string, (typeof koreksiRows)[number]>();
  for (const k of koreksiRows) {
    const kk = `${k.spgUserId}\u0000${k.sourceKey}`;
    const ada = terapan.get(kk) ?? { jumlah: 0, gaji: 0 };
    terapan.set(kk, {
      jumlah: Math.round(ada.jumlah * 100 + angka(k.amount) * 100) / 100,
      gaji: Math.round(ada.gaji * 100 + angka(k.salaryAmount) * 100) / 100,
    });
    sumberKoreksi.set(kk, k);
  }
  const koreksiTerapan = (userId: string, kunci: string) => terapan.get(`${userId}\u0000${kunci}`) ?? { jumlah: 0, gaji: 0 };
  const jualDi = new Set(penjualan.map((p) => `${p.salesmanId}\u0000${p.storeId}\u0000${p.bulan}`));

  for (const userId of ids) {
    const units = hasil.get(userId)!;
    const punyaBaris = new Set<string>();

    for (const m of mentah.filter((x) => x.userId === userId)) {
      punyaBaris.add(m.kunci);
      const lap = laporan.get(m.kunci);
      const h = lap?.hitung.get(userId);
      const g = gajiUnit(userId, m.bulanJual, m.kunci);
      const t = koreksiTerapan(userId, m.kunci);
      units.push({
        kunci: m.kunci,
        jenis: m.jenis,
        storeId: m.storeId,
        namaToko: nama(m.storeId),
        bulanJual: m.bulanJual,
        // Siklus yang kuncinya dibuka: angka tersimpannya, tanpa selisih sampai dikunci lagi.
        angka: lap ? (h?.amount ?? 0) : m.komisi,
        potong: h?.pieces ?? 0,
        potongTanpaTarif: h?.noRatePieces ?? 0,
        baris: {
          refType: m.refType,
          refId: m.refId,
          dibayar: m.dibayar,
          dapatDibayar: m.dapatDibayar,
          bulanBayar: m.bulanBayar,
          komisiTersimpan: m.komisi,
          potongTersimpan: m.potong,
          gajiPokok: m.gaji,
          potonganHilang: m.potongan,
        },
        laporanTertutup: Boolean(lap?.laporanTertutup),
        koreksiTerapan: t.jumlah,
        gajiTerapan: t.gaji,
        gaji: g,
        ...tahanDari(g),
        diLuarJendela: m.bulanJual < awal,
      });
    }

    // Laporan tertutup di jendela tempat ia menjual tanpa punya baris: dibayar lewat koreksi.
    for (const lap of laporan.values()) {
      if (punyaBaris.has(lap.kunci) || !lap.laporanTertutup || lap.bulanJual < awal) continue;
      const t = koreksiTerapan(userId, lap.kunci);
      if (!jualDi.has(`${userId}\u0000${lap.storeId}\u0000${lap.bulanJual}`) && t.jumlah === 0) continue;
      const h = lap.hitung.get(userId);
      const g = gajiUnit(userId, lap.bulanJual, lap.kunci);
      if ((h?.amount ?? 0) <= 0 && t.jumlah === 0 && !(g && g.ok && g.rincian.gajiPokok > 0)) continue;
      punyaBaris.add(lap.kunci);
      units.push({
        kunci: lap.kunci,
        jenis: lap.jenis,
        storeId: lap.storeId,
        namaToko: nama(lap.storeId),
        bulanJual: lap.bulanJual,
        angka: h?.amount ?? 0,
        potong: h?.pieces ?? 0,
        potongTanpaTarif: h?.noRatePieces ?? 0,
        baris: null,
        laporanTertutup: true,
        koreksiTerapan: t.jumlah,
        gajiTerapan: t.gaji,
        gaji: g,
        ...tahanDari(g),
      });
    }

    // Laporan asal koreksi yang tidak termuat di atas (mis. siklusnya kini dibuka lagi): tanpa selisih.
    for (const k of sumberKoreksi.values()) {
      if (k.spgUserId !== userId || punyaBaris.has(k.sourceKey) || k.sourceSalesMonth < awal) continue;
      punyaBaris.add(k.sourceKey);
      const t = koreksiTerapan(userId, k.sourceKey);
      units.push({
        kunci: k.sourceKey,
        jenis: k.sourceKind === "KONSI" ? "KONSI" : "PUTUS",
        storeId: k.sourceStoreId,
        namaToko: nama(k.sourceStoreId),
        bulanJual: k.sourceSalesMonth,
        angka: 0,
        potong: 0,
        potongTanpaTarif: 0,
        baris: null,
        laporanTertutup: false,
        koreksiTerapan: t.jumlah,
        gajiTerapan: t.gaji,
        gaji: null,
        ditahan: null,
        hariTahan: [],
      });
    }

    units.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || (a.kunci < b.kunci ? -1 : a.kunci > b.kunci ? 1 : 0));
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Koreksi yang sudah diterapkan
// ---------------------------------------------------------------------------

/** `paidRefType` koreksi yang ditutup ke utang SPG atau dibayar terpisah sesudah gaji terakhir. */
export const REF_KOREKSI_DI_LUAR_BARIS = ["SpgDebt", "SpgExtraPayout"] as const;

export type KoreksiTercatat = {
  id: string;
  spgUserId: string;
  sumber: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  bulanJual: string;
  jumlah: number;
  /** Bagian gaji pokok dari `jumlah`. */
  gaji: number;
  teks: string;
  paidRefType: string;
  paidRefId: string;
  payoutMonth: string;
  diterapkanPada: Date;
};

const pilihKoreksi = {
  id: true,
  spgUserId: true,
  sourceKey: true,
  sourceKind: true,
  sourceStoreId: true,
  sourceSalesMonth: true,
  amount: true,
  salaryAmount: true,
  note: true,
  paidRefType: true,
  paidRefId: true,
  payoutMonth: true,
  appliedAt: true,
} as const;

function keTercatat(r: {
  id: string;
  spgUserId: string;
  sourceKey: string;
  sourceKind: string;
  sourceStoreId: string;
  sourceSalesMonth: string;
  amount: unknown;
  salaryAmount: unknown;
  note: string;
  paidRefType: string;
  paidRefId: string;
  payoutMonth: string;
  appliedAt: Date;
}): KoreksiTercatat {
  return {
    id: r.id,
    spgUserId: r.spgUserId,
    sumber: r.sourceKey,
    jenis: r.sourceKind === "KONSI" ? "KONSI" : "PUTUS",
    storeId: r.sourceStoreId,
    bulanJual: r.sourceSalesMonth,
    jumlah: angka(r.amount),
    gaji: angka(r.salaryAmount),
    teks: r.note,
    paidRefType: r.paidRefType,
    paidRefId: r.paidRefId,
    payoutMonth: r.payoutMonth,
    diterapkanPada: r.appliedAt,
  };
}

/** Koreksi yang diterapkan pada setiap pembayaran yang diminta, menurut id baris yang dibayar. */
export async function koreksiPadaPembayaran(
  klien: Klien,
  refs: ReadonlyArray<{ refType: RefBarisKomisi; refId: string }>,
): Promise<Map<string, KoreksiTercatat[]>> {
  const hasil = new Map<string, KoreksiTercatat[]>();
  const ids = [...new Set(refs.map((r) => r.refId).filter(Boolean))];
  if (ids.length === 0) return hasil;
  const jenis = new Map<string, string>(refs.map((r) => [r.refId, r.refType]));
  const rows = await klien.spgCommissionCorrection.findMany({
    where: { paidRefId: { in: ids } },
    orderBy: [{ sourceSalesMonth: "asc" }, { sourceKey: "asc" }],
    select: pilihKoreksi,
  });
  for (const r of rows) {
    if (jenis.get(r.paidRefId) !== r.paidRefType) continue;
    hasil.set(r.paidRefId, [...(hasil.get(r.paidRefId) ?? []), keTercatat(r)]);
  }
  return hasil;
}

/**
 * Koreksi yang dibayar dalam satu bulan pembayaran pada baris gaji & komisi. `scope` membatasi SPG
 * atau toko asalnya. Koreksi yang ditutup ke utang SPG atau dibayar terpisah sesudah gaji terakhir
 * (`REF_KOREKSI_DI_LUAR_BARIS`) tidak termasuk — keduanya bukan pembayaran baris bulan itu.
 */
export async function koreksiBulanBayar(
  klien: Klien,
  payoutMonthKey: string,
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<KoreksiTercatat[]> {
  const rows = await klien.spgCommissionCorrection.findMany({
    where: {
      payoutMonth: payoutMonthKey,
      paidRefType: { notIn: [...REF_KOREKSI_DI_LUAR_BARIS] },
      ...(scope.userIds !== undefined ? { spgUserId: { in: scope.userIds } } : {}),
      ...(scope.storeIds !== undefined ? { sourceStoreId: { in: scope.storeIds } } : {}),
    },
    orderBy: [{ appliedAt: "asc" }, { id: "asc" }],
    select: pilihKoreksi,
  });
  return rows.map(keTercatat);
}

// ---------------------------------------------------------------------------
// Tunggakan: belum dibayar dari bulan pembayaran sebelumnya
// ---------------------------------------------------------------------------

export type TunggakanKomisi = {
  refType: RefBarisKomisi;
  refId: string;
  jenis: "KONSI" | "PUTUS";
  spgUserId: string;
  nama: string;
  storeId: string;
  namaToko: string;
  bulanJual: string;
  bulanBayar: string;
  cycleId: string | null;
  noKonsi: string | null;
  /** Seluruh pembayarannya menunggu (P60) — didaftar terpisah, tidak dihitung di Beranda tunggakan. */
  ditahan: AlasanTahanBayar | null;
  hariTahan: string[];
};

/**
 * Baris belum dibayar yang SUDAH boleh dibayar (siklus terkunci; toko putus dicek) dengan bulan
 * pembayaran sebelum bulan berjalan — SEMUANYA, tanpa batas umur (B7: gaji yang tertunggak tidak
 * pernah hilang dari antrean). Setiap baris membawa sebab tahannya (`ditahan`, dari gaji pokok bulan
 * itu): baris yang menunggu tidak dihitung di Beranda tunggakan — ia muncul di baris Beranda sebab
 * tahannya sendiri.
 */
export async function daftarTunggakanKomisi(
  klien: Klien,
  sekarang: Date = new Date(),
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<TunggakanKomisi[]> {
  const bulanIni = bulanWib(sekarang);
  const mulaiBulanIni = wibMonthRange(bulanIni).start;
  const filterUser = scope.userIds !== undefined ? { in: scope.userIds } : undefined;
  const filterToko = scope.storeIds !== undefined ? { in: scope.storeIds } : undefined;

  const [konsi, putus] = await Promise.all([
    klien.consignmentCommission.findMany({
      where: {
        paidAt: null,
        ...(filterUser ? { spgUserId: filterUser } : {}),
        cycle: { lockedAt: { lt: mulaiBulanIni }, ...(filterToko ? { storeId: filterToko } : {}) },
      },
      select: {
        id: true,
        cycleId: true,
        spgUserId: true,
        salaryDetail: true,
        spgUser: { select: { name: true, email: true } },
        cycle: { select: { storeId: true, noKonsi: true, periodYear: true, periodMonth: true, lockedAt: true, store: { select: { name: true } } } },
      },
    }),
    klien.spgCommission.findMany({
      where: { paidAt: null, ...(filterUser ? { userId: filterUser } : {}), ...(filterToko ? { storeId: filterToko } : {}) },
      select: { id: true, userId: true, storeId: true, period: true, salaryDetail: true },
    }),
  ]);

  const hasil: TunggakanKomisi[] = [];
  for (const k of konsi) {
    if (!k.cycle.lockedAt) continue;
    hasil.push({
      refType: REF_KOMISI_KONSI,
      refId: k.id,
      jenis: "KONSI",
      spgUserId: k.spgUserId,
      nama: namaOrang(k.spgUser),
      storeId: k.cycle.storeId,
      namaToko: k.cycle.store.name,
      bulanJual: bulanDari(k.cycle.periodYear, k.cycle.periodMonth),
      bulanBayar: payoutMonth(k.cycle.lockedAt),
      cycleId: k.cycleId,
      noKonsi: k.cycle.noKonsi,
      ditahan: null,
      hariTahan: [],
    });
  }
  if (putus.length > 0) {
    const toko = [...new Set(putus.map((p) => p.storeId))];
    const periode = [...new Set(putus.map((p) => p.period))];
    const [cek, orang, namaToko] = await Promise.all([
      klien.spgSalesCheck.findMany({ where: { storeId: { in: toko }, period: { in: periode } }, select: { storeId: true, period: true, checkedAt: true } }),
      klien.user.findMany({ where: { id: { in: [...new Set(putus.map((p) => p.userId))] } }, select: { id: true, name: true, email: true } }),
      klien.store.findMany({ where: { id: { in: toko } }, select: { id: true, name: true } }),
    ]);
    const cekPer = new Map(cek.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
    const namaPer = new Map(orang.map((u) => [u.id, namaOrang(u)]));
    const tokoPer = new Map(namaToko.map((t) => [t.id, t.name]));
    for (const p of putus) {
      const c = cekPer.get(kunciPasangan(p.storeId, p.period));
      if (!c || c >= mulaiBulanIni) continue;
      hasil.push({
        refType: REF_KOMISI_SPG_PUTUS,
        refId: p.id,
        jenis: "PUTUS",
        spgUserId: p.userId,
        nama: namaPer.get(p.userId) ?? p.userId,
        storeId: p.storeId,
        namaToko: tokoPer.get(p.storeId) ?? p.storeId,
        bulanJual: p.period,
        bulanBayar: payoutMonth(c),
        cycleId: null,
        noKonsi: null,
        ditahan: null,
        hariTahan: [],
      });
    }
  }

  // Sebab tahan dihitung SEKARANG (bukan dari potret tersimpan): catatan check-in yang masuk sesudah
  // dikunci membuka baris itu tanpa menunggu dikunci ulang.
  const detail = new Map<string, unknown>([...konsi.map((k) => [k.id, k.salaryDetail] as const), ...putus.map((p) => [p.id, p.salaryDetail] as const)]);
  const pasangan = hasil
    .filter((t) => bacaDetailGaji(detail.get(t.refId))?.jenis !== "DI_BARIS_LAIN")
    .map((t) => ({ userId: t.spgUserId, storeId: t.storeId, bulan: t.bulanJual }));
  const gaji = await muatGajiPokok(klien, pasangan);
  for (const t of hasil) {
    if (bacaDetailGaji(detail.get(t.refId))?.jenis === "DI_BARIS_LAIN") continue;
    const g = gaji.get(kunciGaji(t.spgUserId, t.bulanJual));
    if (g && !g.ok) {
      t.ditahan = g.alasan;
      t.hariTahan = g.hari;
    }
  }

  return hasil.sort(
    (a, b) =>
      a.bulanBayar.localeCompare(b.bulanBayar) ||
      a.bulanJual.localeCompare(b.bulanJual) ||
      a.namaToko.localeCompare(b.namaToko) ||
      a.nama.localeCompare(b.nama) ||
      (a.refId < b.refId ? -1 : 1),
  );
}

/** Angka baris Beranda `spgCommissionsUnpaidPast`: setiap tunggakan yang BISA dibayar (tanpa yang ditahan). */
export async function jumlahKomisiSpgTertunggak(sekarang: Date = new Date(), scope: { userIds?: string[] } = {}): Promise<number> {
  return (await daftarTunggakanKomisi(prisma, sekarang, scope)).filter((t) => t.ditahan === null).length;
}

/**
 * SPG yang unitnya diperiksa halaman Komisi SPG untuk koreksi yang menunggu: pemegang baris resmi
 * (belum dibayar, atau bulan penjualannya di jendela), penerima koreksi di jendela, dan penjual TANPA
 * baris yang menjual di laporan yang sudah tertutup (notanya masuk sesudah dikunci/dicek).
 */
export async function pemegangKomisiSpg(
  klien: Klien,
  sekarang: Date = new Date(),
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<string[]> {
  const awal = awalJendelaKoreksi(bulanWib(sekarang));
  const filterUser = scope.userIds !== undefined ? { in: scope.userIds } : undefined;
  const filterToko = scope.storeIds !== undefined ? { in: scope.storeIds } : undefined;
  const [konsi, putus, koreksi, penjualan] = await Promise.all([
    klien.consignmentCommission.groupBy({
      by: ["spgUserId"],
      where: {
        ...(filterUser ? { spgUserId: filterUser } : {}),
        OR: [{ paidAt: null }, { cycle: periodeSejak(awal) }],
        ...(filterToko ? { cycle: { storeId: filterToko } } : {}),
      },
    }),
    klien.spgCommission.groupBy({
      by: ["userId"],
      where: { ...(filterUser ? { userId: filterUser } : {}), ...(filterToko ? { storeId: filterToko } : {}), OR: [{ paidAt: null }, { period: { gte: awal } }] },
    }),
    klien.spgCommissionCorrection.groupBy({
      by: ["spgUserId"],
      where: { ...(filterUser ? { spgUserId: filterUser } : {}), ...(filterToko ? { sourceStoreId: filterToko } : {}), sourceSalesMonth: { gte: awal } },
    }),
    penjualanPerBulan(klien, { salesmanIds: scope.userIds, storeIds: scope.storeIds }, awal),
  ]);
  const pemegang = new Set([...konsi.map((k) => k.spgUserId), ...putus.map((p) => p.userId), ...koreksi.map((k) => k.spgUserId)]);
  const tanpaBaris = penjualan.filter((p) => !pemegang.has(p.salesmanId));
  if (tanpaBaris.length > 0) {
    const tertutup = await laporanTertutupDi(klien, tanpaBaris);
    const kunciTertutup = new Set([
      ...tertutup.siklus.map((c) => kunciPasangan(c.storeId, c.bulan)),
      ...tertutup.putusDicek.map((p) => kunciPasangan(p.storeId, p.period)),
    ]);
    for (const p of tanpaBaris) if (kunciTertutup.has(kunciPasangan(p.storeId, p.bulan))) pemegang.add(p.salesmanId);
  }
  return [...pemegang];
}

/**
 * Retur pembeli yang masih MENUNGGU persetujuan per toko × bulan penjualan NOTA ASLINYA (P9: retur
 * mengurangi komisi bulan nota aslinya). Diperlihatkan saat mencek, mengunci, dan membayar: kalau
 * disetujui sesudah komisinya dibayar, selisihnya jadi koreksi minus di pembayaran berikutnya.
 */
export async function returMenungguPerLaporan(
  klien: Klien,
  laporan: ReadonlyArray<{ storeId: string; bulanJual: string }>,
): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  const perBulan = new Map<string, Set<string>>();
  for (const l of laporan) perBulan.set(l.bulanJual, (perBulan.get(l.bulanJual) ?? new Set()).add(l.storeId));
  await Promise.all(
    [...perBulan].map(async ([bulanJual, toko]) => {
      const { start, end } = wibMonthRange(bulanJual);
      const grup = await klien.spgSaleReturn.groupBy({
        by: ["storeId"],
        where: { ...RETUR_PEMBELI_MENUNGGU, storeId: { in: [...toko] }, spgSale: { createdAt: { gte: start, lt: end } } },
        _count: { _all: true },
      });
      for (const g of grup) hasil.set(kunciPasangan(g.storeId, bulanJual), g._count._all);
    }),
  );
  return hasil;
}

/** Kunci peta `returMenungguPerLaporan`. */
export const kunciReturMenunggu = (storeId: string, bulanJual: string) => kunciPasangan(storeId, bulanJual);
