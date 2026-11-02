import { prisma, type Prisma } from "@elorae/db";
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
import { commissionPerSpg, confirmsAnyPiece, konsiReportKey, payoutMonth, putusReportKey, type SalesReport } from "@/lib/spg-commission/payout";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "./hilang";
import { bacaAturanHilang, sisaBebanHilangPerOrang } from "./hilang-db";
import { jumlahDiterima } from "./komisi-hp";
import {
  barisSasaranKoreksi,
  koreksiDitahan,
  pratinjauSesudahDicek,
  rencanaBayarSemua,
  selisihMenunggu,
  type BarisKoreksi,
  type KoreksiDitahan,
  type RefBarisKomisi,
  type RencanaBayarKomisi,
  type UnitKomisiSpg,
} from "./koreksi";
import {
  daftarTunggakanKomisi,
  daftarTunggakanKomisiLama,
  koreksiBulanBayar,
  koreksiPadaPembayaran,
  pemegangKomisiSpg,
  returMenungguPerLaporan,
  unitKomisiSpg,
  type TunggakanKomisi,
} from "./koreksi-queries";
import {
  aturanLama,
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
    const waktuCek = dicek.get(kunciPasangan(r.storeId, r.period)) ?? null;
    return {
      id: r.id,
      storeId: r.storeId,
      periode: r.period,
      toko: nama.get(r.storeId) ?? "—",
      potong: r.unitsSold,
      komisi: angka(r.commission),
      /** Beban barang hilang yang dipotong saat komisi ini ditetapkan. */
      potonganHilang: angka(r.deduction),
      aturanLama: aturanLama(r.basis),
      bulanBayar: payoutMonth(waktuCek ?? r.lockedAt),
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
  /** Sudah diterapkan (pembayaran sudah dibayar); false = ikut dibayar bersama pembayaran ini. */
  diterapkan: boolean;
  /** Bagian minus yang dibawa ke pembayaran berikutnya (≤ 0). */
  dibawa: number;
};

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
  /** Komisi per SPG: yang dibayar, atau yang AKAN dibayar kalau belum dibayar. */
  komisi: number;
  /** Angka tersimpan yang diganti komisi per SPG saat dibayar; null kalau sama. */
  komisiLama: number | null;
  total: number;
  potonganHilang: number;
  /** Potong terjual — hanya toko putus (konsinyasi tidak menyimpannya per SPG). */
  potong: number | null;
  ditetapkan: string | null;
  dibayar: string | null;
  /** Dibayar (atau tertahan) dengan angka aturan lama (tarif barang). */
  aturanLama: boolean;
  koreksi: KoreksiHp[];
  /** Yang diterima / akan diterima: total − potongan + koreksi. */
  diterima: number;
  /** Pembayarannya menunggu keputusan kantor (angka aturan lama yang tidak bisa dibandingkan). */
  ditahan: boolean;
  /**
   * Belum ada angka yang akan dibayar: siklus yang kuncinya dibuka lagi kantor — angkanya baru ada
   * saat dikunci lagi. Layar tidak menyebut "Akan diterima" untuknya (begitu juga yang `ditahan`).
   */
  belumPasti?: boolean;
};

