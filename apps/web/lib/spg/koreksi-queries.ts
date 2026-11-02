import { prisma, type Prisma } from "@elorae/db";
import { JEJAK } from "@/lib/receivables/jejak";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { commissionRates, lockedKonsiReports, putusReportsOf, wibMonthRange, type KonsiSalesReport } from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, konsiReportKey, payoutMonth, putusReportKey, type SpgReportCommission } from "@/lib/spg-commission/payout";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";
import { RETUR_PEMBELI_MENUNGGU } from "./retur-pembeli-berlaku";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { aturanLama, DASAR_TARIF_KATEGORI } from "./komisi";
import {
  alasanTahan,
  alasanTahanBayar,
  awalJendelaKoreksi,
  dalamJendelaKoreksi,
  type AlasanTahanKoreksi,
  type RefBarisKomisi,
  type UnitKomisiSpg,
} from "./koreksi";

/**
 * Pemuat unit komisi SPG (satu laporan × satu SPG) dan koreksi yang sudah diterapkan — satu pemuat
 * di belakang halaman Komisi SPG, halaman siklus konsinyasi, rekap, HP SPG, dan penulis
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

/**
 * Siklus yang angkanya terakhir dikunci dengan ATURAN LAMA (tarif barang, dibagi rata): jejak
 * `KONSI_DIKUNCI` terakhirnya tidak membawa `aturanKomisi = TARIF_KATEGORI` (penulis kunci sekarang
 * selalu menulisnya). Dicocokkan di JS — penyaringan jalur JSON tidak andal di semua adaptor.
 */
