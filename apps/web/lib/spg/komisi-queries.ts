import { prisma, type Prisma } from "@elorae/db";
import { sebelumSiklusPertama } from "@/lib/konsinyasi/siklus-pertama-aturan";
import { bulanWib } from "@/lib/salesman/pengaturan";
import type { CommissionRate } from "@/lib/spg-commission/compute";
import {
  commissionRates,
  lockedKonsiReports,
  putusPayoutReports,
  putusReportOf,
  putusReportsOf,
  spgSaleMovements,
  wibMonthRange,
} from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, konsiReportKey, payoutMonth, putusReportKey, type SalesReport } from "@/lib/spg-commission/payout";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { bagianHilangTerbukaSpg, sisaBebanHilangPerOrang } from "./hilang-db";
import { dibayarkanTersimpan } from "./komisi-hp";
import { bacaDetailGaji, type AlasanTahanBayar, type HasilGaji, type RincianGaji } from "./gaji-pokok";
import { kunciGaji, kunciTokoBulan, lantaiBulanKonsi, muatGajiPokok, muatPesertaGaji } from "./gaji-pokok-queries";
import {
  barisSasaranKoreksi,
  rencanaBayarSemua,
  selisihMenunggu,
  type BarisKoreksi,
  type KonteksBayar,
  type RefBarisKomisi,
  type RencanaBayarKomisi,
  type UnitKomisiSpg,
} from "./koreksi";
import {
  daftarTunggakanKomisi,
  koreksiBulanBayar,
  koreksiPadaPembayaran,
  pemegangKomisiSpg,
  returMenungguPerLaporan,
  unitKomisiSpg,
  type TunggakanKomisi,
} from "./koreksi-queries";
import { pembayaranAkhir } from "./koreksi-akhir";
import { bebanReturTerbukaSpg, kembaliBebanTerbukaSpg, potonganLainPadaPembayaran, utangTerbukaSpg } from "./utang-queries";
import {
  bulanSebelum,
  laporanPerluDicek,
  potongTanpaKategori,
  statusResmi,
  sudahBerbeda,
  susunKomisiToko,
  type BarisResmiAda,
  type HasilKomisiToko,
  type KomisiPerSpg,
  type OrangKomisi,
  type StatusKomisi,
} from "./komisi";

/**
 * Pemuat komisi SPG untuk HP, kantor, dan penulis. Angkanya SELALU dari satu hitungan
 * (`lib/spg-commission/payout.ts`, lewat `laporan-queries.ts`): tarif per kategori bulan penjualan ×
 * potong yang dijual SPG itu sendiri — toko konsinyasi dan toko putus sama. `Item.commissionPerPcs`
 * dan pembagian rata tidak dibaca di mana pun di sini.
 *
 * Klien Prisma boleh transaksi: penulis memanggilnya di dalam `runSerializable` sehingga hitungan
 * dan penulisannya melihat keadaan yang sama.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);
const namaOrang = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;
const kunciPasangan = (storeId: string, periode: string) => `${storeId}\u0000${periode}`;

type RefPembayaranKomisi = { refType: RefBarisKomisi; refId: string };

/** Berapa bulan selesai ke belakang yang diperiksa untuk laporan yang menunggu dicek. */
export const BULAN_MENUNGGU_CEK = 12;

/**
 * Orang yang mungkin menerima komisi di setiap toko: SPG yang bertugas di sana, ditambah
 * `tambahan` per toko (penjual bulan itu, pemegang baris resmi) supaya namanya tetap terlihat.
 */