type ResmiDasar = Omit<KomisiResmiHp, "komisiLama" | "koreksi" | "diterima" | "ditahan"> & {
  refType: RefBarisKomisi;
  refId: string;
  kunciLaporan: string;
  storeId: string;
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
        paidAt: true,
        cycle: { select: { storeId: true, periodYear: true, periodMonth: true, lockedAt: true, store: { select: { name: true } } } },
      },
    }),
    komisiPutusResmiSaya(userId, batas),
  ]);
  // Callback bertipe: tanpa itu `refType` melebar ke string di dalam spread (TS2322).
  const semua: ResmiDasar[] = [
    ...konsi.map((r): ResmiDasar => ({
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
      komisi: angka(r.commission),
      total: angka(r.total),
      potonganHilang: angka(r.deduction),
      potong: null,
      ditetapkan: r.cycle.lockedAt ? r.cycle.lockedAt.toISOString() : null,
      dibayar: r.paidAt ? r.paidAt.toISOString() : null,
      aturanLama: false,
    })),
    ...putus.map((r): ResmiDasar => ({
      kunci: `putus:${r.id}`,
      refType: REF_KOMISI_SPG_PUTUS,
      refId: r.id,
      kunciLaporan: putusReportKey(r.storeId, r.periode),
      storeId: r.storeId,
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

const samaSen = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Pembayaran resmi SPG ini (konsinyasi dan toko putus, terbaru dulu menurut bulan pembayaran)
 * dengan angka yang SAMA dengan yang dibayar kantor: baris yang sudah dibayar dengan koreksi yang
 * diterapkan padanya; baris yang belum dibayar dengan komisi per SPG sekarang dan koreksi yang
 * akan ikut (`rencanaBayarKomisi`) — termasuk bulan toko putus aturan lama yang belum dicek, yang
 * dibayar dengan komisi per SPG sesudah dicek (`pratinjauSesudahDicek`), tidak pernah dengan angka
 * lamanya — dan koreksi yang menunggu pembayaran berikutnya. Baris yang ditahan (`ditahan`) dan
 * siklus yang kuncinya dibuka lagi (`belumPasti`) tidak membawa angka "akan diterima" yang bisa
 * dipercaya; kedua layar SPG tidak menyebutnya. Hanya milik SPG ini: tidak ada rupiah, nama, atau
 * id rekan.
 */
export async function ringkasGajiSaya(
  userId: string,
  batas = 6,
): Promise<{ resmi: KomisiResmiHp[]; koreksiMenunggu: Array<{ bulanJual: string; toko: string; jumlah: number }> }> {
  const sekarang = new Date();
  const [dasar, petaUnit, aturan] = await Promise.all([
    komisiResmiDasar(userId, batas),
    unitKomisiSpg(prisma, [userId], sekarang),
    bacaAturanHilang(prisma),
  ]);
  const units = petaUnit.get(userId) ?? [];
  const unitPer = new Map(units.map((u) => [u.kunci, u]));
  const rencana = rencanaBayarSemua(units, aturan.maksPotongPersen);
  const terapan = await koreksiPadaPembayaran(
    prisma,
    dasar.filter((r) => r.dibayar !== null).map((r) => ({ refType: r.refType, refId: r.refId })),
  );
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
      komisi: r.komisi,
      total: r.total,
      potonganHilang: r.potonganHilang,
      potong: r.potong,
      ditetapkan: r.ditetapkan,
      dibayar: r.dibayar,
      aturanLama: r.aturanLama,
    };
    if (r.dibayar !== null) {
      const k = (terapan.get(refId) ?? []).map((x) => ({ bulanJual: x.bulanJual, toko: namaToko.get(x.storeId) ?? x.storeId, jumlah: x.jumlah, diterapkan: true, dibawa: 0 }));
      const unit = unitPer.get(kunciLaporan);
      return {
        ...tampil,
        komisiLama: null,
        aturanLama: r.aturanLama || Boolean(unit?.baris?.dibayar && unit.baris.dasarLama),
        koreksi: k,
        diterima: Math.round((jumlahDiterima(r) + k.reduce((n, x) => n + x.jumlah, 0)) * 100) / 100,
        ditahan: false,
        belumPasti: false,
      };
    }
    // Belum boleh dibayar tetapi sudah punya bulan pembayaran (bulan toko putus aturan lama yang
    // belum dicek): pratinjau dengan komisi per SPG sekarang — angka yang dibayar sesudah dicek,
    // bukan angka aturan lama yang tersimpan.
    const p = rencana.get(refId) ?? pratinjauSesudahDicek({ units, kunci: kunciLaporan, maksPotongPersen: aturan.maksPotongPersen });
    if (!p) {
      // Siklus yang kuncinya dibuka lagi: angkanya belum ada — layar tidak menyebut "Akan diterima".
      return { ...tampil, komisiLama: null, koreksi: [], diterima: jumlahDiterima(r), ditahan: false, belumPasti: true };
    }
    if (p.ditahan) {
      // Menunggu keputusan pemilik: tidak dibayar dengan angka mana pun sampai diputuskan.
      return { ...tampil, komisiLama: null, koreksi: [], diterima: jumlahDiterima(r), ditahan: true, belumPasti: false };
    }
    return {
      ...tampil,
      komisi: p.komisiBaru,
      komisiLama: p.berubah && !samaSen(p.komisiLama, p.komisiBaru) ? p.komisiLama : null,
      total: (r.gaji ?? 0) + p.komisiBaru,
      potonganHilang: p.potonganHilang,
      potong: r.jenis === "PUTUS" ? p.potongBaru : null,
      // Dibayar dengan komisi per SPG sekarang — bukan lagi angka aturan lama.
      aturanLama: false,
      koreksi: p.koreksi
        .filter((x) => !samaSen(x.diterapkan, 0) || !samaSen(x.dibawa, 0))
        .map((x) => ({ bulanJual: x.bulanJual, toko: x.namaToko, jumlah: x.diterapkan, diterapkan: false, dibawa: x.dibawa })),
      diterima: p.dibayar,
      ditahan: false,
      belumPasti: false,
    };
  });

  // Koreksi yang menunggu dan tidak tampil sebagai pratinjau di pembayaran mana pun di daftar.
  const sasaran = barisSasaranKoreksi(units);
  const sasaranTampil = sasaran !== null && dasar.some((r) => r.refId === sasaran.baris.refId);
  const koreksiMenunggu = sasaranTampil
    ? []
    : selisihMenunggu(units).map((k) => ({ bulanJual: k.bulanJual, toko: k.namaToko, jumlah: k.selisih }));
  return { resmi, koreksiMenunggu };
}

/** Pembayaran resmi SPG ini — konsinyasi dan toko putus — terbaru dulu menurut bulan pembayarannya. */
export async function komisiResmiSaya(userId: string, batas = 6): Promise<KomisiResmiHp[]> {
  return (await ringkasGajiSaya(userId, batas)).resmi;
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
  /** Rencana membayar baris yang belum dibayar: komisi per SPG sekarang, koreksi yang ikut, yang dibayarkan. */
  bayar: RencanaBayarKomisi | null;
  /** Koreksi yang diterapkan pada baris yang sudah dibayar. */
  koreksiDiterapkan: KoreksiDiterapkanKantor[];
  /** Yang dibayarkan baris yang sudah dibayar: komisi − potongan + koreksi; null kalau belum dibayar. */
  dibayarkan: number | null;
};

export type KoreksiDiterapkanKantor = { bulanJual: string; toko: string; jumlah: number };

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
  /** Retur pembeli bulan itu yang masih menunggu persetujuan kantor. */
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
    bayar: RencanaBayarKomisi | null;
    koreksiDiterapkan: KoreksiDiterapkanKantor[];
    /** Yang dibayarkan baris yang sudah dibayar: total − potongan + koreksi; null kalau belum dibayar. */
    dibayarkan: number | null;
  }[];
  /**
   * Hitungan sekarang tidak sama dengan yang tersimpan, per SPG: nota/pengembalian HP yang masuk
   * sesudah dikunci, atau siklus yang dikunci dengan aturan lama (tarif barang, dibagi rata).
   */
  berbeda: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  returMenunggu: number;
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
  /** Sudah ada komisi aturan lama yang belum dibayar — sesudah dicek dibayar dengan komisi per SPG. */
  adaResmiLama: boolean;
  returMenunggu: number;
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
  /** Belum dibayar dari bulan pembayaran sebelumnya (jendela koreksi) dan bisa dibayar — kartu #tunggakan, tepat yang dihitung Beranda. */
  tunggakan: TunggakanKantor[];
  /** Seperti `tunggakan`, tetapi menunggu keputusan pemilik (`ditahan`): tidak bisa dibayar, tidak dihitung di Beranda. */
  tunggakanDitahan: TunggakanKantor[];
  /** Belum dibayar dari bulan pembayaran lebih tua dari jendela koreksi — tidak dihitung di Beranda. */
  tunggakanLama: TunggakanKantor[];
  /** Koreksi yang menunggu pembayaran berikutnya, per SPG, dengan baris tempat ia akan ikut. */
  koreksiMenunggu: { userId: string; nama: string; baris: BarisKoreksi[]; sasaran: { bulanJual: string; namaToko: string } | null }[];
  /** Unit yang menunggu keputusan pemilik (tidak dikoreksi atau diganti otomatis). */
  koreksiDitahan: { userId: string; nama: string; baris: KoreksiDitahan[] }[];
  ringkas: {
    totalDitetapkan: number;
    /** Yang benar-benar dibayarkan bulan pembayaran ini, termasuk koreksi. */
    totalDibayar: number;
    /** Σ koreksi yang diterapkan bulan pembayaran ini. */
    totalKoreksi: number;
    belumDitetapkan: number;
    menungguCek: number;
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
 *
 * Hanya bulan yang hitungannya MENGONFIRMASI potong untuk seorang SPG (`confirmsAnyPiece`): bulan
 * yang seluruh notanya dikembalikan pembeli tidak bisa dicek (`TANPA_PENJUALAN`) maupun ditetapkan
 * (`TANPA_SPG`), jadi tidak pernah masuk antrean — kalau masuk, tombolnya selalu gagal dan baris
 * Beranda tidak pernah habis. Laporannya (`laporan`, bertanggal `sekarang`) ikut dikembalikan
 * supaya halaman tidak membacanya dua kali.
 */
async function pasanganPutusTertunda(
  db: Klien,
  bulan: readonly string[],
  sekarang: Date,
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
  const calon = berjualan
    .filter((p) => !dibayar.has(kunciPasangan(p.storeId, p.periode)))
    .map((p) => {
      const k = kunciPasangan(p.storeId, p.periode);
      return { storeId: p.storeId, periode: p.periode, dicek: dicek.has(k), ditetapkan: ditetapkan.has(k), adaResmiLama: lama.has(k) };
    })
    .filter((p) => !p.dicek || !p.ditetapkan);
  const laporan = await putusReportsOf(
    db,
    calon.map((p) => ({ storeId: p.storeId, salesMonth: p.periode, checkedAt: sekarang })),
  );
  return calon.map((p, i) => ({ ...p, laporan: laporan[i] })).filter((p) => confirmsAnyPiece(p.laporan));
}

/**
 * Komisi SPG satu BULAN PEMBAYARAN untuk kantor: setiap toko putus × bulan penjualan yang dicek di
 * bulan itu dan setiap siklus konsinyasi yang angkanya dikunci di bulan itu, plus antrean yang
 * menunggu dicek. Komisi aturan lama (ditetapkan tanpa tanda dicek) tampil di bulan terakhir
 * ditetapkannya.
 */
export async function daftarKomisiKantor(bulan: string, sekarang: Date): Promise<DaftarKomisiKantor> {
  const bulanIni = bulanWib(sekarang);
  const rentang = wibMonthRange(bulan);
  const bulanAntrean = bulanSelesaiTerakhir(bulanIni, BULAN_MENUNGGU_CEK);

  // Toko putus × bulan penjualan yang dibayar bulan ini — dicek di bulan ini, atau komisi aturan
  // lama yang terakhir ditetapkan di bulan ini tanpa tanda dicek — dengan baris resminya. Satu
  // pemuat dengan rekap komisi (`getCommissionRecap`), jadi keduanya memuat bulan yang sama.
  const [laporanPutus, konsiDikunci, rates, berjualan] = await Promise.all([
    putusPayoutReports(prisma, { paidIn: rentang }),
    lockedKonsiReports(prisma, { lockedIn: rentang }),
    commissionRates(prisma),
    tokoBerjualan(prisma, bulanAntrean),
  ]);
  const tertunda = await pasanganPutusTertunda(prisma, bulanAntrean, sekarang, berjualan);

  const resmi = laporanPutus.flatMap((l) => l.stored);
  const pemegang = new Map(laporanPutus.map((l) => [l.key, l.stored.map((r) => r.userId)]));
  const tertundaBelumDicek = tertunda.filter((p) => !p.dicek);
  const laporanTertunda: SalesReport[] = tertundaBelumDicek.map((p) => p.laporan);

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

  const pemeriksa = [...new Set(laporanPutus.flatMap((l) => (l.check ? [l.check.checkedById] : [])))];
  const orangCek = pemeriksa.length ? await prisma.user.findMany({ where: { id: { in: pemeriksa } }, select: { id: true, name: true, email: true } }) : [];
  const namaPemeriksa = new Map(orangCek.map((u) => [u.id, namaOrang(u)]));

  const bebanHilang = await sisaBebanHilangPerOrang(
    prisma,
    [...hasilPutus.values()].flatMap((h) => h.perSpg.map((p) => p.userId)),
  );

  // Rencana bayar setiap baris belum dibayar dan koreksi setiap SPG: satu pemuat dengan HP SPG dan
  // penulis pembayaran (`lib/spg/koreksi.ts`), jadi yang ditampilkan = yang dibayar.
  const [tunggakanDalam, tunggakanLampau, pemegang, aturanHilang, koreksiBulan] = await Promise.all([
    daftarTunggakanKomisi(prisma, sekarang),
    daftarTunggakanKomisiLama(prisma, sekarang),
    pemegangKomisiSpg(prisma, sekarang),
    bacaAturanHilang(prisma),
    koreksiBulanBayar(prisma, bulan),
  ]);
  const idOrang = [
    ...new Set([
      ...resmi.map((r) => r.userId),
      ...gajiKonsi.map((g) => g.spgUserId),
      ...[...hasilPutus.values(), ...hasilKonsi.values()].flatMap((h) => h.perSpg.filter((p) => p.penerima).map((p) => p.userId)),
      ...tunggakanDalam.map((t) => t.spgUserId),
      ...tunggakanLampau.map((t) => t.spgUserId),
      ...pemegang,
    ]),
  ];
  const [petaUnit, returMenunggu] = await Promise.all([
    unitKomisiSpg(prisma, idOrang, sekarang),
    returMenungguPerLaporan(prisma, [
      ...laporanPutus.map((l) => ({ storeId: l.storeId, bulanJual: l.salesMonth })),
      ...konsiDikunci.map((l) => ({ storeId: l.storeId, bulanJual: l.salesMonth })),
      ...tertundaBelumDicek.map((p) => ({ storeId: p.storeId, bulanJual: p.periode })),
      ...tunggakanDalam.map((t) => ({ storeId: t.storeId, bulanJual: t.bulanJual })),
      ...tunggakanLampau.map((t) => ({ storeId: t.storeId, bulanJual: t.bulanJual })),
    ]),
  ]);
  const rencana = new Map<string, RencanaBayarKomisi>();
  for (const units of petaUnit.values()) for (const [id, r] of rencanaBayarSemua(units, aturanHilang.maksPotongPersen)) rencana.set(id, r);
  // Callback bertipe: tanpa itu `refType` melebar ke string di dalam spread (TS2345).
  const terapan = await koreksiPadaPembayaran(prisma, [
    ...resmi.filter((r) => r.paidAt !== null).map((r): RefPembayaranKomisi => ({ refType: REF_KOMISI_SPG_PUTUS, refId: r.id })),
    ...gajiKonsi.filter((g) => g.paidAt !== null).map((g): RefPembayaranKomisi => ({ refType: REF_KOMISI_KONSI, refId: g.id })),
  ]);
  const namaTokoUnit = new Map<string, string>();
  for (const units of petaUnit.values()) for (const u of units) namaTokoUnit.set(u.storeId, u.namaToko);
  const tampilTerapan = (id: string): KoreksiDiterapkanKantor[] =>
    (terapan.get(id) ?? []).map((k) => ({ bulanJual: k.bulanJual, toko: namaTokoUnit.get(k.storeId) ?? namaToko(k.storeId), jumlah: k.jumlah }));
  const jumlahTerapan = (id: string) => (terapan.get(id) ?? []).reduce((n, k) => n + k.jumlah, 0);
  const sen2 = (n: number) => Math.round(n * 100) / 100;
  const kunciRetur = (storeId: string, bulanJual: string) => `${storeId}\u0000${bulanJual}`;

  const putus: LaporanPutusKantor[] = laporanPutus.map((l) => {
    const hasil = hasilPutus.get(l.key)!;
    const rows = l.stored;
    const perUser = new Map(rows.map((r) => [r.userId, r]));
    const cek = l.check;
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
          bayar: r && r.paidAt === null ? (rencana.get(r.id) ?? null) : null,
          koreksiDiterapkan: r && r.paidAt !== null ? tampilTerapan(r.id) : [],
          dibayarkan: r && r.paidAt !== null ? sen2(Math.max(0, angka(r.commission) - angka(r.deduction)) + jumlahTerapan(r.id)) : null,
        };
      }),
      adaResmi: rows.length > 0,
      adaDibayar: rows.some((r) => r.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((r) => r.paidAt !== null),
      berbeda: sudahBerbeda(hasil, rows.map(keBarisResmi)),
      aturanLama: rows.some((r) => aturanLama(r.basis)),
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
          bayar: g.paidAt === null ? (rencana.get(g.id) ?? null) : null,
          koreksiDiterapkan: g.paidAt !== null ? tampilTerapan(g.id) : [],
          dibayarkan: g.paidAt !== null ? sen2(Math.max(0, angka(g.total) - angka(g.deduction)) + jumlahTerapan(g.id)) : null,
        }))
        .sort((a, b) => a.nama.localeCompare(b.nama)),
      berbeda,
      adaDibayar: rows.some((g) => g.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((g) => g.paidAt !== null),
      returMenunggu: returMenunggu.get(kunciRetur(l.storeId, l.salesMonth)) ?? 0,
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
        returMenunggu: returMenunggu.get(kunciRetur(l.storeId, l.salesMonth)) ?? 0,
      };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  const konsiMenungguKunci: KonsiMenungguKunciKantor[] = konsiBelumKunci
    .map((p) => {
      const s = siklusPer.get(kunciPasangan(p.storeId, p.periode)) ?? null;
      return { storeId: p.storeId, nama: namaToko(p.storeId), kode: toko.get(p.storeId)?.code ?? "", bulanJual: p.periode, cycleId: s?.id ?? null, noKonsi: s?.noKonsi ?? null };
    })
    .sort((a, b) => a.bulanJual.localeCompare(b.bulanJual) || a.nama.localeCompare(b.nama));

  // Koreksi yang menunggu dan unit yang ditahan, per SPG (nama dibaca sekali).
  const perluNama = [...petaUnit].filter(([, units]) => selisihMenunggu(units).length > 0 || koreksiDitahan(units).length > 0).map(([id]) => id);
  const orangKoreksi = perluNama.length ? await prisma.user.findMany({ where: { id: { in: perluNama } }, select: { id: true, name: true, email: true } }) : [];
  const namaPer = new Map(orangKoreksi.map((u) => [u.id, namaOrang(u)]));
  const koreksiMenunggu: DaftarKomisiKantor["koreksiMenunggu"] = [];
  const ditahan: DaftarKomisiKantor["koreksiDitahan"] = [];
  for (const [userId, units] of petaUnit) {
    const tunggu = selisihMenunggu(units);
    if (tunggu.length > 0) {
      const sasaran = barisSasaranKoreksi(units);
      koreksiMenunggu.push({
        userId,
        nama: namaPer.get(userId) ?? userId,
        baris: tunggu,
        sasaran: sasaran ? { bulanJual: sasaran.unit.bulanJual, namaToko: sasaran.unit.namaToko } : null,
      });
    }
    const tahan = koreksiDitahan(units);
    if (tahan.length > 0) ditahan.push({ userId, nama: namaPer.get(userId) ?? userId, baris: tahan });
  }
  koreksiMenunggu.sort((a, b) => a.nama.localeCompare(b.nama));
  ditahan.sort((a, b) => a.nama.localeCompare(b.nama));

  const unitPer = new Map<string, UnitKomisiSpg>();
  for (const units of petaUnit.values()) for (const u of units) if (u.baris) unitPer.set(u.baris.refId, u);
  const keTunggakan = (t: TunggakanKomisi): TunggakanKantor => ({
    ...t,
    bayar: rencana.get(t.refId) ?? null,
    gajiPokok: unitPer.get(t.refId)?.baris?.gajiPokok ?? 0,
    komisiTersimpan: unitPer.get(t.refId)?.baris?.komisiTersimpan ?? 0,
    returMenunggu: returMenunggu.get(kunciRetur(t.storeId, t.bulanJual)) ?? 0,
  });

  const putusResmi = resmi;
  const dibayarkanBulan = [
    ...putus.flatMap((l) => l.baris.map((b) => b.dibayarkan ?? 0)),
    ...konsi.flatMap((k) => k.baris.map((b) => b.dibayarkan ?? 0)),
  ];
  return {
    bulan,
    bulanIni,
    putus,
    konsi,
    menungguCek,
    konsiMenungguKunci,
    tunggakan: tunggakanDalam.filter((t) => t.ditahan === null).map(keTunggakan),
    tunggakanDitahan: tunggakanDalam.filter((t) => t.ditahan !== null).map(keTunggakan),
    tunggakanLama: tunggakanLampau.map(keTunggakan),
    koreksiMenunggu,
    koreksiDitahan: ditahan,
    ringkas: {
      totalDitetapkan:
        putusResmi.reduce((n, r) => n + angka(r.commission), 0) + gajiKonsi.reduce((n, g) => n + angka(g.commission), 0),
      // Uang yang benar-benar keluar: dikurangi potongan beban barang hilang, ditambah koreksi.
      totalDibayar: sen2(dibayarkanBulan.reduce((n, x) => n + x, 0)),
      totalKoreksi: sen2(koreksiBulan.reduce((n, k) => n + k.jumlah, 0)),
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
 * SPG bulan itu yang mengonfirmasi potong, belum ada yang dibayar, dan laporannya belum dicek atau
 * sudah dicek tapi belum ditetapkan. Definisi yang sama dengan antrean di halaman Komisi SPG.
 */
export async function tokoKomisiPutusBelumDitetapkan(periode: string, db: Klien = prisma, sekarang = new Date()): Promise<string[]> {
  return [...new Set((await pasanganPutusTertunda(db, [periode], sekarang)).map((p) => p.storeId))];
}

/** Angka baris Beranda "komisi SPG toko putus bulan lalu belum ditetapkan". */
export async function jumlahKomisiPutusBelumDitetapkan(sekarang = new Date()): Promise<number> {
  return (await tokoKomisiPutusBelumDitetapkan(bulanSebelum(bulanWib(sekarang)))).length;
}
