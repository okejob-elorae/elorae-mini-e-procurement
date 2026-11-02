import { prisma, type Prisma } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import type { CommissionRate } from "@/lib/spg-commission/compute";
import {
  checkedPutusReports,
  commissionRates,
  lockedKonsiReports,
  putusReportOf,
  spgSaleMovements,
  wibMonthRange,
} from "@/lib/spg-commission/laporan-queries";
import { commissionPerSpg, payoutMonth, type SalesReport } from "@/lib/spg-commission/payout";
import type { DasarKomisi } from "./pengaturan";
import { sisaBebanHilangPerOrang } from "./hilang-db";
import {
  aturanLama,
  bacaDasarResmi,
  bulanSebelum,
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

export const keBarisResmi = (r: { id: string; userId: string; unitsSold: number; commission: unknown; basis: string; paidAt: Date | null }): BarisResmiAda => ({
  id: r.id,
  userId: r.userId,
  unitsSold: r.unitsSold,
  commission: angka(r.commission),
  basis: r.basis,
  paidAt: r.paidAt,
});

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
 * `dasar` selalu `PER_SPG`: setiap SPG dibayar dari penjualannya sendiri.
 */
export type PerkiraanKomisiHp = {
  bulan: string;
  jenis: "KONSI" | "PUTUS";
  dasar: DasarKomisi;
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
 * Komisi resmi toko putus milik SPG ini saja. `bulanBayar` = bulan laporannya dicek; baris aturan
 * lama tanpa tanda dicek memakai bulan ditetapkannya.
 */
export async function komisiPutusResmiSaya(userId: string, batas = 6) {
  const rows = await prisma.spgCommission.findMany({
    where: { userId },
    orderBy: [{ period: "desc" }, { lockedAt: "desc" }],
    take: batas,
    select: { id: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, basis: true, lockedAt: true, paidAt: true },
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
    const dasar = bacaDasarResmi(r.basis);
    const waktuCek = dicek.get(kunciPasangan(r.storeId, r.period)) ?? null;
    return {
      id: r.id,
      periode: r.period,
      toko: nama.get(r.storeId) ?? "—",
      potong: r.unitsSold,
      komisi: angka(r.commission),
      /** Beban barang hilang yang dipotong saat komisi ini ditetapkan. */
      potonganHilang: angka(r.deduction),
      /** Hitungan tarif kategori dibayar dari penjualan SPG itu sendiri — dibaca sebagai `PER_SPG`. */
      dasar: (dasar === "BAGI_RATA" ? "BAGI_RATA" : "PER_SPG") as DasarKomisi,
      aturanLama: aturanLama(r.basis),
      bulanBayar: payoutMonth(waktuCek ?? r.lockedAt),
      ditetapkan: r.lockedAt.toISOString(),
      dibayar: r.paidAt ? r.paidAt.toISOString() : null,
    };
  });
}

/** Satu pembayaran resmi di HP SPG: gaji + komisi siklus konsinyasi, atau komisi toko putus. */
export type KomisiResmiHp = {
  kunci: string;
  jenis: "KONSI" | "PUTUS";
  /** Bulan penjualannya — catatan "Komisi penjualan …". */
  bulanJual: string;
  /** Bulan pembayarannya (bulan laporannya dicek); null selama kunci siklusnya dibuka lagi. */
  bulanBayar: string | null;
  toko: string;
  /** Gaji pokok — hanya konsinyasi. */
  gaji: number | null;
  komisi: number;
  total: number;
  potonganHilang: number;
  /** Potong terjual — hanya toko putus (konsinyasi tidak menyimpannya per SPG). */
  potong: number | null;
  ditetapkan: string | null;
  dibayar: string | null;
  /** Ditetapkan sebelum 2026-11-01 dengan tarif barang. */
  aturanLama: boolean;
};

/** Pembayaran resmi SPG ini — konsinyasi dan toko putus — terbaru dulu menurut bulan pembayarannya. */
export async function komisiResmiSaya(userId: string, batas = 6): Promise<KomisiResmiHp[]> {
  const [konsi, putus] = await Promise.all([
    prisma.consignmentCommission.findMany({
      where: { spgUserId: userId },
      orderBy: [{ cycle: { periodYear: "desc" } }, { cycle: { periodMonth: "desc" } }],
      take: batas,
      select: {
        cycleId: true,
        baseSalary: true,
        commission: true,
        total: true,
        deduction: true,
        paidAt: true,
        cycle: { select: { periodYear: true, periodMonth: true, lockedAt: true, store: { select: { name: true } } } },
      },
    }),
    komisiPutusResmiSaya(userId, batas),
  ]);
  const semua: KomisiResmiHp[] = [
    ...konsi.map((r) => ({
      kunci: `konsi:${r.cycleId}`,
      jenis: "KONSI" as const,
      bulanJual: `${r.cycle.periodYear}-${String(r.cycle.periodMonth).padStart(2, "0")}`,
      bulanBayar: r.cycle.lockedAt ? payoutMonth(r.cycle.lockedAt) : null,
      toko: r.cycle.store.name,
      gaji: angka(r.baseSalary),
      komisi: angka(r.commission),
      total: angka(r.total),
      potonganHilang: angka(r.deduction),
      potong: null,
      ditetapkan: r.cycle.lockedAt ? r.cycle.lockedAt.toISOString() : null,
      dibayar: r.paidAt ? r.paidAt.toISOString() : null,
      aturanLama: false,
    })),
    ...putus.map((r) => ({
      kunci: `putus:${r.id}`,
      jenis: "PUTUS" as const,
      bulanJual: r.periode,
      bulanBayar: r.bulanBayar,
      toko: r.toko,
      gaji: null,
      komisi: r.komisi,
      total: r.komisi,
      potonganHilang: r.potonganHilang,
      potong: r.potong,
      ditetapkan: r.ditetapkan,
      dibayar: r.dibayar,
      aturanLama: r.aturanLama,
    })),
  ];
  const urutBayar = (x: string | null) => x ?? "9999-99";
  return semua
    .sort((a, b) => urutBayar(b.bulanBayar).localeCompare(urutBayar(a.bulanBayar)) || b.bulanJual.localeCompare(a.bulanJual) || a.jenis.localeCompare(b.jenis))
    .slice(0, batas);
}

// ---------------------------------------------------------------------------
// Kantor
// ---------------------------------------------------------------------------

export type BarisKomisiKantor = KomisiPerSpg & {
  status: StatusKomisi;
  resmi: {
    id: string;
    unitsSold: number;
    commission: number;
    /** Beban barang hilang yang dipotong saat ditetapkan; dibayar = commission − deduction. */
    deduction: number;
    aturanLama: boolean;
    lockedAt: string;
    paidAt: string | null;
    note: string | null;
  } | null;
  /** Sisa beban barang hilang SPG ini yang belum terpotong (rupiah) — 0 kalau tidak ada. */
  bebanHilangSisa: number;
};

/** Satu toko putus × bulan penjualan yang dibayar di bulan pembayaran yang dibuka. */
export type LaporanPutusKantor = {
  storeId: string;
  nama: string;
  kode: string;
  aktif: boolean;
  bulanJual: string;
  /** Tanda dicek; null untuk komisi aturan lama yang ditetapkan tanpa tanda dicek. */
  dicek: { pada: string; oleh: string | null } | null;
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  baris: BarisKomisiKantor[];
  adaResmi: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  /** Hitungan sekarang tidak sama dengan yang sudah ditetapkan. */
  berbeda: boolean;
  aturanLama: boolean;
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
  /** Hitungan sekarang (satu hitungan dengan yang ditulis saat dikunci). */
  totalHitung: number;
  /** Komisi yang tersimpan di baris gaji siklus (yang dibayar). */
  totalTersimpan: number;
  potongTanpaTarif: number;
  baris: {
    id: string;
    userId: string;
    nama: string;
    /** Peserta bergaji pokok; false = penjual dari toko lain (komisi saja). */
    bergaji: boolean;
    gajiPokok: number;
    komisi: number;
    /** Komisi orang ini menurut hitungan sekarang. */
    komisiHitung: number;
    total: number;
    potonganHilang: number;
    dibayarPada: string | null;
  }[];
  /**
   * Hitungan sekarang tidak sama dengan yang tersimpan, per SPG: nota/pengembalian HP yang masuk
   * sesudah dikunci, atau siklus yang dikunci dengan aturan lama (tarif barang, dibagi rata).
   */
  berbeda: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
};

/** Toko putus × bulan penjualan yang sudah selesai, berpenjualan SPG, dan belum dicek. */
export type MenungguCekKantor = {
  storeId: string;
  nama: string;
  kode: string;
  bulanJual: string;
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  jumlahPenerima: number;
  /** Sudah ada komisi aturan lama yang belum dibayar — harus dicek dan ditetapkan ulang. */
  adaResmiLama: boolean;
};

/** Toko konsinyasi × bulan penjualan yang sudah selesai, berpenjualan SPG, angkanya belum dikunci. */
export type KonsiMenungguKunciKantor = { storeId: string; nama: string; kode: string; bulanJual: string; cycleId: string | null; noKonsi: string | null };

export type DaftarKomisiKantor = {
  /** Bulan PEMBAYARAN yang dibuka. */
  bulan: string;
  bulanIni: string;
  putus: LaporanPutusKantor[];
  konsi: LaporanKonsiKantor[];
  menungguCek: MenungguCekKantor[];
  konsiMenungguKunci: KonsiMenungguKunciKantor[];
  ringkas: { totalDitetapkan: number; totalDibayar: number; belumDitetapkan: number; menungguCek: number };
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
 * Toko × bulan penjualan yang sudah selesai dan punya nota SPG, per jenis toko. Satu baca per
 * bulan (`distinct` toko).
 */
async function tokoBerjualan(db: Klien, bulan: readonly string[]): Promise<{ storeId: string; periode: string; termsType: "PUTUS" | "KONSI" }[]> {
  const per = await Promise.all(
    bulan.map(async (periode) => {
      const { start, end } = wibMonthRange(periode);
      const rows = await db.spgSale.findMany({
        where: { createdAt: { gte: start, lt: end }, lines: { some: {} } },
        distinct: ["storeId"],
        select: { storeId: true, store: { select: { termsType: true } } },
      });
      return rows.map((r) => ({ storeId: r.storeId, periode, termsType: r.store.termsType }));
    }),
  );
  return per.flat();
}

/**
 * Toko putus × bulan penjualan yang masih perlu ditindaklanjuti kantor: berpenjualan SPG, belum
 * ada yang dibayar, dan belum dicek — atau sudah dicek tapi belum ditetapkan.
 */
async function pasanganPutusTertunda(
  db: Klien,
  bulan: readonly string[],
  sudahDibaca?: Awaited<ReturnType<typeof tokoBerjualan>>,
) {
  const berjualan = (sudahDibaca ?? (await tokoBerjualan(db, bulan))).filter((p) => p.termsType === "PUTUS");
  if (berjualan.length === 0) return [];
  const [cek, resmi] = await Promise.all([
    db.spgSalesCheck.findMany({ where: { period: { in: [...bulan] } }, select: { storeId: true, period: true } }),
    db.spgCommission.findMany({ where: { period: { in: [...bulan] } }, select: { storeId: true, period: true, basis: true, paidAt: true } }),
  ]);
  const dicek = new Set(cek.map((c) => kunciPasangan(c.storeId, c.period)));
  const dibayar = new Set(resmi.filter((r) => r.paidAt !== null).map((r) => kunciPasangan(r.storeId, r.period)));
  const ditetapkan = new Set(resmi.map((r) => kunciPasangan(r.storeId, r.period)));
  const lama = new Set(resmi.filter((r) => r.paidAt === null && aturanLama(r.basis)).map((r) => kunciPasangan(r.storeId, r.period)));
  return berjualan
    .filter((p) => !dibayar.has(kunciPasangan(p.storeId, p.periode)))
    .map((p) => {
      const k = kunciPasangan(p.storeId, p.periode);
      return { storeId: p.storeId, periode: p.periode, dicek: dicek.has(k), ditetapkan: ditetapkan.has(k), adaResmiLama: lama.has(k) };
    })
    .filter((p) => !p.dicek || !p.ditetapkan);
}

/**
 * Komisi SPG satu BULAN PEMBAYARAN untuk kantor: setiap toko putus × bulan penjualan yang dicek di
 * bulan itu dan setiap siklus konsinyasi yang angkanya dikunci di bulan itu, plus antrean yang
 * menunggu dicek. Komisi aturan lama (ditetapkan tanpa tanda dicek) tampil di bulan ditetapkannya.
 */
export async function daftarKomisiKantor(bulan: string, sekarang: Date): Promise<DaftarKomisiKantor> {
  const bulanIni = bulanWib(sekarang);
  const rentang = wibMonthRange(bulan);
  const bulanAntrean = bulanSelesaiTerakhir(bulanIni, BULAN_MENUNGGU_CEK);

  const [putusDicek, konsiDikunci, rates, ditetapkanBulanIni, berjualan] = await Promise.all([
    checkedPutusReports(prisma, { checkedIn: rentang }),
    lockedKonsiReports(prisma, { lockedIn: rentang }),
    commissionRates(prisma),
    prisma.spgCommission.findMany({ where: { lockedAt: { gte: rentang.start, lt: rentang.end } }, select: { storeId: true, period: true } }),
    tokoBerjualan(prisma, bulanAntrean),
  ]);
  const tertunda = await pasanganPutusTertunda(prisma, bulanAntrean, berjualan);

  // Komisi aturan lama: ditetapkan di bulan ini tanpa tanda dicek di bulan mana pun.
  const pasanganDicek = new Set(putusDicek.map((r) => kunciPasangan(r.storeId, r.salesMonth)));
  const calonLama = [
    ...new Map(ditetapkanBulanIni.map((r) => [kunciPasangan(r.storeId, r.period), { storeId: r.storeId, periode: r.period }])).values(),
  ].filter((p) => !pasanganDicek.has(kunciPasangan(p.storeId, p.periode)));
  const cekLain = calonLama.length
    ? await prisma.spgSalesCheck.findMany({ where: { OR: calonLama.map((p) => ({ storeId: p.storeId, period: p.periode })) }, select: { storeId: true, period: true } })
    : [];
  const dicekLain = new Set(cekLain.map((c) => kunciPasangan(c.storeId, c.period)));
  const lama = calonLama.filter((p) => !dicekLain.has(kunciPasangan(p.storeId, p.periode)));

  const pasanganPutus = [...putusDicek.map((r) => ({ storeId: r.storeId, periode: r.salesMonth })), ...lama];
  const resmi = pasanganPutus.length
    ? await prisma.spgCommission.findMany({
        where: { OR: pasanganPutus.map((p) => ({ storeId: p.storeId, period: p.periode })) },
        select: { id: true, userId: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, basis: true, lockedAt: true, paidAt: true, note: true },
      })
    : [];
  const resmiPer = new Map<string, typeof resmi>();
  for (const r of resmi) {
    const k = kunciPasangan(r.storeId, r.period);
    resmiPer.set(k, [...(resmiPer.get(k) ?? []), r]);
  }

  const laporanLama = await Promise.all(
    lama.map((p) => {
      const rows = resmiPer.get(kunciPasangan(p.storeId, p.periode)) ?? [];
      const terakhir = rows.reduce((t, r) => (r.lockedAt > t ? r.lockedAt : t), rows[0]?.lockedAt ?? rentang.start);
      return putusReportOf(prisma, p.storeId, p.periode, terakhir);
    }),
  );
  const laporanPutus: SalesReport[] = [...putusDicek, ...laporanLama];
  const pemegang = new Map(laporanPutus.map((l) => [l.key, (resmiPer.get(kunciPasangan(l.storeId, l.salesMonth)) ?? []).map((r) => r.userId)]));
  const tertundaBelumDicek = tertunda.filter((p) => !p.dicek);
  const laporanTertunda = await Promise.all(tertundaBelumDicek.map((p) => putusReportOf(prisma, p.storeId, p.periode, sekarang)));

  const [hasilPutus, hasilKonsi, hasilTertunda] = await Promise.all([
    susunLaporan(prisma, laporanPutus, rates, pemegang),
    susunLaporan(prisma, konsiDikunci, rates),
    susunLaporan(prisma, laporanTertunda, rates),
  ]);

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
          salaried: true,
          paidAt: true,
          spgUser: { select: { name: true, email: true } },
        },
      })
    : [];

  const konsiTertunda = berjualan.filter((p) => p.termsType === "KONSI");
  const siklusTertunda = konsiTertunda.length
    ? await prisma.consignmentCycle.findMany({
        where: { OR: konsiTertunda.map((p) => ({ storeId: p.storeId, periodYear: Number(p.periode.slice(0, 4)), periodMonth: Number(p.periode.slice(5, 7)) })) },
        select: { id: true, noKonsi: true, storeId: true, periodYear: true, periodMonth: true, lockedAt: true },
      })
    : [];
  const siklusPer = new Map(siklusTertunda.map((s) => [kunciPasangan(s.storeId, `${s.periodYear}-${String(s.periodMonth).padStart(2, "0")}`), s]));
  const konsiBelumKunci = konsiTertunda.filter((p) => !siklusPer.get(kunciPasangan(p.storeId, p.periode))?.lockedAt);

  const idToko = [
    ...new Set([
      ...laporanPutus.map((l) => l.storeId),
      ...konsiDikunci.map((l) => l.storeId),
      ...tertundaBelumDicek.map((p) => p.storeId),
      ...konsiBelumKunci.map((p) => p.storeId),
    ]),
  ];
  const tokoSemua = idToko.length
    ? await prisma.store.findMany({ where: { id: { in: idToko } }, select: { id: true, name: true, code: true, isActive: true } })
    : [];
  const toko = new Map(tokoSemua.map((t) => [t.id, t]));
  const namaToko = (id: string) => toko.get(id)?.name ?? id;

  const pemeriksa = [...new Set(putusDicek.map((r) => r.checkedById))];
  const orangCek = pemeriksa.length ? await prisma.user.findMany({ where: { id: { in: pemeriksa } }, select: { id: true, name: true, email: true } }) : [];
  const namaPemeriksa = new Map(orangCek.map((u) => [u.id, namaOrang(u)]));

  const bebanHilang = await sisaBebanHilangPerOrang(
    prisma,
    [...hasilPutus.values()].flatMap((h) => h.perSpg.map((p) => p.userId)),
  );

  const putus: LaporanPutusKantor[] = laporanPutus.map((l) => {
    const hasil = hasilPutus.get(l.key)!;
    const rows = resmiPer.get(kunciPasangan(l.storeId, l.salesMonth)) ?? [];
    const perUser = new Map(rows.map((r) => [r.userId, r]));
    const cek = putusDicek.find((p) => p.key === l.key) ?? null;
    const t = toko.get(l.storeId);
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
        return {
          ...p,
          status: statusResmi(r ?? null),
          resmi: r
            ? {
                id: r.id,
                unitsSold: r.unitsSold,
                commission: angka(r.commission),
                deduction: angka(r.deduction),
                aturanLama: aturanLama(r.basis),
                lockedAt: r.lockedAt.toISOString(),
                paidAt: r.paidAt ? r.paidAt.toISOString() : null,
                note: r.note,
              }
            : null,
          bebanHilangSisa: bebanHilang.get(p.userId) ?? 0,
        };
      }),
      adaResmi: rows.length > 0,
      adaDibayar: rows.some((r) => r.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((r) => r.paidAt !== null),
      berbeda: sudahBerbeda(hasil, rows.map(keBarisResmi)),
      aturanLama: rows.some((r) => aturanLama(r.basis)),
    };
  });
  putus.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const konsi: LaporanKonsiKantor[] = konsiDikunci.map((l) => {
    const hasil = hasilKonsi.get(l.key)!;
    const rows = gajiKonsi.filter((g) => g.cycleId === l.cycleId);
    const t = toko.get(l.storeId);
    const hitungPer = new Map(hasil.perSpg.map((p) => [p.userId, p.komisi]));
    const tersimpanPer = new Map(rows.map((g) => [g.spgUserId, angka(g.commission)]));
    // Termasuk penjual yang kini berkomisi tetapi belum punya baris gaji (notanya masuk sesudah dikunci).
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
          bergaji: g.salaried,
          gajiPokok: angka(g.baseSalary),
          komisi: angka(g.commission),
          komisiHitung: hitungPer.get(g.spgUserId) ?? 0,
          total: angka(g.total),
          potonganHilang: angka(g.deduction),
          dibayarPada: g.paidAt ? g.paidAt.toISOString() : null,
        }))
        .sort((a, b) => a.nama.localeCompare(b.nama)),
      berbeda,
      adaDibayar: rows.some((g) => g.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((g) => g.paidAt !== null),
    };
  });
  konsi.sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

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
        adaResmiLama: p.adaResmiLama,
      };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const konsiMenungguKunci: KonsiMenungguKunciKantor[] = konsiBelumKunci
    .map((p) => {
      const s = siklusPer.get(kunciPasangan(p.storeId, p.periode)) ?? null;
      return { storeId: p.storeId, nama: namaToko(p.storeId), kode: toko.get(p.storeId)?.code ?? "", bulanJual: p.periode, cycleId: s?.id ?? null, noKonsi: s?.noKonsi ?? null };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const putusResmi = resmi;
  return {
    bulan,
    bulanIni,
    putus,
    konsi,
    menungguCek,
    konsiMenungguKunci,
    ringkas: {
      totalDitetapkan:
        putusResmi.reduce((n, r) => n + angka(r.commission), 0) + gajiKonsi.reduce((n, g) => n + angka(g.commission), 0),
      // Uang yang benar-benar keluar: dikurangi potongan beban barang hilang.
      totalDibayar:
        putusResmi.filter((r) => r.paidAt !== null).reduce((n, r) => n + Math.max(0, angka(r.commission) - angka(r.deduction)), 0) +
        gajiKonsi.filter((g) => g.paidAt !== null).reduce((n, g) => n + Math.max(0, angka(g.total) - angka(g.deduction)), 0),
      belumDitetapkan: putus.filter((p) => p.dicek !== null && !p.adaResmi && p.baris.some((b) => b.penerima)).length,
      menungguCek: menungguCek.length + konsiMenungguKunci.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Antrean Beranda
// ---------------------------------------------------------------------------

/**
 * Toko PUTUS yang komisi SPG bulan penjualan `periode`-nya masih perlu ditindaklanjuti: ada nota
 * SPG bulan itu, belum ada yang dibayar, dan laporannya belum dicek atau sudah dicek tapi belum
 * ditetapkan. Definisi yang sama dengan antrean di halaman Komisi SPG.
 */
export async function tokoKomisiPutusBelumDitetapkan(periode: string, db: Klien = prisma): Promise<string[]> {
  return [...new Set((await pasanganPutusTertunda(db, [periode])).map((p) => p.storeId))];
}

/** Angka baris Beranda "komisi SPG toko putus bulan lalu belum ditetapkan". */
export async function jumlahKomisiPutusBelumDitetapkan(sekarang = new Date()): Promise<number> {
  return (await tokoKomisiPutusBelumDitetapkan(bulanSebelum(bulanWib(sekarang)))).length;
}