export async function siklusAturanLama(klien: Klien, cycleIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(cycleIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const jejak = await klien.auditLog.findMany({
    where: { entityType: "ConsignmentCycle", action: JEJAK.KONSI_DIKUNCI, entityId: { in: ids } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, metadata: true },
  });
  const terakhir = new Map<string, unknown>();
  for (const j of jejak) if (!terakhir.has(j.entityId)) terakhir.set(j.entityId, j.metadata);
  return new Set(ids.filter((id) => (terakhir.get(id) as { aturanKomisi?: unknown } | null | undefined)?.aturanKomisi !== DASAR_TARIF_KATEGORI));
}

/**
 * Angka resmi siklus tidak seluruhnya bisa dibagikan ke SPG: ada baris tanpa barang, atau potong
 * yang tercatat di HP (dibatasi angka resmi) kurang dari angka resminya. Komisi dari potong HP saja
 * adalah aturan hari ini (Q7, belum dijawab pemilik): baris yang belum dibayar dibayar dengannya,
 * gaji pokoknya ikut. Untuk siklus aturan lama ini hanya menahan unit yang barisnya SUDAH dibayar
 * lebih dari angka sekarangnya (`LAPORAN_TIDAK_LENGKAP`, `alasanTahan`): uang yang dulu dibayar dari
 * angka resmi tidak ditarik kembali karenanya.
 */
export function laporanKonsiTidakLengkap(r: KonsiSalesReport, hitung: readonly SpgReportCommission[]): boolean {
  if (r.officialItemlessQty > 0) return true;
  const resmi = (r.official ?? []).reduce((n, o) => n + (Number.isFinite(o.qty) && o.qty > 0 ? o.qty : 0), 0);
  const terkonfirmasi = hitung.reduce((n, h) => n + h.pieces, 0);
  return terkonfirmasi < resmi;
}

type Laporan = {
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  bulanJual: string;
  /** Null untuk siklus yang kuncinya dibuka: belum ada angka yang dibandingkan. */
  hitung: Map<string, SpgReportCommission> | null;
  laporanTertutup: boolean;
  /** Dikunci/ditetapkan dengan aturan lama (tarif barang, dibagi rata). */
  aturanLama: boolean;
  /** Konsinyasi: angka resminya tidak seluruhnya tercatat di HP (`laporanKonsiTidakLengkap`). */
  tidakLengkap: boolean;
};

/** Bulan "YYYY-MM" dari `awal` sampai `akhir`, keduanya termasuk. */
function bulanAntara(awal: string, akhir: string): string[] {
  const hasil: string[] = [];
  for (let m = awal; m <= akhir; m = shiftYearMonth(m, 1)) hasil.push(m);
  return hasil;
}

/**
 * Penjual × toko × bulan penjualan sejak `awal`: SATU GROUP BY penjual × toko di basis data dengan
 * nota pertama dan terakhirnya di jendela, lalu dibentangkan per bulan WIB di antaranya — tidak ada
 * nota yang dibaca baris per baris. Bentangannya bisa memuat bulan tanpa nota di tengahnya; itu
 * hanya membuat satu laporan ikut dimuat dan dilewati (tanpa angka, tanpa koreksi), tidak pernah
 * melewatkan laporan tempat ia menjual.
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

/**
 * Laporan TERTUTUP di jendela pada toko × bulan yang diminta: siklus terkunci, dan toko putus ×
 * bulan yang sudah punya baris dibayar. Dikelompokkan di basis data.
 */
async function laporanTertutupDi(
  klien: Klien,
  daftar: ReadonlyArray<{ storeId: string; bulan: string }>,
): Promise<{ siklus: { id: string; storeId: string; bulan: string }[]; putusDibayar: { storeId: string; period: string }[] }> {
  const per = tokoPerBulan(daftar);
  if (per.size === 0) return { siklus: [], putusDibayar: [] };
  const [siklus, putus] = await Promise.all([
    klien.consignmentCycle.findMany({
      where: {
        lockedAt: { not: null },
        OR: [...per].map(([bulan, toko]) => ({ periodYear: Number(bulan.slice(0, 4)), periodMonth: Number(bulan.slice(5, 7)), storeId: { in: toko } })),
      },
      select: { id: true, storeId: true, periodYear: true, periodMonth: true },
    }),
    klien.spgCommission.groupBy({
      by: ["storeId", "period"],
      where: { paidAt: { not: null }, OR: [...per].map(([bulan, toko]) => ({ period: bulan, storeId: { in: toko } })) },
    }),
  ]);
  return {
    siklus: siklus.map((c) => ({ id: c.id, storeId: c.storeId, bulan: bulanDari(c.periodYear, c.periodMonth) })),
    putusDibayar: putus.map((p) => ({ storeId: p.storeId, period: p.period })),
  };
}

/**
 * Unit komisi setiap SPG yang diminta: setiap baris resminya (belum dibayar — berapa pun umurnya —
 * atau bulan penjualannya di jendela koreksi), ditambah setiap laporan TERTUTUP di jendela tempat ia
 * menjual tanpa punya baris, ditambah setiap laporan asal koreksinya. Angkanya dihitung ulang dari
 * nota sekarang (`commissionPerSpg`, tarif kategori bulan penjualan); siklus yang kuncinya dibuka
 * memakai angka tersimpannya (tidak ada selisih sebelum dikunci lagi).
 *
 * Pemuatnya digerakkan laporan, bukan nota: penjualan dibaca sebagai kelompok penjual × toko (GROUP
 * BY di basis data, `penjualanPerBulan`), dan hanya laporan miliknya serta laporan tertutup di toko ×
 * bulan tempat ia menjual yang gerakannya dimuat (gerakan pun dijumlahkan di basis data,
 * `spgSaleMovements`). Unit laporan aturan lama yang tidak bisa
 * dibandingkan jujur ditandai `ditahan` (`alasanTahan`).
 */
export async function unitKomisiSpg(
  klien: Klien,
  userIds: readonly string[],
  sekarang: Date = new Date(),
): Promise<Map<string, UnitKomisiSpg[]>> {
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
        paidAt: true,
        cycle: { select: { storeId: true, periodYear: true, periodMonth: true, lockedAt: true } },
      },
    }),
    klien.spgCommission.findMany({
      where: { userId: { in: ids }, OR: [{ paidAt: null }, { period: { gte: awal } }] },
      select: { id: true, userId: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, basis: true, lockedAt: true, paidAt: true },
    }),
    klien.spgCommissionCorrection.findMany({
      where: { spgUserId: { in: ids } },
      select: { spgUserId: true, sourceKey: true, sourceKind: true, sourceStoreId: true, sourceSalesMonth: true, amount: true },
    }),
    // Toko × bulan tempat setiap SPG menjual di jendela — laporan tertutup tanpa baris miliknya dicari di sana.
    penjualanPerBulan(klien, { salesmanIds: ids }, awal),
  ]);

  const tertutup = await laporanTertutupDi(klien, penjualan);

  const idSiklus = [...new Set([...konsiRows.map((r) => r.cycleId), ...tertutup.siklus.map((c) => c.id)])];
  const pasangan = new Map<string, { storeId: string; period: string }>();
  for (const p of [...putusRows.map((r) => ({ storeId: r.storeId, period: r.period })), ...tertutup.putusDibayar]) {
    pasangan.set(kunciPasangan(p.storeId, p.period), p);
  }
  const daftarPasangan = [...pasangan.values()];
  const periodePasangan = [...new Set(daftarPasangan.map((p) => p.period))];
  const tokoPasangan = [...new Set(daftarPasangan.map((p) => p.storeId))];

  const [rates, konsiLaporan, cekPutus, barisPasangan, aturanLamaSiklus] = await Promise.all([
    commissionRates(klien),
    idSiklus.length ? lockedKonsiReports(klien, { cycleIds: idSiklus }) : Promise.resolve([] as KonsiSalesReport[]),
    daftarPasangan.length
      ? klien.spgSalesCheck.findMany({
          where: { storeId: { in: tokoPasangan }, period: { in: periodePasangan } },
          select: { storeId: true, period: true, checkedAt: true },
        })
      : Promise.resolve([]),
    daftarPasangan.length
      ? klien.spgCommission.findMany({
          where: { storeId: { in: tokoPasangan }, period: { in: periodePasangan } },
          select: { storeId: true, period: true, paidAt: true, lockedAt: true, basis: true },
        })
      : Promise.resolve([]),
    siklusAturanLama(klien, idSiklus),
  ]);
  const cekPer = new Map(cekPutus.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
  const infoPasangan = new Map<string, { dibayar: boolean; terakhirDitetapkan: Date | null; lama: boolean }>();
  for (const b of barisPasangan) {
    const k = kunciPasangan(b.storeId, b.period);
    if (!pasangan.has(k)) continue;
    const ada = infoPasangan.get(k) ?? { dibayar: false, terakhirDitetapkan: null, lama: false };
    if (b.paidAt) ada.dibayar = true;
    if (aturanLama(b.basis)) ada.lama = true;
    if (!ada.terakhirDitetapkan || b.lockedAt > ada.terakhirDitetapkan) ada.terakhirDitetapkan = b.lockedAt;
    infoPasangan.set(k, ada);
  }

  const putusLaporan = await putusReportsOf(
    klien,
    daftarPasangan.map((p) => {
      const k = kunciPasangan(p.storeId, p.period);
      return { storeId: p.storeId, salesMonth: p.period, checkedAt: cekPer.get(k) ?? infoPasangan.get(k)?.terakhirDitetapkan ?? sekarang };
    }),
  );

  const laporan = new Map<string, Laporan>();
  const siklusTerkunci = new Map<string, Date>();
  for (const r of konsiLaporan) {
    siklusTerkunci.set(r.cycleId, r.checkedAt);
    const hitung = commissionPerSpg(r, rates);
    laporan.set(r.key, {
      kunci: r.key,
      jenis: "KONSI",
      storeId: r.storeId,
      bulanJual: r.salesMonth,
      hitung: new Map(hitung.map((h) => [h.salesmanId, h])),
      laporanTertutup: true,
      aturanLama: aturanLamaSiklus.has(r.cycleId),
      tidakLengkap: laporanKonsiTidakLengkap(r, hitung),
    });
  }
  for (const r of putusLaporan) {
    const info = infoPasangan.get(kunciPasangan(r.storeId, r.salesMonth));
    laporan.set(r.key, {
      kunci: r.key,
      jenis: "PUTUS",
      storeId: r.storeId,
      bulanJual: r.salesMonth,
      hitung: new Map(commissionPerSpg(r, rates).map((h) => [h.salesmanId, h])),
      laporanTertutup: info?.dibayar ?? false,
      aturanLama: info?.lama ?? false,
      tidakLengkap: false,
    });
  }

  const tokoIds = [
    ...new Set([
      ...konsiRows.map((r) => r.cycle.storeId),
      ...putusRows.map((r) => r.storeId),
      ...[...laporan.values()].map((l) => l.storeId),
      ...koreksiRows.map((k) => k.sourceStoreId),
    ]),
  ];
  const toko = tokoIds.length ? await klien.store.findMany({ where: { id: { in: tokoIds } }, select: { id: true, name: true } }) : [];
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));

  const terapan = new Map<string, number>();
  const sumberKoreksi = new Map<string, { spgUserId: string; sourceKey: string; sourceKind: string; sourceStoreId: string; sourceSalesMonth: string }>();
  for (const k of koreksiRows) {
    const kk = `${k.spgUserId}\u0000${k.sourceKey}`;
    terapan.set(kk, Math.round((terapan.get(kk) ?? 0) * 100 + angka(k.amount) * 100) / 100);
    sumberKoreksi.set(kk, k);
  }
  const koreksiTerapan = (userId: string, kunci: string) => terapan.get(`${userId}\u0000${kunci}`) ?? 0;
  const jualDi = new Set(penjualan.map((p) => `${p.salesmanId}\u0000${p.storeId}\u0000${p.bulan}`));

  const nama = (storeId: string) => namaToko.get(storeId) ?? storeId;
  /** `komisiDibayar`: komisi tersimpan barisnya kalau sudah dibayar; null kalau belum dibayar atau tanpa baris. */
  const tahan = (lap: Laporan | undefined, h: SpgReportCommission | undefined, komisiDibayar: number | null, barisLama = false) =>
    lap
      ? alasanTahan({
          jenis: lap.jenis,
          dasarLama: barisLama || lap.aturanLama,
          potongTanpaTarif: h?.noRatePieces ?? 0,
          laporanTidakLengkap: lap.tidakLengkap,
          komisiDibayar,
          angka: h?.amount ?? 0,
        })
      : null;

  for (const userId of ids) {
    const units = hasil.get(userId)!;
    const punyaBaris = new Set<string>();

    for (const r of konsiRows.filter((x) => x.spgUserId === userId)) {
      const kunci = konsiReportKey(r.cycleId);
      punyaBaris.add(kunci);
      const lap = laporan.get(kunci);
      const h = lap?.hitung?.get(userId);
      const terkunci = siklusTerkunci.get(r.cycleId) ?? r.cycle.lockedAt;
      const dasarLama = lap ? lap.aturanLama : false;
      const bulanBayar = terkunci ? payoutMonth(terkunci) : null;
      units.push({
        kunci,
        jenis: "KONSI",
        storeId: r.cycle.storeId,
        namaToko: nama(r.cycle.storeId),
        bulanJual: bulanDari(r.cycle.periodYear, r.cycle.periodMonth),
        // Siklus yang kuncinya dibuka: angka tersimpannya, tanpa selisih sampai dikunci lagi.
        // Siklus terkunci: potong yang tercatat di HP, dibatasi angka resmi (Q7).
        angka: lap ? (h?.amount ?? 0) : angka(r.commission),
        potong: h?.pieces ?? 0,
        potongTanpaTarif: h?.noRatePieces ?? 0,
        baris: {
          refType: REF_KOMISI_KONSI,
          refId: r.id,
          dibayar: r.paidAt !== null,
          dapatDibayar: r.paidAt === null && Boolean(lap),
          bulanBayar,
          komisiTersimpan: angka(r.commission),
          potongTersimpan: null,
          dasarLama,
          gajiPokok: angka(r.baseSalary),
          potonganHilang: angka(r.deduction),
          dalamJendela: dalamJendelaKoreksi(bulanBayar, bulanIni),
        },
        laporanTertutup: Boolean(lap),
        koreksiTerapan: koreksiTerapan(userId, kunci),
        ditahan: tahan(lap, h, r.paidAt !== null ? angka(r.commission) : null),
      });
    }

    for (const r of putusRows.filter((x) => x.userId === userId)) {
      const kunci = putusReportKey(r.storeId, r.period);
      punyaBaris.add(kunci);
      const kp = kunciPasangan(r.storeId, r.period);
      const lap = laporan.get(kunci);
      const h = lap?.hitung?.get(userId);
      const cek = cekPer.get(kp) ?? null;
      const info = infoPasangan.get(kp);
      const dasarLama = aturanLama(r.basis);
      // Tanpa tanda dicek, barisnya pasti ditetapkan dengan aturan lama: bulan penetapan terakhirnya.
      const bulanBayar = cek ? payoutMonth(cek) : info?.terakhirDitetapkan ? payoutMonth(info.terakhirDitetapkan) : null;
      units.push({
        kunci,
        jenis: "PUTUS",
        storeId: r.storeId,
        namaToko: nama(r.storeId),
        bulanJual: r.period,
        angka: h?.amount ?? 0,
        potong: h?.pieces ?? 0,
        potongTanpaTarif: h?.noRatePieces ?? 0,
        baris: {
          refType: REF_KOMISI_SPG_PUTUS,
          refId: r.id,
          dibayar: r.paidAt !== null,
          // Dicek, atau bulan toko itu sudah sebagian dibayar (aturan lama, tanpa tanda dicek).
          dapatDibayar: r.paidAt === null && (cek !== null || Boolean(info?.dibayar)),
          bulanBayar,
          komisiTersimpan: angka(r.commission),
          potongTersimpan: r.unitsSold,
          dasarLama,
          gajiPokok: 0,
          potonganHilang: angka(r.deduction),
          dalamJendela: dalamJendelaKoreksi(bulanBayar, bulanIni),
        },
        laporanTertutup: Boolean(info?.dibayar),
        koreksiTerapan: koreksiTerapan(userId, kunci),
        ditahan: tahan(lap, h, r.paidAt !== null ? angka(r.commission) : null, dasarLama),
      });
    }

    // Laporan tertutup di jendela tempat ia menjual tanpa punya baris: dibayar lewat koreksi.
    for (const lap of laporan.values()) {
      if (punyaBaris.has(lap.kunci) || !lap.laporanTertutup || lap.bulanJual < awal) continue;
      if (!jualDi.has(`${userId}\u0000${lap.storeId}\u0000${lap.bulanJual}`) && koreksiTerapan(userId, lap.kunci) === 0) continue;
      const h = lap.hitung?.get(userId);
      const terap = koreksiTerapan(userId, lap.kunci);
      // Tanpa baris: tidak ada uang yang dulu dibayar dari angka resmi untuk ditarik kembali.
      const ditahan = tahan(lap, h, null);
      // Tanpa angka dan tanpa koreksi: tidak ada yang dibayar maupun diputuskan — kecuali unit yang
      // ditahan dengan potong (tanpa tarif) yang perlu diputuskan.
      if ((h?.amount ?? 0) <= 0 && terap === 0 && !(ditahan && (h?.pieces ?? 0) > 0)) continue;
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
        koreksiTerapan: terap,
        ditahan,
      });
    }

    // Laporan asal koreksi yang tidak termuat di atas (mis. siklusnya kini dibuka lagi): tanpa selisih.
    for (const k of sumberKoreksi.values()) {
      if (k.spgUserId !== userId || punyaBaris.has(k.sourceKey) || k.sourceSalesMonth < awal) continue;
      punyaBaris.add(k.sourceKey);
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
        koreksiTerapan: koreksiTerapan(userId, k.sourceKey),
        ditahan: null,
      });
    }

    units.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || (a.kunci < b.kunci ? -1 : a.kunci > b.kunci ? 1 : 0));
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// Koreksi yang sudah diterapkan
// ---------------------------------------------------------------------------