export async function orangKomisiToko(
  db: Klien,
  storeIds: string[],
  tambahan: Map<string, string[]> = new Map(),
): Promise<Map<string, OrangKomisi[]>> {
  const ids = [...new Set(storeIds)];
  const hasil = new Map<string, OrangKomisi[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return hasil;
  const bertugas = await db.user.findMany({
    where: { assignedStoreId: { in: ids } },
    select: { id: true, name: true, email: true, assignedStoreId: true },
  });
  const dikenal = new Map(bertugas.map((u) => [u.id, namaOrang(u)]));
  const belum = [...new Set([...tambahan.values()].flat())].filter((id) => !dikenal.has(id));
  if (belum.length > 0) {
    const lain = await db.user.findMany({ where: { id: { in: belum } }, select: { id: true, name: true, email: true } });
    for (const u of lain) dikenal.set(u.id, namaOrang(u));
  }
  for (const storeId of ids) {
    const tugas = bertugas.filter((u) => u.assignedStoreId === storeId);
    const idTugas = new Set(tugas.map((u) => u.id));
    hasil.set(storeId, [
      ...tugas.map((u) => ({ userId: u.id, nama: namaOrang(u), ditugaskan: true })),
      ...[...new Set(tambahan.get(storeId) ?? [])]
        .filter((id) => !idTugas.has(id))
        .map((id) => ({ userId: id, nama: dikenal.get(id) ?? id, ditugaskan: false })),
    ]);
  }
  return hasil;
}

/** Hitungan beberapa laporan, masing-masing disandingkan dengan orang tokonya. */
async function susunLaporan(
  db: Klien,
  laporan: readonly SalesReport[],
  rates: readonly CommissionRate[],
  tambahanPerKunci: Map<string, string[]> = new Map(),
): Promise<Map<string, HasilKomisiToko>> {
  const hitung = new Map(laporan.map((l) => [l.key, commissionPerSpg(l, rates)] as const));
  const tambahan = new Map<string, string[]>();
  for (const l of laporan) {
    const ids = [...(hitung.get(l.key) ?? []).map((h) => h.salesmanId), ...(tambahanPerKunci.get(l.key) ?? [])];
    tambahan.set(l.storeId, [...(tambahan.get(l.storeId) ?? []), ...ids]);
  }
  const orang = await orangKomisiToko(db, laporan.map((l) => l.storeId), tambahan);
  return new Map(
    laporan.map((l) => {
      const milikLaporan = new Set([...(hitung.get(l.key) ?? []).map((h) => h.salesmanId), ...(tambahanPerKunci.get(l.key) ?? [])]);
      // Orang toko itu: yang bertugas, plus penjual/pemegang baris laporan INI (bukan laporan lain toko yang sama).
      const daftar = (orang.get(l.storeId) ?? []).filter((o) => o.ditugaskan || milikLaporan.has(o.userId));
      return [l.key, susunKomisiToko(hitung.get(l.key) ?? [], daftar)] as const;
    }),
  );
}

/**
 * Hitungan satu toko putus × bulan penjualan — angka yang ditulis "Tetapkan" dan ditampilkan
 * kantor. `dicekPada` = waktu laporan itu dicek (atau sekarang, kalau belum).
 */
export async function hitunganPutus(
  db: Klien,
  storeId: string,
  periode: string,
  dicekPada: Date,
  tambahanOrang: string[] = [],
): Promise<{ laporan: SalesReport; hasil: HasilKomisiToko }> {
  const [rates, laporan] = await Promise.all([commissionRates(db), putusReportOf(db, storeId, periode, dicekPada)]);
  const hasil = (await susunLaporan(db, [laporan], rates, new Map([[laporan.key, tambahanOrang]]))).get(laporan.key)!;
  return { laporan, hasil };
}

export const keBarisResmi = (r: {
  id: string;
  userId: string;
  unitsSold: number;
  commission: unknown;
  basis: string;
  baseSalary?: unknown;
  salaryDetail?: unknown;
  paidAt: Date | null;
}): BarisResmiAda => ({
  id: r.id,
  userId: r.userId,
  unitsSold: r.unitsSold,
  commission: angka(r.commission),
  basis: r.basis,
  baseSalary: angka(r.baseSalary),
  salaryDetail: r.salaryDetail ?? null,
  paidAt: r.paidAt,
});

/**
 * Konteks pengurang setiap SPG yang diminta (bagian beban barang hilang, beban retur pembeli,
 * pengembalian beban, utang) dan penanda pembayaran terakhirnya — untuk rencana bayar yang
 * ditampilkan. Satu bacaan dengan penulis (`siapkanBayarKomisi`), jadi yang dilihat = yang dibayar.
 */
export async function konteksBayarSpg(
  db: Klien,
  units: ReadonlyMap<string, readonly UnitKomisiSpg[]>,
): Promise<Map<string, Omit<KonteksBayar, "akhir"> & { akhir: (refId: string) => boolean }>> {
  const hasil = new Map<string, Omit<KonteksBayar, "akhir"> & { akhir: (refId: string) => boolean }>();
  for (const [userId, daftar] of units) {
    const belum = daftar.filter((u) => u.baris && !u.baris.dibayar && u.baris.dapatDibayar && !u.ditahan);
    if (belum.length === 0) continue;
    const [bebanHilang, bebanRetur, kembaliBeban, utang] = await Promise.all([
      bagianHilangTerbukaSpg(db, userId),
      bebanReturTerbukaSpg(db, userId),
      kembaliBebanTerbukaSpg(db, userId),
      utangTerbukaSpg(db, userId),
    ]);
    const akhir = new Set<string>();
    const berhenti = await db.user.findUnique({ where: { id: userId }, select: { spgEndedOn: true } });
    if (berhenti?.spgEndedOn) {
      for (const u of belum) {
        if (!u.baris) continue;
        if ((await pembayaranAkhir(db, { userId, refType: u.baris.refType, refId: u.baris.refId })).akhir) akhir.add(u.baris.refId);
      }
    }
    hasil.set(userId, { bebanHilang, bebanRetur, kembaliBeban, utang, akhir: (refId) => akhir.has(refId) });
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// HP SPG
// ---------------------------------------------------------------------------

/**
 * Perkiraan komisi bulan berjalan untuk SPG yang melihat layar: potong yang IA jual sendiri bulan
 * ini (sesudah dikurangi barang yang dikembalikan pembeli) × tarif kategori bulan ini. Di toko
 * konsinyasi angka resmi toko belum ada, jadi perkiraannya dari catatan kasir saja.
 *
 * Yang sampai ke HP hanya bagian SPG itu sendiri — rupiah, nama, dan id rekan TIDAK PERNAH.
 * `totalToko` sama dengan bagiannya sendiri (bentuk lama dipertahankan untuk Beranda SPG), dan
 * `dasar` selalu `PER_SPG`: setiap SPG dibayar dari penjualannya sendiri, tidak ada bagi rata.
 */
export type PerkiraanKomisiHp = {
  bulan: string;
  jenis: "KONSI" | "PUTUS";
  dasar: "PER_SPG";
  totalToko: number;
  bagianSaya: number;
  jumlahSpg: number;
  potongSaya: number;
  /** Selalu null: potong seluruh toko bukan urusan HP SPG. */
  potongToko: number | null;
  /** Potongnya yang belum bertarif (barang tanpa kategori, atau kategorinya belum bertarif). */
  potongTanpaTarifSaya: number;
};

export async function perkiraanKomisiHp(
  userId: string,
  toko: { id: string; termsType: "PUTUS" | "KONSI" },
  hariIni: Date,
): Promise<PerkiraanKomisiHp | null> {
  const bulan = bulanWib(hariIni);
  const [rates, gerak, jumlahSpg] = await Promise.all([
    commissionRates(prisma),
    spgSaleMovements(prisma, [toko.id], bulan),
    prisma.user.count({ where: { assignedStoreId: toko.id } }),
  ]);
  const laporan: SalesReport = {
    key: `perkiraan:${toko.id}:${bulan}`,
    kind: toko.termsType,
    storeId: toko.id,
    salesMonth: bulan,
    checkedAt: hariIni,
    official: null,
    movements: gerak.get(toko.id) ?? [],
  };
  const saya = commissionPerSpg(laporan, rates).find((r) => r.salesmanId === userId);
  const bagianSaya = saya?.amount ?? 0;
  return {
    bulan,
    jenis: toko.termsType,
    dasar: "PER_SPG",
    totalToko: bagianSaya,
    bagianSaya,
    jumlahSpg,
    potongSaya: saya?.pieces ?? 0,
    potongToko: null,
    potongTanpaTarifSaya: saya?.noRatePieces ?? 0,
  };
}

/**
 * Baris resmi toko putus milik SPG ini saja. `bulanBayar` = bulan laporannya dicek (toko putus hanya
 * dibayar sesudah dicek); baris tanpa tanda dicek tidak punya bulan pembayaran.
 */
export async function komisiPutusResmiSaya(userId: string, batas = 6) {
  const rows = await prisma.spgCommission.findMany({
    where: { userId },
    orderBy: [{ period: "desc" }, { lockedAt: "desc" }],
    take: batas,
    select: { id: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, baseSalary: true, salaryDetail: true, lockedAt: true, paidAt: true },
  });
  const [toko, cek] = await Promise.all([
    prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, name: true } }),
    rows.length
      ? prisma.spgSalesCheck.findMany({
          where: { OR: rows.map((r) => ({ storeId: r.storeId, period: r.period })) },
          select: { storeId: true, period: true, checkedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const nama = new Map(toko.map((t) => [t.id, t.name]));
  const dicek = new Map(cek.map((c) => [kunciPasangan(c.storeId, c.period), c.checkedAt]));
  return rows.map((r) => {
    const waktuCek = dicek.get(kunciPasangan(r.storeId, r.period)) ?? null;
    return {
      id: r.id,
      storeId: r.storeId,
      periode: r.period,
      toko: nama.get(r.storeId) ?? "—",
      potong: r.unitsSold,
      komisi: angka(r.commission),
      gajiPokok: angka(r.baseSalary),
      salaryDetail: r.salaryDetail,
      /** Beban barang hilang yang dipotong saat dibayar. */
      potonganHilang: angka(r.deduction),
      bulanBayar: waktuCek ? payoutMonth(waktuCek) : null,
      ditetapkan: r.lockedAt.toISOString(),
      dibayar: r.paidAt ? r.paidAt.toISOString() : null,
    };
  });
}

/** Satu koreksi pada pembayaran resmi di HP SPG — hanya bulan, toko, dan rupiahnya sendiri. */
export type KoreksiHp = {
  bulanJual: string;
  toko: string;
  jumlah: number;
  /** Bagian gaji pokok dari `jumlah` ("koreksi gaji pokok"). */
  gaji: number;
  /** Sudah diterapkan (pembayaran sudah dibayar); false = ikut dibayar bersama pembayaran ini. */
  diterapkan: boolean;
  /** Bagian minus yang dibawa ke pembayaran berikutnya (≤ 0). */
  dibawa: number;
};

/** Satu pembayaran resmi di HP SPG: gaji pokok + komisi satu bulan kerja (konsinyasi atau toko putus). */
export type KomisiResmiHp = {
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  /** Bulan penjualannya — catatan "Komisi penjualan …". */
  bulanJual: string;
  /** Bulan pembayarannya (bulan laporannya dicek); null selama kunci siklusnya dibuka lagi. */
  bulanBayar: string | null;
  toko: string;
  /** Gaji pokok: yang dibayar, atau yang AKAN dibayar kalau belum dibayar. */
  gaji: number;
  /** Rincian gaji pokoknya (bulan penuh / tengah bulan, hari terjadwal, izin, tidak masuk …). */
  rincianGaji: RincianGaji | null;
  /** Komisi per SPG: yang dibayar, atau yang AKAN dibayar kalau belum dibayar. */
  komisi: number;
  /** Angka tersimpan yang diganti komisi per SPG saat dibayar; null kalau sama. */
  komisiLama: number | null;
  total: number;
  potonganHilang: number;
  potonganRetur: number;
  potonganUtang: number;
  /** Σ pengurang (koreksi minus, beban, utang) yang diambil dari komisi / dari gaji pokok. */
  dariKomisi: number;
  dariGaji: number;
  /** Potong terjual — hanya toko putus (konsinyasi tidak menyimpannya per SPG). */
  potong: number | null;
  ditetapkan: string | null;
  dibayar: string | null;
  koreksi: KoreksiHp[];
  /** Yang diterima / akan diterima. */
  diterima: number;
  /** Pembayarannya menunggu (P60): tanpa rupiah di layar, hanya sebab dan harinya. */
  ditahan: AlasanTahanBayar | null;
  hariTahan: string[];
};

type ResmiDasar = Omit<KomisiResmiHp, "komisiLama" | "koreksi" | "diterima" | "ditahan" | "hariTahan" | "potonganRetur" | "potonganUtang" | "dariKomisi" | "dariGaji"> & {
  refType: RefBarisKomisi;
  refId: string;
  kunciLaporan: string;
  storeId: string;
};

const rincianTersimpan = (x: unknown): RincianGaji | null => {
  const d = bacaDetailGaji(x);
  return d?.jenis === "RINCIAN" ? d.rincian : null;
};

/** Baris resmi SPG ini apa adanya (angka tersimpan), terbaru dulu menurut bulan pembayaran. */
async function komisiResmiDasar(userId: string, batas: number): Promise<ResmiDasar[]> {
  const [konsi, putus] = await Promise.all([
    prisma.consignmentCommission.findMany({
      where: { spgUserId: userId },
      orderBy: [{ cycle: { periodYear: "desc" } }, { cycle: { periodMonth: "desc" } }],
      take: batas,
      select: {
        id: true,
        cycleId: true,
        baseSalary: true,
        commission: true,
        total: true,
        deduction: true,
        salaryDetail: true,
        paidAt: true,
        cycle: { select: { storeId: true, periodYear: true, periodMonth: true, lockedAt: true, store: { select: { name: true } } } },
      },
    }),
    komisiPutusResmiSaya(userId, batas),
  ]);
  // Callback bertipe: tanpa itu `refType` melebar ke string di dalam spread (TS2322).
  const semua: ResmiDasar[] = [
    ...konsi.map(
      (r): ResmiDasar => ({
        kunci: `konsi:${r.cycleId}`,
        refType: REF_KOMISI_KONSI,
        refId: r.id,
        kunciLaporan: konsiReportKey(r.cycleId),
        storeId: r.cycle.storeId,
        jenis: "KONSI" as const,
        bulanJual: `${r.cycle.periodYear}-${String(r.cycle.periodMonth).padStart(2, "0")}`,
        bulanBayar: r.cycle.lockedAt ? payoutMonth(r.cycle.lockedAt) : null,
        toko: r.cycle.store.name,
        gaji: angka(r.baseSalary),
        rincianGaji: rincianTersimpan(r.salaryDetail),
        komisi: angka(r.commission),
        total: angka(r.total),
        potonganHilang: angka(r.deduction),
        potong: null,
        ditetapkan: r.cycle.lockedAt ? r.cycle.lockedAt.toISOString() : null,
        dibayar: r.paidAt ? r.paidAt.toISOString() : null,
      }),
    ),
    ...putus.map(
      (r): ResmiDasar => ({
        kunci: `putus:${r.id}`,
        refType: REF_KOMISI_SPG_PUTUS,
        refId: r.id,
        kunciLaporan: putusReportKey(r.storeId, r.periode),
        storeId: r.storeId,
        jenis: "PUTUS" as const,
        bulanJual: r.periode,
        bulanBayar: r.bulanBayar,
        toko: r.toko,
        gaji: r.gajiPokok,
        rincianGaji: rincianTersimpan(r.salaryDetail),
        komisi: r.komisi,
        total: r.gajiPokok + r.komisi,
        potonganHilang: r.potonganHilang,
        potong: r.potong,
        ditetapkan: r.ditetapkan,
        dibayar: r.dibayar,
      }),
    ),
  ];
  const urutBayar = (x: string | null) => x ?? "9999-99";
  return semua
    .sort((a, b) => urutBayar(b.bulanBayar).localeCompare(urutBayar(a.bulanBayar)) || b.bulanJual.localeCompare(a.bulanJual) || a.jenis.localeCompare(b.jenis))
    .slice(0, batas);
}

const samaSen = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Pembayaran resmi SPG ini (konsinyasi dan toko putus, terbaru dulu menurut bulan pembayaran)
 * dengan angka yang SAMA dengan yang dibayar kantor: baris yang sudah dibayar dengan koreksi yang
 * diterapkan padanya; baris yang belum dibayar dengan gaji pokok dan komisi sekarang, koreksi yang
 * akan ikut, dan pengurang yang akan dipotong (`rencanaBayarKomisi`). Baris yang ditahan (P60) tidak
 * membawa rupiah — hanya sebab dan harinya. Hanya milik SPG ini: tidak ada rupiah, nama, atau id
 * rekan. Satu pembaca untuk kartu Beranda SPG dan `/pwa/spg/gaji`.
 */
export async function ringkasGajiSaya(
  userId: string,
  batas = 6,
): Promise<{ resmi: KomisiResmiHp[]; koreksiMenunggu: Array<{ bulanJual: string; toko: string; jumlah: number }> }> {
  const sekarang = new Date();
  const [dasar, petaUnit] = await Promise.all([komisiResmiDasar(userId, batas), unitKomisiSpg(prisma, [userId], sekarang)]);
  const units = petaUnit.get(userId) ?? [];
  const konteks = (await konteksBayarSpg(prisma, petaUnit)).get(userId);
  const rencana = rencanaBayarSemua(units, konteks);
  const unitPer = new Map(units.map((u) => [u.kunci, u]));
  const refDibayar = dasar.filter((r) => r.dibayar !== null).map((r) => ({ refType: r.refType, refId: r.refId }));
  const [terapan, lainDibayar] = await Promise.all([koreksiPadaPembayaran(prisma, refDibayar), potonganLainPadaPembayaran(prisma, refDibayar)]);
  const tokoKoreksi = [...new Set([...terapan.values()].flat().map((k) => k.storeId))];
  const namaToko = new Map(units.map((u) => [u.storeId, u.namaToko]));
  const kurang = tokoKoreksi.filter((id) => !namaToko.has(id));
  if (kurang.length) for (const t of await prisma.store.findMany({ where: { id: { in: kurang } }, select: { id: true, name: true } })) namaToko.set(t.id, t.name);

  const resmi: KomisiResmiHp[] = dasar.map((r) => {
    const { refId, kunciLaporan } = r;
    const tampil = {
      kunci: r.kunci,
      jenis: r.jenis,
      bulanJual: r.bulanJual,
      bulanBayar: r.bulanBayar,
      toko: r.toko,
      gaji: r.gaji,
      rincianGaji: r.rincianGaji,
      komisi: r.komisi,
      total: r.total,
      potonganHilang: r.potonganHilang,
      potonganRetur: 0,
      potonganUtang: 0,
      dariKomisi: 0,
      dariGaji: 0,
      potong: r.potong,
      ditetapkan: r.ditetapkan,
      dibayar: r.dibayar,
    };
    if (r.dibayar !== null) {
      const k = (terapan.get(refId) ?? []).map((x) => ({
        bulanJual: x.bulanJual,
        toko: namaToko.get(x.storeId) ?? x.storeId,
        jumlah: x.jumlah,
        gaji: x.gaji,
        diterapkan: true,
        dibawa: 0,
      }));
      const lain = lainDibayar.get(refId) ?? { retur: 0, utang: 0, kembali: 0 };
      return {
        ...tampil,
        potonganRetur: lain.retur,
        potonganUtang: lain.utang,
        komisiLama: null,
        koreksi: k,
        diterima: dibayarkanTersimpan({
          total: r.total,
          potonganHilang: r.potonganHilang,
          potonganRetur: lain.retur,
          potonganUtang: lain.utang,
          kembali: lain.kembali,
          koreksi: k.reduce((n, x) => n + x.jumlah, 0),
        }),
        ditahan: null,
        hariTahan: [],
      };
    }
    const p = rencana.get(refId);
    const unit = unitPer.get(kunciLaporan);
    if (!p || p.ditahan) {
      // Belum boleh dibayar (siklus dibuka lagi, toko putus belum dicek) atau ditahan: tanpa rupiah.
      return {
        ...tampil,
        komisiLama: null,
        koreksi: [],
        diterima: 0,
        ditahan: p?.ditahan ?? unit?.ditahan ?? null,
        hariTahan: p?.hariTahan ?? unit?.hariTahan ?? [],
      };
    }
    return {
      ...tampil,
      gaji: p.gajiPokok,
      rincianGaji: p.gaji,
      komisi: p.komisiBaru,
      komisiLama: p.berubah && !samaSen(p.komisiLama, p.komisiBaru) ? p.komisiLama : null,
      total: p.gajiPokok + p.komisiBaru,
      potonganHilang: p.potonganHilang,
      potonganRetur: p.potonganRetur,
      potonganUtang: p.potonganUtang,
      dariKomisi: p.dariKomisi,
      dariGaji: p.dariGaji,
      potong: r.jenis === "PUTUS" ? p.potongBaru : null,
      koreksi: p.koreksi
        .filter((x) => !samaSen(x.diterapkan, 0) || !samaSen(x.dibawa, 0))
        .map((x) => ({ bulanJual: x.bulanJual, toko: x.namaToko, jumlah: x.diterapkan, gaji: x.gajiDiterapkan, diterapkan: false, dibawa: x.dibawa })),
      diterima: p.dibayar,
      ditahan: null,
      hariTahan: [],
    };
  });

  // Koreksi yang menunggu dan tidak tampil sebagai pratinjau di pembayaran mana pun di daftar.
  const sasaran = barisSasaranKoreksi(units);
  const sasaranTampil = sasaran !== null && dasar.some((r) => r.refId === sasaran.baris.refId);
  const koreksiMenunggu = sasaranTampil ? [] : selisihMenunggu(units).map((k) => ({ bulanJual: k.bulanJual, toko: k.namaToko, jumlah: k.selisih }));
  return { resmi, koreksiMenunggu };
}

/** Pembayaran resmi SPG ini — konsinyasi dan toko putus — terbaru dulu menurut bulan pembayarannya. */
export async function komisiResmiSaya(userId: string, batas = 6): Promise<KomisiResmiHp[]> {
  return (await ringkasGajiSaya(userId, batas)).resmi;
}

// ---------------------------------------------------------------------------
// Kantor
// ---------------------------------------------------------------------------

/** Sebab sebuah baris menunggu (P60) dan harinya — tanpa rupiah. */
export type TahanKantor = { alasan: AlasanTahanBayar; hari: string[] } | null;

export type BarisKomisiKantor = KomisiPerSpg & {
  /** Peserta gaji toko × bulan itu (B19): mendapat baris saat "Tetapkan" walau komisinya nol. */
  peserta: boolean;
  status: StatusKomisi;
  resmi: {
    id: string;
    unitsSold: number;
    commission: number;
    baseSalary: number;
    /** Beban barang hilang yang dipotong saat dibayar. */
    deduction: number;
    lockedAt: string;
    paidAt: string | null;
    note: string | null;
  } | null;
  /** Gaji pokok yang tersimpan pada baris ini, atau rinciannya sekarang kalau belum dibayar. */
  gaji: RincianGaji | null;
  tahan: TahanKantor;
  /** Hari check-in di luar radius (P70) — hanya tanda. */
  luarRadius: string[];
  /** Sisa beban barang hilang SPG ini yang belum terpotong (rupiah) — 0 kalau tidak ada. */
  bebanHilangSisa: number;
  /** Rencana membayar baris yang belum dibayar: gaji, komisi, koreksi, pengurang, yang dibayarkan. */
  bayar: RencanaBayarKomisi | null;
  /** Koreksi yang diterapkan pada baris yang sudah dibayar. */
  koreksiDiterapkan: KoreksiDiterapkanKantor[];
  /** Yang dibayarkan baris yang sudah dibayar; null kalau belum dibayar. */
  dibayarkan: number | null;
};

export type KoreksiDiterapkanKantor = { bulanJual: string; toko: string; jumlah: number; gaji: number };

/** Satu toko putus × bulan penjualan yang dibayar di bulan pembayaran yang dibuka. */
export type LaporanPutusKantor = {
  storeId: string;
  nama: string;
  kode: string;
  aktif: boolean;
  bulanJual: string;
  dicek: { pada: string; oleh: string | null } | null;
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  baris: BarisKomisiKantor[];
  /**
   * Orang yang akan mendapat baris saat "Tetapkan": peserta gaji ∪ penjual (`rencanaTetapkan`).
   * Nol = penulisnya menolak `TANPA_PESERTA`; tombolnya memakai angka yang sama.
   */
  jumlahIkut: number;
  adaResmi: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  /** Hitungan sekarang (komisi, peserta, gaji) tidak sama dengan yang sudah ditetapkan. */
  berbeda: boolean;
  /** Retur pembeli atas nota bulan itu yang masih menunggu persetujuan kantor. */
  returMenunggu: number;
};

/** Satu siklus konsinyasi yang angkanya dikunci di bulan pembayaran yang dibuka. */
export type LaporanKonsiKantor = {
  cycleId: string;
  noKonsi: string;
  storeId: string;
  nama: string;
  kode: string;
  bulanJual: string;
  dikunciPada: string;
  totalHitung: number;
  totalTersimpan: number;
  potongTanpaTarif: number;
  baris: {
    id: string;
    userId: string;
    nama: string;
    gajiPokok: number;
    gaji: RincianGaji | null;
    tahan: TahanKantor;
    luarRadius: string[];
    komisi: number;
    komisiHitung: number;
    total: number;
    potonganHilang: number;
    dibayarPada: string | null;
    bayar: RencanaBayarKomisi | null;
    koreksiDiterapkan: KoreksiDiterapkanKantor[];
    dibayarkan: number | null;
  }[];
  berbeda: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  returMenunggu: number;
};

/** Toko putus × bulan penjualan yang sudah selesai, berpenjualan SPG atau berpeserta gaji, dan belum dicek. */
export type MenungguCekKantor = {
  storeId: string;
  nama: string;
  kode: string;
  bulanJual: string;
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  jumlahPenerima: number;
  jumlahPeserta: number;
  returMenunggu: number;
  /** Potong yang terjual tanpa kategori barang, per barang — komisinya menyusul (P69), tidak menolak. */
  tanpaKategori: { itemId: string; nama: string; potong: number }[];
};

/**
 * Toko konsinyasi × bulan penjualan yang sudah selesai dan punya peserta gaji (penjual, jadwal,
 * catatan check-in, atau masa tugas), angkanya belum dikunci — TERMASUK bulan yang siklusnya belum
 * dibuka sama sekali (`cycleId` null): tanpa siklus tidak ada baris gaji, jadi gaji pokoknya tidak
 * pernah terbayar kalau bulan itu tidak muncul di sini.
 */
export type KonsiMenungguKunciKantor = { storeId: string; nama: string; kode: string; bulanJual: string; cycleId: string | null; noKonsi: string | null };

export type DaftarKomisiKantor = {
  /** Bulan PEMBAYARAN yang dibuka. */
  bulan: string;
  bulanIni: string;
  putus: LaporanPutusKantor[];
  konsi: LaporanKonsiKantor[];
  menungguCek: MenungguCekKantor[];
  konsiMenungguKunci: KonsiMenungguKunciKantor[];
  /** Belum dibayar dari bulan pembayaran sebelumnya dan BISA dibayar — tepat yang dihitung Beranda. */
  tunggakan: TunggakanKantor[];
  /** Seperti `tunggakan`, tetapi menunggu dasar gajinya (P60): tidak bisa dibayar, dengan sebabnya. */
  tunggakanDitahan: TunggakanKantor[];
  /** Koreksi yang menunggu pembayaran berikutnya, per SPG, dengan baris tempat ia akan ikut. */
  koreksiMenunggu: { userId: string; nama: string; baris: BarisKoreksi[]; sasaran: { bulanJual: string; namaToko: string } | null }[];
  ringkas: {
    totalDitetapkan: number;
    /** Yang benar-benar dibayarkan bulan pembayaran ini, termasuk koreksi. */
    totalDibayar: number;
    /** Σ koreksi yang diterapkan bulan pembayaran ini. */
    totalKoreksi: number;
    belumDitetapkan: number;
    menungguCek: number;
    /** Baris bulan pembayaran ini yang menunggu dasar gajinya (P60). */
    ditahan: number;
  };
};

export type TunggakanKantor = TunggakanKomisi & {
  bayar: RencanaBayarKomisi | null;
  gajiPokok: number;
  komisiTersimpan: number;
  /** Retur pembeli toko × bulan penjualan itu yang masih menunggu persetujuan — peringatan di dialog bayarnya. */
  returMenunggu: number;
};

/** Bulan-bulan selesai yang diperiksa untuk antrean dicek, terbaru dulu. */
function bulanSelesaiTerakhir(bulanIni: string, n: number): string[] {
  const hasil: string[] = [];
  let m = bulanIni;
  for (let i = 0; i < n; i++) {
    m = bulanSebelum(m);
    hasil.push(m);
  }
  return hasil;
}

/**
 * Toko × bulan penjualan yang sudah selesai dan punya nota SPG ATAU peserta gaji (jadwal bulan itu,
 * catatan check-in, atau SPG yang bertugas di sana), per jenis toko. Toko konsinyasi: bulan sebelum
 * siklus pertama tidak ikut (P59, `lantaiBulanKonsi`) — bulan itu di luar sistem dan tidak pernah
 * bisa dikunci, jadi tidak pernah menjadi antrean "menunggu kunci".
 */
async function tokoBerjualan(db: Klien, bulan: readonly string[]): Promise<{ storeId: string; periode: string; termsType: "PUTUS" | "KONSI" }[]> {
  const per = await Promise.all(
    bulan.map(async (periode) => {
      const { start, end } = wibMonthRange(periode);
      const [jual, jadwal, catatan] = await Promise.all([
        db.spgSale.findMany({ where: { createdAt: { gte: start, lt: end }, lines: { some: {} } }, distinct: ["storeId"], select: { storeId: true } }),
        db.spgMonthSchedule.findMany({ where: { month: periode }, distinct: ["storeId"], select: { storeId: true } }),
        db.spgAttendanceRecord.findMany({ where: { month: periode }, distinct: ["storeId"], select: { storeId: true } }),
      ]);
      return [...new Set([...jual, ...jadwal, ...catatan].map((r) => r.storeId))].map((storeId) => ({ storeId, periode }));
    }),
  );
  const pasangan = per.flat();
  // Toko yang punya SPG bertugas (tanggal mulai diisi) — pesertanya dihitung `muatPesertaGaji`.
  const bertugas = await db.user.findMany({
    where: { spgStartedOn: { not: null }, OR: [{ assignedStoreId: { not: null } }, { spgEndedStoreId: { not: null } }] },
    select: { assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true },
  });
  for (const u of bertugas) {
    const storeId = u.assignedStoreId ?? u.spgEndedStoreId;
    if (!storeId || !u.spgStartedOn) continue;
    for (const periode of bulan) {
      if (u.spgStartedOn.slice(0, 7) > periode) continue;
      if (u.spgEndedOn && u.spgEndedOn.slice(0, 7) < periode) continue;
      pasangan.push({ storeId, periode });
    }
  }
  const unik = [...new Map(pasangan.map((p) => [kunciPasangan(p.storeId, p.periode), p])).values()];
  if (unik.length === 0) return [];
  const [toko, lantaiKonsi] = await Promise.all([
    db.store.findMany({ where: { id: { in: [...new Set(unik.map((p) => p.storeId))] } }, select: { id: true, termsType: true } }),
    lantaiBulanKonsi(db, "KONSI"),
  ]);
  const syarat = new Map(toko.map((t) => [t.id, t.termsType]));
  return unik.flatMap((p) => {
    const t = syarat.get(p.storeId);
    if (t === "KONSI" && lantaiKonsi && sebelumSiklusPertama(p.periode, lantaiKonsi)) return [];
    return t === "PUTUS" || t === "KONSI" ? [{ ...p, termsType: t }] : [];
  });
}

/**
 * Toko putus × bulan penjualan yang masih perlu ditindaklanjuti kantor: belum ada yang dibayar, dan
 * belum dicek — atau sudah dicek tapi belum ditetapkan. Hanya bulan yang PERLU dicek
 * (`laporanPerluDicek`: mengonfirmasi potong ATAU punya peserta gaji) — satu definisi dengan
 * "Tandai laporan dicek" dan Beranda. Laporannya (bertanggal `sekarang`) dan pesertanya ikut
 * dikembalikan supaya halaman tidak membacanya dua kali.
 */
async function pasanganPutusTertunda(db: Klien, bulan: readonly string[], sekarang: Date, sudahDibaca?: Awaited<ReturnType<typeof tokoBerjualan>>) {
  const berjualan = (sudahDibaca ?? (await tokoBerjualan(db, bulan))).filter((p) => p.termsType === "PUTUS");
  if (berjualan.length === 0) return [];
  const [cek, resmi] = await Promise.all([
    db.spgSalesCheck.findMany({ where: { period: { in: [...bulan] } }, select: { storeId: true, period: true } }),
    db.spgCommission.findMany({ where: { period: { in: [...bulan] } }, select: { storeId: true, period: true, paidAt: true } }),
  ]);
  const dicek = new Set(cek.map((c) => kunciPasangan(c.storeId, c.period)));
  const dibayar = new Set(resmi.filter((r) => r.paidAt !== null).map((r) => kunciPasangan(r.storeId, r.period)));
  const ditetapkan = new Set(resmi.map((r) => kunciPasangan(r.storeId, r.period)));
  const calon = berjualan
    .filter((p) => !dibayar.has(kunciPasangan(p.storeId, p.periode)))
    .map((p) => {
      const k = kunciPasangan(p.storeId, p.periode);
      return { storeId: p.storeId, periode: p.periode, dicek: dicek.has(k), ditetapkan: ditetapkan.has(k) };
    })
    .filter((p) => !p.dicek || !p.ditetapkan);
  const [laporan, peserta] = await Promise.all([
    putusReportsOf(
      db,
      calon.map((p) => ({ storeId: p.storeId, salesMonth: p.periode, checkedAt: sekarang })),
    ),
    muatPesertaGaji(
      db,
      calon.map((p) => ({ storeId: p.storeId, bulan: p.periode })),
    ),
  ]);
  return calon
    .map((p, i) => ({ ...p, laporan: laporan[i], peserta: peserta.get(kunciTokoBulan(p.storeId, p.periode)) ?? [] }))
    .filter((p) => laporanPerluDicek(p.laporan, p.peserta));
}

const tahanDari = (g: HasilGaji | null | undefined): TahanKantor => (g && !g.ok ? { alasan: g.alasan, hari: g.hari } : null);
const rincianDari = (g: HasilGaji | null | undefined): RincianGaji | null => (g && g.ok ? g.rincian : null);

/**
 * Gaji & komisi SPG satu BULAN PEMBAYARAN untuk kantor: setiap toko putus × bulan penjualan yang
 * dicek di bulan itu dan setiap siklus konsinyasi yang angkanya dikunci di bulan itu, plus antrean
 * yang menunggu dicek / dikunci, tunggakan, dan koreksi yang menunggu.
 */
export async function daftarKomisiKantor(bulan: string, sekarang: Date): Promise<DaftarKomisiKantor> {
  const bulanIni = bulanWib(sekarang);
  const rentang = wibMonthRange(bulan);
  const bulanAntrean = bulanSelesaiTerakhir(bulanIni, BULAN_MENUNGGU_CEK);

  const [laporanPutus, konsiDikunci, rates, berjualan] = await Promise.all([
    putusPayoutReports(prisma, { paidIn: rentang }),
    lockedKonsiReports(prisma, { lockedIn: rentang }),
    commissionRates(prisma),
    tokoBerjualan(prisma, bulanAntrean),
  ]);
  const tertunda = await pasanganPutusTertunda(prisma, bulanAntrean, sekarang, berjualan);

  const resmi = laporanPutus.flatMap((l) => l.stored);
  // Peserta gaji setiap laporan putus (B19): ikut tampil walau tidak menjual dan tidak lagi bertugas,
  // karena "Tetapkan" menulis baris untuk mereka.
  const pesertaPutus = await muatPesertaGaji(
    prisma,
    laporanPutus.map((l) => ({ storeId: l.storeId, bulan: l.salesMonth })),
  );
  const pemegang = new Map(
    laporanPutus.map((l) => [l.key, [...l.stored.map((r) => r.userId), ...(pesertaPutus.get(kunciTokoBulan(l.storeId, l.salesMonth)) ?? [])]]),
  );
  const tertundaBelumDicek = tertunda.filter((p) => !p.dicek);
  const laporanTertunda: SalesReport[] = tertundaBelumDicek.map((p) => p.laporan);

  const gajiKonsi = konsiDikunci.length
    ? await prisma.consignmentCommission.findMany({
        where: { cycleId: { in: konsiDikunci.map((k) => k.cycleId) } },
        select: {
          id: true,
          cycleId: true,
          spgUserId: true,
          baseSalary: true,
          commission: true,
          total: true,
          deduction: true,
          salaryDetail: true,
          paidAt: true,
          spgUser: { select: { name: true, email: true } },
        },
      })
    : [];
  const pemegangKonsi = new Map(konsiDikunci.map((l) => [l.key, gajiKonsi.filter((g) => g.cycleId === l.cycleId).map((g) => g.spgUserId)]));

  const [hasilPutus, hasilKonsi, hasilTertunda] = await Promise.all([
    susunLaporan(prisma, laporanPutus, rates, pemegang),
    susunLaporan(prisma, konsiDikunci, rates, pemegangKonsi),
    susunLaporan(prisma, laporanTertunda, rates),
  ]);

  // Konsinyasi yang belum dikunci: setiap toko konsi × bulan berpeserta, termasuk yang siklusnya belum dibuka.
  const konsiTertunda = berjualan.filter((p) => p.termsType === "KONSI");
  const [siklusTertunda, pesertaKonsi] = await Promise.all([
    konsiTertunda.length
      ? prisma.consignmentCycle.findMany({
          where: { OR: konsiTertunda.map((p) => ({ storeId: p.storeId, periodYear: Number(p.periode.slice(0, 4)), periodMonth: Number(p.periode.slice(5, 7)) })) },
          select: { id: true, noKonsi: true, storeId: true, periodYear: true, periodMonth: true, lockedAt: true },
        })
      : Promise.resolve([]),
    muatPesertaGaji(
      prisma,
      konsiTertunda.map((p) => ({ storeId: p.storeId, bulan: p.periode })),
    ),
  ]);
  const siklusPer = new Map(siklusTertunda.map((s) => [kunciPasangan(s.storeId, `${s.periodYear}-${String(s.periodMonth).padStart(2, "0")}`), s]));
  const konsiBelumKunci = konsiTertunda.filter(
    (p) => !siklusPer.get(kunciPasangan(p.storeId, p.periode))?.lockedAt && (pesertaKonsi.get(kunciTokoBulan(p.storeId, p.periode)) ?? []).length > 0,
  );

  const idToko = [
    ...new Set([
      ...laporanPutus.map((l) => l.storeId),
      ...konsiDikunci.map((l) => l.storeId),
      ...tertundaBelumDicek.map((p) => p.storeId),
      ...konsiBelumKunci.map((p) => p.storeId),
    ]),
  ];
  const tokoSemua = idToko.length ? await prisma.store.findMany({ where: { id: { in: idToko } }, select: { id: true, name: true, code: true, isActive: true } }) : [];
  const toko = new Map(tokoSemua.map((t) => [t.id, t]));
  const namaToko = (id: string) => toko.get(id)?.name ?? id;

  const pemeriksa = [...new Set(laporanPutus.flatMap((l) => (l.check ? [l.check.checkedById] : [])))];
  const orangCek = pemeriksa.length ? await prisma.user.findMany({ where: { id: { in: pemeriksa } }, select: { id: true, name: true, email: true } }) : [];
  const namaPemeriksa = new Map(orangCek.map((u) => [u.id, namaOrang(u)]));

  const bebanHilang = await sisaBebanHilangPerOrang(
    prisma,
    [...hasilPutus.values(), ...hasilKonsi.values()].flatMap((h) => h.perSpg.map((p) => p.userId)),
  );

  const [tunggakanSemua, pemegangKoreksi, koreksiBulan] = await Promise.all([
    daftarTunggakanKomisi(prisma, sekarang),
    pemegangKomisiSpg(prisma, sekarang),
    koreksiBulanBayar(prisma, bulan),
  ]);
  const idOrang = [
    ...new Set([
      ...resmi.map((r) => r.userId),
      ...gajiKonsi.map((g) => g.spgUserId),
      ...[...hasilPutus.values(), ...hasilKonsi.values()].flatMap((h) => h.perSpg.filter((p) => p.penerima).map((p) => p.userId)),
      ...tunggakanSemua.map((t) => t.spgUserId),
      ...pemegangKoreksi,
    ]),
  ];
  const [petaUnit, returMenunggu] = await Promise.all([
    unitKomisiSpg(prisma, idOrang, sekarang),
    returMenungguPerLaporan(prisma, [
      ...laporanPutus.map((l) => ({ storeId: l.storeId, bulanJual: l.salesMonth })),
      ...konsiDikunci.map((l) => ({ storeId: l.storeId, bulanJual: l.salesMonth })),
      ...tertundaBelumDicek.map((p) => ({ storeId: p.storeId, bulanJual: p.periode })),
      ...tunggakanSemua.map((t) => ({ storeId: t.storeId, bulanJual: t.bulanJual })),
    ]),
  ]);
  const konteks = await konteksBayarSpg(prisma, petaUnit);
  const rencana = new Map<string, RencanaBayarKomisi>();
  for (const [userId, units] of petaUnit) for (const [id, r] of rencanaBayarSemua(units, konteks.get(userId))) rencana.set(id, r);
  const unitPerRef = new Map<string, UnitKomisiSpg>();
  for (const units of petaUnit.values()) for (const u of units) if (u.baris) unitPerRef.set(u.baris.refId, u);

  // Callback bertipe: tanpa itu `refType` melebar ke string di dalam spread (TS2345).
  const refDibayar: RefPembayaranKomisi[] = [
    ...resmi.filter((r) => r.paidAt !== null).map((r): RefPembayaranKomisi => ({ refType: REF_KOMISI_SPG_PUTUS, refId: r.id })),
    ...gajiKonsi.filter((g) => g.paidAt !== null).map((g): RefPembayaranKomisi => ({ refType: REF_KOMISI_KONSI, refId: g.id })),
  ];
  const [terapan, lainDibayar] = await Promise.all([koreksiPadaPembayaran(prisma, refDibayar), potonganLainPadaPembayaran(prisma, refDibayar)]);
  const namaTokoUnit = new Map<string, string>();
  for (const units of petaUnit.values()) for (const u of units) namaTokoUnit.set(u.storeId, u.namaToko);
  const tampilTerapan = (id: string): KoreksiDiterapkanKantor[] =>
    (terapan.get(id) ?? []).map((k) => ({ bulanJual: k.bulanJual, toko: namaTokoUnit.get(k.storeId) ?? namaToko(k.storeId), jumlah: k.jumlah, gaji: k.gaji }));
  const jumlahTerapan = (id: string) => (terapan.get(id) ?? []).reduce((n, k) => n + k.jumlah, 0);
  const sen2 = (n: number) => Math.round(n * 100) / 100;
  /** Yang benar-benar dibayarkan baris yang sudah dibayar — urutan rencana bayarnya (`dibayarkanTersimpan`). */
  const dibayarkanBaris = (id: string, total: number, potonganHilang: number) => {
    const lain = lainDibayar.get(id) ?? { retur: 0, utang: 0, kembali: 0 };
    return dibayarkanTersimpan({ total, potonganHilang, potonganRetur: lain.retur, potonganUtang: lain.utang, kembali: lain.kembali, koreksi: jumlahTerapan(id) });
  };
  const kunciRetur = (storeId: string, bulanJual: string) => `${storeId}\u0000${bulanJual}`;
  const gajiBaris = (refId: string, tersimpan: unknown, dibayar: boolean): { gaji: RincianGaji | null; tahan: TahanKantor; luarRadius: string[] } => {
    const u = unitPerRef.get(refId);
    const g = dibayar ? null : (u?.gaji ?? null);
    const rincian = dibayar ? (bacaDetailGaji(tersimpan)?.jenis === "RINCIAN" ? (bacaDetailGaji(tersimpan) as { rincian: RincianGaji }).rincian : null) : rincianDari(g);
    return { gaji: rincian, tahan: dibayar ? null : tahanDari(g), luarRadius: rincian?.tanggalLuarRadius ?? [] };
  };

  // Gaji sekarang setiap peserta laporan, untuk "berbeda" dan pratinjau baris yang belum ditetapkan.
  const gajiSekarang = await muatGajiPokok(prisma, [
    ...laporanPutus.flatMap((l) => (pesertaPutus.get(kunciTokoBulan(l.storeId, l.salesMonth)) ?? []).map((userId) => ({ userId, storeId: l.storeId, bulan: l.salesMonth }))),
  ]);

  const putus: LaporanPutusKantor[] = laporanPutus.map((l) => {
    const hasil = hasilPutus.get(l.key)!;
    const rows = l.stored;
    const perUser = new Map(rows.map((r) => [r.userId, r]));
    const cek = l.check;
    const t = toko.get(l.storeId);
    const peserta = pesertaPutus.get(kunciTokoBulan(l.storeId, l.salesMonth)) ?? [];
    const idPeserta = new Set(peserta);
    const gajiPer = new Map<string, HasilGaji | null>(peserta.map((u) => [u, gajiSekarang.get(kunciGaji(u, l.salesMonth)) ?? null]));
    const ikut = new Set([...peserta, ...hasil.perSpg.filter((p) => p.penerima).map((p) => p.userId)]);
    return {
      storeId: l.storeId,
      nama: t?.name ?? l.storeId,
      kode: t?.code ?? "",
      aktif: t?.isActive ?? true,
      bulanJual: l.salesMonth,
      dicek: cek ? { pada: cek.checkedAt.toISOString(), oleh: namaPemeriksa.get(cek.checkedById) ?? null } : null,
      potongToko: hasil.potongToko,
      totalToko: hasil.totalToko,
      potongTanpaTarif: hasil.potongTanpaTarif,
      baris: hasil.perSpg.map((p) => {
        const r = perUser.get(p.userId);
        // Belum ditetapkan: pratinjau gaji pokok peserta menurut dasar sekarang (sama dengan yang ditulis "Tetapkan").
        const sekarangG = idPeserta.has(p.userId) ? (gajiPer.get(p.userId) ?? null) : null;
        const g = r
          ? gajiBaris(r.id, null, r.paidAt !== null)
          : { gaji: rincianDari(sekarangG), tahan: tahanDari(sekarangG), luarRadius: rincianDari(sekarangG)?.tanggalLuarRadius ?? [] };
        return {
          ...p,
          peserta: idPeserta.has(p.userId),
          status: statusResmi(r ?? null),
          resmi: r
            ? {
                id: r.id,
                unitsSold: r.unitsSold,
                commission: angka(r.commission),
                baseSalary: angka(r.baseSalary),
                deduction: angka(r.deduction),
                lockedAt: r.lockedAt.toISOString(),
                paidAt: r.paidAt ? r.paidAt.toISOString() : null,
                note: r.note,
              }
            : null,
          ...g,
          bebanHilangSisa: bebanHilang.get(p.userId) ?? 0,
          bayar: r && r.paidAt === null ? (rencana.get(r.id) ?? null) : null,
          koreksiDiterapkan: r && r.paidAt !== null ? tampilTerapan(r.id) : [],
          dibayarkan: r && r.paidAt !== null ? dibayarkanBaris(r.id, angka(r.commission) + angka(r.baseSalary), angka(r.deduction)) : null,
        };
      }),
      jumlahIkut: ikut.size,
      adaResmi: rows.length > 0,
      adaDibayar: rows.some((r) => r.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((r) => r.paidAt !== null),
      berbeda: sudahBerbeda(hasil, rows.map(keBarisResmi), peserta, gajiPer),
      returMenunggu: returMenunggu.get(kunciRetur(l.storeId, l.salesMonth)) ?? 0,
    };
  });
  putus.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const konsi: LaporanKonsiKantor[] = konsiDikunci.map((l) => {
    const hasil = hasilKonsi.get(l.key)!;
    const rows = gajiKonsi.filter((g) => g.cycleId === l.cycleId);
    const t = toko.get(l.storeId);
    const hitungPer = new Map(hasil.perSpg.map((p) => [p.userId, p.komisi]));
    const tersimpanPer = new Map(rows.map((g) => [g.spgUserId, angka(g.commission)]));
    const semuaOrang = new Set([...tersimpanPer.keys(), ...hasil.perSpg.filter((p) => p.komisi > 0).map((p) => p.userId)]);
    const berbeda = [...semuaOrang].some((id) => Math.round((hitungPer.get(id) ?? 0) * 100) !== Math.round((tersimpanPer.get(id) ?? 0) * 100));
    return {
      cycleId: l.cycleId,
      noKonsi: l.noKonsi,
      storeId: l.storeId,
      nama: t?.name ?? l.storeId,
      kode: t?.code ?? "",
      bulanJual: l.salesMonth,
      dikunciPada: l.checkedAt.toISOString(),
      totalHitung: hasil.totalToko,
      totalTersimpan: rows.reduce((n, g) => n + angka(g.commission), 0),
      potongTanpaTarif: hasil.potongTanpaTarif,
      baris: rows
        .map((g) => ({
          id: g.id,
          userId: g.spgUserId,
          nama: g.spgUser ? namaOrang(g.spgUser) : g.spgUserId,
          gajiPokok: angka(g.baseSalary),
          ...gajiBaris(g.id, g.salaryDetail, g.paidAt !== null),
          komisi: angka(g.commission),
          komisiHitung: hitungPer.get(g.spgUserId) ?? 0,
          total: angka(g.total),
          potonganHilang: angka(g.deduction),
          dibayarPada: g.paidAt ? g.paidAt.toISOString() : null,
          bayar: g.paidAt === null ? (rencana.get(g.id) ?? null) : null,
          koreksiDiterapkan: g.paidAt !== null ? tampilTerapan(g.id) : [],
          dibayarkan: g.paidAt !== null ? dibayarkanBaris(g.id, angka(g.total), angka(g.deduction)) : null,
        }))
        .sort((a, b) => a.nama.localeCompare(b.nama)),
      berbeda,
      adaDibayar: rows.some((g) => g.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((g) => g.paidAt !== null),
      returMenunggu: returMenunggu.get(kunciRetur(l.storeId, l.salesMonth)) ?? 0,
    };
  });
  konsi.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const tanpaKategoriPer = new Map(laporanTertunda.map((l) => [l.key, potongTanpaKategori(l)]));
  const idTanpaKategori = [...new Set([...tanpaKategoriPer.values()].flat().map((x) => x.itemId))];
  const namaBarang = new Map(
    (idTanpaKategori.length ? await prisma.item.findMany({ where: { id: { in: idTanpaKategori } }, select: { id: true, nameId: true, sku: true } }) : []).map((i) => [
      i.id,
      i.nameId?.trim() || i.sku,
    ]),
  );
  const menungguCek: MenungguCekKantor[] = laporanTertunda
    .map((l) => {
      const hasil = hasilTertunda.get(l.key)!;
      const p = tertundaBelumDicek.find((x) => x.storeId === l.storeId && x.periode === l.salesMonth)!;
      const t = toko.get(l.storeId);
      return {
        storeId: l.storeId,
        nama: t?.name ?? l.storeId,
        kode: t?.code ?? "",
        bulanJual: l.salesMonth,
        potongToko: hasil.potongToko,
        totalToko: hasil.totalToko,
        potongTanpaTarif: hasil.potongTanpaTarif,
        jumlahPenerima: hasil.perSpg.filter((x) => x.penerima).length,
        jumlahPeserta: p.peserta.length,
        returMenunggu: returMenunggu.get(kunciRetur(l.storeId, l.salesMonth)) ?? 0,
        tanpaKategori: (tanpaKategoriPer.get(l.key) ?? []).map((x) => ({ itemId: x.itemId, nama: namaBarang.get(x.itemId) ?? x.itemId, potong: x.potong })),
      };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const konsiMenungguKunci: KonsiMenungguKunciKantor[] = konsiBelumKunci
    .map((p) => {
      const s = siklusPer.get(kunciPasangan(p.storeId, p.periode)) ?? null;
      return { storeId: p.storeId, nama: namaToko(p.storeId), kode: toko.get(p.storeId)?.code ?? "", bulanJual: p.periode, cycleId: s?.id ?? null, noKonsi: s?.noKonsi ?? null };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  // Koreksi yang menunggu, per SPG (nama dibaca sekali).
  const perluNama = [...petaUnit].filter(([, units]) => selisihMenunggu(units).length > 0).map(([id]) => id);
  const orangKoreksi = perluNama.length ? await prisma.user.findMany({ where: { id: { in: perluNama } }, select: { id: true, name: true, email: true } }) : [];
  const namaPer = new Map(orangKoreksi.map((u) => [u.id, namaOrang(u)]));
  const koreksiMenunggu: DaftarKomisiKantor["koreksiMenunggu"] = [];
  for (const [userId, units] of petaUnit) {
    const tunggu = selisihMenunggu(units);
    if (tunggu.length === 0) continue;
    const sasaran = barisSasaranKoreksi(units);
    koreksiMenunggu.push({
      userId,
      nama: namaPer.get(userId) ?? userId,
      baris: tunggu,
      sasaran: sasaran ? { bulanJual: sasaran.unit.bulanJual, namaToko: sasaran.unit.namaToko } : null,
    });
  }
  koreksiMenunggu.sort((a, b) => a.nama.localeCompare(b.nama));

  const keTunggakan = (t: TunggakanKomisi): TunggakanKantor => ({
    ...t,
    bayar: rencana.get(t.refId) ?? null,
    gajiPokok: unitPerRef.get(t.refId)?.baris?.gajiPokok ?? 0,
    komisiTersimpan: unitPerRef.get(t.refId)?.baris?.komisiTersimpan ?? 0,
    returMenunggu: returMenunggu.get(kunciRetur(t.storeId, t.bulanJual)) ?? 0,
  });

  const dibayarkanBulan = [...putus.flatMap((l) => l.baris.map((b) => b.dibayarkan ?? 0)), ...konsi.flatMap((k) => k.baris.map((b) => b.dibayarkan ?? 0))];
  const jumlahDitahan = [...putus.flatMap((l) => l.baris), ...konsi.flatMap((k) => k.baris)].filter((b) => b.tahan !== null).length;
  return {
    bulan,
    bulanIni,
    putus,
    konsi,
    menungguCek,
    konsiMenungguKunci,
    tunggakan: tunggakanSemua.filter((t) => t.ditahan === null).map(keTunggakan),
    tunggakanDitahan: tunggakanSemua.filter((t) => t.ditahan !== null).map(keTunggakan),
    koreksiMenunggu,
    ringkas: {
      totalDitetapkan: resmi.reduce((n, r) => n + angka(r.commission) + angka(r.baseSalary), 0) + gajiKonsi.reduce((n, g) => n + angka(g.total), 0),
      // Uang yang benar-benar keluar: dikurangi pengurang, ditambah koreksi.
      totalDibayar: sen2(dibayarkanBulan.reduce((n, x) => n + x, 0)),
      totalKoreksi: sen2(koreksiBulan.reduce((n, k) => n + k.jumlah, 0)),
      belumDitetapkan: putus.filter((p) => p.dicek !== null && !p.adaResmi).length,
      menungguCek: menungguCek.length + konsiMenungguKunci.length,
      ditahan: jumlahDitahan,
    },
  };
}

// ---------------------------------------------------------------------------
// Antrean Beranda
// ---------------------------------------------------------------------------

/**
 * Toko PUTUS yang gaji & komisi SPG bulan penjualan `periode`-nya masih perlu ditindaklanjuti: laporan
 * yang PERLU dicek (mengonfirmasi potong ATAU berpeserta gaji), belum ada yang dibayar, dan belum
 * dicek atau sudah dicek tapi belum ditetapkan. Definisi yang sama dengan antrean di Komisi SPG.
 */
export async function tokoKomisiPutusBelumDitetapkan(periode: string, db: Klien = prisma, sekarang = new Date()): Promise<string[]> {
  return [...new Set((await pasanganPutusTertunda(db, [periode], sekarang)).map((p) => p.storeId))];
}

/** Angka baris Beranda "gaji & komisi SPG toko putus bulan lalu belum ditetapkan". */
export async function jumlahKomisiPutusBelumDitetapkan(sekarang = new Date()): Promise<number> {
  return (await tokoKomisiPutusBelumDitetapkan(bulanSebelum(bulanWib(sekarang)))).length;
}