export type KoreksiTercatat = {
  id: string;
  spgUserId: string;
  sumber: string;
  jenis: "KONSI" | "PUTUS";
  storeId: string;
  bulanJual: string;
  jumlah: number;
  teks: string;
  paidRefType: RefBarisKomisi;
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
    teks: r.note,
    paidRefType: r.paidRefType === REF_KOMISI_KONSI ? REF_KOMISI_KONSI : REF_KOMISI_SPG_PUTUS,
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
  const jenis = new Map(refs.map((r) => [r.refId, r.refType]));
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

/** Koreksi yang dibayar dalam satu bulan pembayaran. `scope` membatasi SPG atau toko asalnya. */
export async function koreksiBulanBayar(
  klien: Klien,
  payoutMonthKey: string,
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<KoreksiTercatat[]> {
  const rows = await klien.spgCommissionCorrection.findMany({
    where: {
      payoutMonth: payoutMonthKey,
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
  /**
   * Menunggu keputusan pemilik (`alasanTahan`, aturan yang sama dengan `unitKomisiSpg`): penulis
   * menolak membayarnya, jadi baris ini didaftar terpisah di kartu #tunggakan dan TIDAK dihitung di
   * Beranda — pemegang izin membayar tidak bisa menyelesaikannya sampai pemilik memutuskan. Hanya
   * sebab yang menahan pembayaran (`alasanTahanBayar`, kini `TANPA_TARIF`).
   */
  ditahan: AlasanTahanKoreksi | null;
};

/**
 * Sebab setiap baris tunggakan menunggu keputusan pemilik, menurut id barisnya — aturan yang SAMA
 * dengan `unitKomisiSpg` (`alasanTahan` atas laporan aturan lama, untuk baris yang BELUM dibayar:
 * potong tanpa tarif kategori; siklus yang angka resminya tidak seluruhnya tercatat di HP tidak
 * menahan baris yang belum dibayar — ia dibayar dengan aturan hari ini, Q7). Hanya laporan aturan
 * lama yang dihitung ulang — siklus yang jejak kunci terakhirnya tanpa `aturanKomisi =
 * TARIF_KATEGORI`, dan toko putus × bulan yang punya baris berdasar lama — jadi Beranda tidak
 * menghitung ulang laporan aturan baru, dan bebannya menyusut sendiri begitu baris aturan lama
 * terbayar atau diputuskan.
 */
async function alasanTahanTunggakan(
  klien: Klien,
  konsi: ReadonlyArray<{ refId: string; spgUserId: string; cycleId: string }>,
  putusLama: ReadonlyArray<{ refId: string; spgUserId: string; storeId: string; period: string; checkedAt: Date }>,
): Promise<Map<string, AlasanTahanKoreksi>> {
  const hasil = new Map<string, AlasanTahanKoreksi>();
  const siklusLama = await siklusAturanLama(klien, konsi.map((k) => k.cycleId));
  const konsiLama = konsi.filter((k) => siklusLama.has(k.cycleId));
  if (konsiLama.length === 0 && putusLama.length === 0) return hasil;

  const pasangan = new Map<string, { storeId: string; salesMonth: string; checkedAt: Date }>();
  for (const p of putusLama) pasangan.set(kunciPasangan(p.storeId, p.period), { storeId: p.storeId, salesMonth: p.period, checkedAt: p.checkedAt });
  const [rates, laporanKonsi, laporanPutus] = await Promise.all([
    commissionRates(klien),
    konsiLama.length ? lockedKonsiReports(klien, { cycleIds: [...new Set(konsiLama.map((k) => k.cycleId))] }) : Promise.resolve([] as KonsiSalesReport[]),
    putusReportsOf(klien, [...pasangan.values()]),
  ]);
  const perKunci = new Map<string, { hitung: Map<string, SpgReportCommission>; tidakLengkap: boolean }>();
  for (const r of laporanKonsi) {
    const hitung = commissionPerSpg(r, rates);
    perKunci.set(r.key, { hitung: new Map(hitung.map((h) => [h.salesmanId, h])), tidakLengkap: laporanKonsiTidakLengkap(r, hitung) });
  }
  for (const r of laporanPutus) {
    perKunci.set(r.key, { hitung: new Map(commissionPerSpg(r, rates).map((h) => [h.salesmanId, h])), tidakLengkap: false });
  }
  const tandai = (refId: string, jenis: "KONSI" | "PUTUS", kunci: string, spgUserId: string) => {
    const l = perKunci.get(kunci);
    if (!l) return;
    const h = l.hitung.get(spgUserId);
    // Baris tunggakan belum dibayar: `komisiDibayar` null — sama dengan penulis yang membayarnya.
    const a = alasanTahanBayar(
      alasanTahan({
        jenis,
        dasarLama: true,
        potongTanpaTarif: h?.noRatePieces ?? 0,
        laporanTidakLengkap: l.tidakLengkap,
        komisiDibayar: null,
        angka: h?.amount ?? 0,
      }),
    );
    if (a) hasil.set(refId, a);
  };
  for (const k of konsiLama) tandai(k.refId, "KONSI", konsiReportKey(k.cycleId), k.spgUserId);
  for (const p of putusLama) tandai(p.refId, "PUTUS", putusReportKey(p.storeId, p.period), p.spgUserId);
  return hasil;
}

/**
 * Baris belum dibayar yang SUDAH boleh dibayar (siklus terkunci; toko putus dicek atau sebagian
 * bulannya dibayar) dengan bulan pembayaran sebelum bulan berjalan, dibagi dua tanpa irisan:
 * `JENDELA` (bulan pembayaran di jendela koreksi) — kartu #tunggakan dan baris Beranda, satu
 * definisi — dan `LAMA` (lebih tua): didaftar terpisah di kartu yang sama ("lebih dari 12 bulan"),
 * tidak pernah menjadi sasaran koreksi, dan TIDAK dihitung di Beranda — baris peninggalan yang
 * tidak akan dibayar lewat ERP tidak boleh membuat Beranda menyala selamanya. Setiap baris membawa
 * `ditahan` (`alasanTahanTunggakan`): baris yang menunggu keputusan pemilik juga tidak dihitung di
 * Beranda, karena pemegang izin membayar tidak bisa menyelesaikannya.
 */
async function tunggakan(
  klien: Klien,
  sekarang: Date,
  scope: { userIds?: string[]; storeIds?: string[] },
  mode: "JENDELA" | "LAMA",
): Promise<TunggakanKomisi[]> {
  const bulanIni = bulanWib(sekarang);
  const awal = awalJendelaKoreksi(bulanIni);
  const mulaiBulanIni = wibMonthRange(bulanIni).start;
  const mulaiJendela = wibMonthRange(awal).start;
  const rentangKunci = mode === "JENDELA" ? { gte: mulaiJendela, lt: mulaiBulanIni } : { lt: mulaiJendela };
  const bulanMasuk = (bulanBayar: string) => (mode === "JENDELA" ? bulanBayar >= awal && bulanBayar < bulanIni : bulanBayar < awal);
  const filterUser = scope.userIds !== undefined ? { in: scope.userIds } : undefined;
  const filterToko = scope.storeIds !== undefined ? { in: scope.storeIds } : undefined;

  const [konsi, putus] = await Promise.all([
    klien.consignmentCommission.findMany({
      where: {
        paidAt: null,
        ...(filterUser ? { spgUserId: filterUser } : {}),
        cycle: { lockedAt: rentangKunci, ...(filterToko ? { storeId: filterToko } : {}) },
      },
      select: {
        id: true,
        cycleId: true,
        spgUserId: true,
        spgUser: { select: { name: true, email: true } },
        cycle: { select: { storeId: true, noKonsi: true, periodYear: true, periodMonth: true, lockedAt: true, store: { select: { name: true } } } },
      },
    }),
    klien.spgCommission.findMany({
      where: { paidAt: null, ...(filterUser ? { userId: filterUser } : {}), ...(filterToko ? { storeId: filterToko } : {}) },
      select: { id: true, userId: true, storeId: true, period: true },
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
    });
  }
  const putusLama: { refId: string; spgUserId: string; storeId: string; period: string; checkedAt: Date }[] = [];

  if (putus.length > 0) {
    const toko = [...new Set(putus.map((p) => p.storeId))];
    const periode = [...new Set(putus.map((p) => p.period))];
    const [cek, barisPasangan, orang, namaToko] = await Promise.all([
      klien.spgSalesCheck.findMany({ where: { storeId: { in: toko }, period: { in: periode } }, select: { storeId: true, period: true, checkedAt: true } }),
      klien.spgCommission.findMany({
        where: { storeId: { in: toko }, period: { in: periode } },
        select: { storeId: true, period: true, paidAt: true, lockedAt: true, basis: true },
      }),
      klien.user.findMany({ where: { id: { in: [...new Set(putus.map((p) => p.userId))] } }, select: { id: true, name: true, email: true } }),
      klien.store.findMany({ where: { id: { in: toko } }, select: { id: true, name: true } }),
    ]);
    const cekPer = new Map(cek.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
    const info = new Map<string, { dibayar: boolean; terakhir: Date | null; lama: boolean }>();
    for (const b of barisPasangan) {
      const kp = kunciPasangan(b.storeId, b.period);
      const ada = info.get(kp) ?? { dibayar: false, terakhir: null, lama: false };
      if (b.paidAt) ada.dibayar = true;
      // Satu baris berdasar lama menjadikan toko × bulan itu laporan aturan lama (sama dengan `unitKomisiSpg`).
      if (aturanLama(b.basis)) ada.lama = true;
      if (!ada.terakhir || b.lockedAt > ada.terakhir) ada.terakhir = b.lockedAt;
      info.set(kp, ada);
    }
    const namaPer = new Map(orang.map((u) => [u.id, namaOrang(u)]));
    const tokoPer = new Map(namaToko.map((t) => [t.id, t.name]));
    for (const p of putus) {
      const kp = kunciPasangan(p.storeId, p.period);
      const c = cekPer.get(kp) ?? null;
      const i = info.get(kp);
      if (!c && !i?.dibayar) continue;
      const waktu = c ?? i?.terakhir ?? null;
      if (!waktu) continue;
      const bulanBayar = payoutMonth(waktu);
      if (!bulanMasuk(bulanBayar)) continue;
      hasil.push({
        refType: REF_KOMISI_SPG_PUTUS,
        refId: p.id,
        jenis: "PUTUS",
        spgUserId: p.userId,
        nama: namaPer.get(p.userId) ?? p.userId,
        storeId: p.storeId,
        namaToko: tokoPer.get(p.storeId) ?? p.storeId,
        bulanJual: p.period,
        bulanBayar,
        cycleId: null,
        noKonsi: null,
        ditahan: null,
      });
      if (i?.lama) putusLama.push({ refId: p.id, spgUserId: p.userId, storeId: p.storeId, period: p.period, checkedAt: waktu });
    }
  }

  const tahan = await alasanTahanTunggakan(
    klien,
    hasil.flatMap((t) => (t.jenis === "KONSI" && t.cycleId ? [{ refId: t.refId, spgUserId: t.spgUserId, cycleId: t.cycleId }] : [])),
    putusLama,
  );
  for (const t of hasil) t.ditahan = tahan.get(t.refId) ?? null;

  return hasil.sort(
    (a, b) =>
      a.bulanBayar.localeCompare(b.bulanBayar) ||
      a.bulanJual.localeCompare(b.bulanJual) ||
      a.namaToko.localeCompare(b.namaToko) ||
      a.nama.localeCompare(b.nama) ||
      (a.refId < b.refId ? -1 : 1),
  );
}

/**
 * Kartu #tunggakan di Komisi SPG, bagian bulan pembayaran di jendela koreksi. Yang `ditahan: null`
 * di antaranya — yang bisa dibayar sekarang — tepat yang dihitung baris Beranda
 * `spgCommissionsUnpaidPast` (`jumlahKomisiSpgTertunggak`); yang ditahan didaftar terpisah di kartu
 * itu ("menunggu keputusan pemilik").
 */
export function daftarTunggakanKomisi(
  klien: Klien,
  sekarang: Date = new Date(),
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<TunggakanKomisi[]> {
  return tunggakan(klien, sekarang, scope, "JENDELA");
}

/** Kartu #tunggakan, bagian bulan pembayaran lebih tua dari jendela koreksi — didaftar terpisah, tidak dihitung di Beranda. */
export function daftarTunggakanKomisiLama(
  klien: Klien,
  sekarang: Date = new Date(),
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<TunggakanKomisi[]> {
  return tunggakan(klien, sekarang, scope, "LAMA");
}

/**
 * Angka baris Beranda `spgCommissionsUnpaidPast` — tepat banyaknya baris kartu #tunggakan di jendela
 * koreksi yang BISA dibayar: tanpa yang menunggu keputusan pemilik (`ditahan`), yang tidak bisa
 * diselesaikan pemegang izin membayar dan akan membuat baris Beranda menyala selamanya.
 */
export async function jumlahKomisiSpgTertunggak(sekarang: Date = new Date()): Promise<number> {
  return (await daftarTunggakanKomisi(prisma, sekarang)).filter((t) => t.ditahan === null).length;
}

/**
 * SPG yang unitnya diperiksa halaman Komisi SPG untuk koreksi yang menunggu: pemegang baris resmi
 * (belum dibayar, atau bulan penjualannya di jendela), penerima koreksi di jendela, dan — supaya
 * kantor melihat yang dilihat HP-nya (`ringkasGajiSaya`) — penjual TANPA baris apa pun di jendela
 * yang menjual di laporan yang sudah tertutup (notanya masuk sesudah dikunci/dibayar). Bukan setiap
 * SPG yang pernah menjual: penjualan dibaca sebagai kelompok penjual × toko × bulan di basis data,
 * dan hanya yang jatuh di laporan tertutup yang ikut.
 */
export async function pemegangKomisiSpg(
  klien: Klien,
  sekarang: Date = new Date(),
  scope: { userIds?: string[]; storeIds?: string[] } = {},
): Promise<string[]> {
  const bulanIni = bulanWib(sekarang);
  const awal = awalJendelaKoreksi(bulanIni);
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
      ...tertutup.putusDibayar.map((p) => kunciPasangan(p.storeId, p.period)),
    ]);
    for (const p of tanpaBaris) if (kunciTertutup.has(kunciPasangan(p.storeId, p.bulan))) pemegang.add(p.salesmanId);
  }
  return [...pemegang];
}

/**
 * Retur pembeli yang masih MENUNGGU persetujuan per toko × bulan penjualan (bulan returnya
 * dilaporkan). Diperlihatkan saat mencek, mengunci, dan membayar: kalau disetujui sesudah
 * komisinya dibayar, selisihnya jadi koreksi minus di pembayaran berikutnya SPG itu.
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
        where: { ...RETUR_PEMBELI_MENUNGGU, storeId: { in: [...toko] }, createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      });
      for (const g of grup) hasil.set(kunciPasangan(g.storeId, bulanJual), g._count._all);
    }),
  );
  return hasil;
}

/** Kunci peta `returMenungguPerLaporan`. */
export const kunciReturMenunggu = (storeId: string, bulanJual: string) => kunciPasangan(storeId, bulanJual);
