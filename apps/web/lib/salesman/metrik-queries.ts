import { prisma } from "@elorae/db";
import { izinDisetujuiRentang } from "./izin-queries";
import { kunciHariWib } from "@/lib/dashboard/tren";
import {
  awalHari,
  batasRentang,
  hitungMetrikLapangan,
  jumlahkanMetrik,
  rencanaVsRealisasi,
  rincianKunjungan,
  type BahanMetrik,
  type MetrikLapangan,
  type RencanaRealisasi,
  type Rentang,
  type RincianKunjungan,
  type TokoBaruBahan,
} from "./metrik-lapangan";
import { kepatuhanJadwal, type RingkasJadwal, type StatusJadwal, type IzinUntukJadwal } from "./jadwal";
import { bacaBatasHari, bacaTargetBulan, KUNCI_BATAS_HARI, KUNCI_TARGET } from "./pengaturan";
import { daftarSalesman, penjualanSalesman, tokoMenurun, tokoSaya } from "./queries";

/**
 * Kueri kinerja lapangan — bahan untuk `metrik-lapangan.ts`. Satu jalur untuk
 * layar "Hari ini" di HP (satu sales), dasbor atasan (semua sales), ekspor
 * Excel dan kabar harian, supaya keempatnya tidak pernah menyebut angka berbeda
 * untuk hari yang sama.
 *
 * Semua kueri disaring ke sales yang diminta. Bahan diambil sekali untuk semua
 * sales lalu dibagi di memori — bukan satu set kueri per sales.
 */

const angka = (v: unknown) => Number(v ?? 0);

type Batas = { mulai: Date; akhir: Date };

export type BarisKunjunganLapangan = RincianKunjungan & {
  toko: string;
  kodeToko: string;
  lat: number;
  lng: number;
  jarakMeter: number | null;
  catatan: string | null;
  ditutupOtomatis: boolean;
};

export type TargetSales = { bulan: string; target: number; capai: number; persen: number };

export type KinerjaSales = {
  salesmanId: string;
  nama: string;
  metrik: MetrikLapangan;
  /** null bila dimuat tanpa rencana (kabar harian). */
  rencana: RencanaRealisasi | null;
  /** Toko saya yang saat ini mulai jarang pesan; null bila dimuat tanpa rencana. */
  tokoMenurun: number | null;
  /** Hanya bila rentangnya di dalam satu bulan kalender dan targetnya diatur. */
  target: TargetSales | null;
  /**
   * Kepatuhan jadwal kunjungan dari kantor di rentang: toko terjadwal yang
   * didatangi pada harinya. null bila dimuat tanpa rencana (kabar harian);
   * `direncanakan` 0 = kantor tidak menjadwalkan apa pun.
   */
  jadwal: RingkasJadwal | null;
};

type BarisJadwalSales = { salesmanId: string; storeId: string; dayKey: string; note: string | null };

type JadwalSales = { baris: BarisJadwalSales[]; izin: IzinUntukJadwal[] };

/**
 * Jadwal kantor untuk sekumpulan sales di rentang, dibagi per sales — beserta
 * izin/sakit/cuti yang disetujui di rentang yang sama, supaya hari izin tidak
 * terhitung "terlewat". Dua kueri untuk semua sales, bukan per sales.
 */
async function muatJadwal(ids: string[], rentang: Rentang): Promise<Map<string, JadwalSales>> {
  const peta = new Map<string, JadwalSales>(ids.map((id) => [id, { baris: [], izin: [] }]));
  if (ids.length === 0) return peta;
  const [rows, izin] = await Promise.all([
    prisma.visitSchedule.findMany({
      where: { salesmanId: { in: ids }, dayKey: { gte: rentang.dari, lte: rentang.sampai } },
      select: { salesmanId: true, storeId: true, dayKey: true, note: true },
      orderBy: [{ dayKey: "asc" }, { createdAt: "asc" }],
    }),
    izinDisetujuiRentang(ids, rentang.dari, rentang.sampai),
  ]);
  for (const r of rows) peta.get(r.salesmanId)?.baris.push(r);
  for (const z of izin) peta.get(z.userId)?.izin.push(z);
  return peta;
}

/**
 * Status setiap baris jadwal satu sales, dicocokkan dengan kunjungan yang
 * SUDAH dimuat untuk metrik (rentang yang sama) — tanpa kueri kunjungan kedua.
 */
function nilaiJadwal(salesmanId: string, jadwal: JadwalSales | undefined, bahan: BahanSales, sekarang: Date) {
  return kepatuhanJadwal(
    jadwal?.baris ?? [],
    bahan.kunjungan.map((k) => ({ userId: salesmanId, storeId: k.storeId, checkinAt: k.checkinAt })),
    kunciHariWib(sekarang),
    jadwal?.izin ?? [],
  );
}

type BarisKunjunganDb = {
  id: string;
  userId: string;
  storeId: string;
  checkinAt: Date;
  checkoutAt: Date | null;
  outcome: string | null;
  outcomeNote: string | null;
  checkinOutOfRadius: boolean;
  checkinFlags: unknown;
  checkinLat: unknown;
  checkinLng: unknown;
  checkinDistanceMeters: number | null;
  autoClosed: boolean;
  store: { name: string; code: string };
};

type BahanSales = BahanMetrik & { kunjunganDb: BarisKunjunganDb[] };

const bahanKosong = (): BahanSales => ({
  kunjungan: [],
  pesanan: [],
  klaim: [],
  retur: [],
  van: [],
  tokoBaru: [],
  kunjunganDb: [],
});

/**
 * Bahan metrik untuk sekumpulan sales, dibagi per sales.
 *
 * Klaim diambil menurut tanggal lapor ATAU tanggal verifikasi — pelunasan
 * yang dilaporkan kemarin dan diverifikasi hari ini adalah uang masuk hari ini.
 *
 * Toko baru (NOO) = usulan toko sales ini yang disetujui di rentang, ditambah
 * toko yang transaksi PERTAMANYA sepanjang masa (pesanan yang tidak ditolak
 * atau jual van, oleh siapa pun) jatuh di rentang dan dicatat sales ini.
 */
async function muatBahan(ids: string[], b: Batas): Promise<Map<string, BahanSales>> {
  const peta = new Map<string, BahanSales>(ids.map((id) => [id, bahanKosong()]));
  if (ids.length === 0) return peta;
  const rentang = { gte: b.mulai, lt: b.akhir };

  const [kunjungan, pesanan, klaim, retur, van, usulan] = await Promise.all([
    prisma.storeVisit.findMany({
      where: { userId: { in: ids }, checkinAt: rentang },
      orderBy: { checkinAt: "asc" },
      select: {
        id: true,
        userId: true,
        storeId: true,
        checkinAt: true,
        checkoutAt: true,
        outcome: true,
        outcomeNote: true,
        checkinOutOfRadius: true,
        checkinFlags: true,
        checkinLat: true,
        checkinLng: true,
        checkinDistanceMeters: true,
        autoClosed: true,
        store: { select: { name: true, code: true } },
      },
    }),
    prisma.fieldSalesOrder.findMany({
      // Pesanan yang dibatalkan salesman (termasuk yang diganti) bukan pesanan: penggantinya yang dihitung.
      where: { salesmanId: { in: ids }, createdAt: rentang, cancelledById: null },
      select: {
        id: true,
        storeId: true,
        salesmanId: true,
        visitId: true,
        orderType: true,
        status: true,
        total: true,
        createdAt: true,
        remoteChannel: true,
      },
    }),
    prisma.paymentClaim.findMany({
      where: {
        salesmanId: { in: ids },
        OR: [{ createdAt: rentang }, { status: "TERVERIFIKASI", verifiedAt: rentang }],
      },
      select: { id: true, storeId: true, salesmanId: true, status: true, receivedAmount: true, createdAt: true, verifiedAt: true },
    }),
    prisma.storeReturn.findMany({
      where: { salesmanId: { in: ids }, createdAt: rentang },
      select: { id: true, storeId: true, salesmanId: true, status: true, createdAt: true },
    }),
    prisma.vanSale.findMany({
      where: { salesmanId: { in: ids }, createdAt: rentang },
      select: { id: true, storeId: true, salesmanId: true, total: true, createdAt: true },
    }),
    prisma.storeProposal.findMany({
      where: { proposedById: { in: ids }, status: "APPROVED", reviewedAt: rentang, storeId: { not: null } },
      select: { storeId: true, proposedById: true, reviewedAt: true },
    }),
  ]);

  for (const v of kunjungan) {
    const s = peta.get(v.userId);
    if (!s) continue;
    s.kunjunganDb.push(v);
    s.kunjungan.push({
      id: v.id,
      storeId: v.storeId,
      checkinAt: v.checkinAt,
      checkoutAt: v.checkoutAt,
      outcome: v.outcome,
      diLuarRadius: v.checkinOutOfRadius,
      tanda: v.checkinFlags,
    });
  }
  for (const o of pesanan) {
    peta.get(o.salesmanId)?.pesanan.push({
      id: o.id,
      storeId: o.storeId,
      visitId: o.visitId,
      orderType: o.orderType,
      status: o.status,
      total: angka(o.total),
      createdAt: o.createdAt,
      jarakJauh: o.remoteChannel !== null,
    });
  }
  for (const k of klaim) {
    peta.get(k.salesmanId)?.klaim.push({
      id: k.id,
      storeId: k.storeId,
      status: k.status,
      nilai: angka(k.receivedAmount),
      createdAt: k.createdAt,
      verifiedAt: k.verifiedAt,
    });
  }
  for (const r of retur) {
    if (r.salesmanId) peta.get(r.salesmanId)?.retur.push({ id: r.id, storeId: r.storeId, status: r.status, createdAt: r.createdAt });
  }
  for (const n of van) {
    peta.get(n.salesmanId)?.van.push({ id: n.id, storeId: n.storeId, total: angka(n.total), createdAt: n.createdAt });
  }
  for (const u of usulan) {
    if (u.storeId && u.reviewedAt) {
      peta.get(u.proposedById)?.tokoBaru.push({ storeId: u.storeId, tanggal: u.reviewedAt, sumber: "USULAN" });
    }
  }

  // Transaksi pertama sepanjang masa per toko — hanya untuk toko yang punya
  // transaksi sales ini di rentang; toko lain tidak mungkin "baru" di sini.
  type Transaksi = { storeId: string; salesmanId: string; createdAt: Date };
  const transaksi: Transaksi[] = [
    ...pesanan.filter((o) => o.status !== "REJECTED"),
    ...van.filter((n): n is typeof n & { storeId: string } => n.storeId !== null),
  ];
  const calon = [...new Set(transaksi.map((x) => x.storeId))];
  if (calon.length) {
    const [pertamaPesanan, pertamaVan] = await Promise.all([
      prisma.fieldSalesOrder.groupBy({
        by: ["storeId"],
        where: { storeId: { in: calon }, status: { not: "REJECTED" } },
        _min: { createdAt: true },
      }),
      prisma.vanSale.groupBy({ by: ["storeId"], where: { storeId: { in: calon } }, _min: { createdAt: true } }),
    ]);
    const pertama = new Map<string, Date>();
    for (const g of [...pertamaPesanan, ...pertamaVan]) {
      const d = g._min.createdAt;
      if (!g.storeId || !d) continue;
      const lama = pertama.get(g.storeId);
      if (!lama || d < lama) pertama.set(g.storeId, d);
    }
    for (const [storeId, tanggal] of pertama) {
      if (tanggal < b.mulai || tanggal >= b.akhir) continue;
      // Yang mencatat transaksi pertama itu yang mendapat tokonya.
      const pencatat = transaksi.find((x) => x.storeId === storeId && x.createdAt.getTime() === tanggal.getTime());
      const baru: TokoBaruBahan = { storeId, tanggal, sumber: "PESANAN_PERTAMA" };
      if (pencatat) peta.get(pencatat.salesmanId)?.tokoBaru.push(baru);
    }
  }

  return peta;
}

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function bacaPengaturan(): Promise<{ batasHari: number; targetMentah: string | null }> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_BATAS_HARI, KUNCI_TARGET] } },
    select: { key: true, value: true },
  });
  const nilai = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return { batasHari: bacaBatasHari(nilai(KUNCI_BATAS_HARI)).hari, targetMentah: nilai(KUNCI_TARGET) };
}

/**
 * Rencana vs realisasi, jumlah toko menurun, dan kemajuan target satu sales.
 * Memakai "toko saya", toko menurun dan penjualan yang SAMA dengan beranda HP
 * (`queries.ts`), jadi angkanya sejalan dengan yang dilihat sales sendiri.
 */
async function rencanaSales(
  salesmanId: string,
  rentang: Rentang,
  bahan: BahanSales,
  atur: { batasHari: number; targetMentah: string | null },
  sekarang: Date,
): Promise<Pick<KinerjaSales, "rencana" | "tokoMenurun" | "target">> {
  const toko = await tokoSaya(salesmanId, sekarang);
  const idToko = toko.rencana.map((t) => t.storeId);
  const [menurun, sebelum] = await Promise.all([
    tokoMenurun(
      toko.rencana.map((t) => ({ storeId: t.storeId, nama: t.nama })),
      sekarang,
    ),
    idToko.length
      ? prisma.storeVisit.groupBy({
          by: ["storeId"],
          where: { userId: salesmanId, storeId: { in: idToko }, checkinAt: { lt: awalHari(rentang.dari) } },
          _max: { checkinAt: true },
        })
      : Promise.resolve([]),
  ]);

  const rencana = rencanaVsRealisasi({
    toko: toko.rencana,
    kunjunganSebelum: new Map(
      sebelum.flatMap((g) => (g._max.checkinAt ? [[g.storeId, g._max.checkinAt] as const] : [])),
    ),
    kunjungan: bahan.kunjungan,
    menurun,
    rentang,
    batasHari: atur.batasHari,
    hariIni: kunciHariWib(sekarang),
  });

  let target: TargetSales | null = null;
  const bulan = rentang.dari.slice(0, 7);
  if (bulan === rentang.sampai.slice(0, 7)) {
    const nilaiTarget = bacaTargetBulan(atur.targetMentah, salesmanId, bulan);
    if (nilaiTarget) {
      // Capaian = penjualan terealisasi bulan itu sampai akhir rentang — definisi
      // yang sama dengan kartu target di beranda HP (putus terkirim + konsi
      // disetujui + jual van).
      const { akhir } = batasRentang(rentang);
      const jual = await penjualanSalesman(salesmanId, awalHari(`${bulan}-01`));
      const capai = jual.filter((x) => x.tanggal < akhir).reduce((s, x) => s + x.nilai, 0);
      target = { bulan, target: nilaiTarget, capai, persen: Math.round((capai / nilaiTarget) * 100) };
    }
  }

  return { rencana, tokoMenurun: menurun.length, target };
}

/**
 * Sales yang dilaporkan: semua "salesman" (`daftarSalesman`) — juga yang tidak
 * berbuat apa-apa, justru itu yang perlu dilihat atasan — ditambah siapa pun
 * yang bukan SPG tapi punya kunjungan/pesanan/pelunasan di rentang, supaya
 * sales yang perannya sudah diubah tidak hilang dari laporan bulan lalu.
 */
async function salesUntukLaporan(b: Batas): Promise<{ id: string; nama: string }[]> {
  const rentang = { gte: b.mulai, lt: b.akhir };
  const [daftar, kunjungan, pesanan, klaim] = await Promise.all([
    daftarSalesman(),
    prisma.storeVisit.groupBy({ by: ["userId"], where: { checkinAt: rentang } }),
    prisma.fieldSalesOrder.groupBy({ by: ["salesmanId"], where: { createdAt: rentang } }),
    prisma.paymentClaim.groupBy({ by: ["salesmanId"], where: { createdAt: rentang } }),
  ]);
  const dikenal = new Set(daftar.map((s) => s.id));
  const lain = [
    ...new Set([...kunjungan.map((x) => x.userId), ...pesanan.map((x) => x.salesmanId), ...klaim.map((x) => x.salesmanId)]),
  ].filter((id) => !dikenal.has(id));
  if (lain.length === 0) return daftar;
  const tambahan = await prisma.user.findMany({
    // SPG: check-in mereka absensi, bukan kunjungan jualan.
    where: { id: { in: lain }, assignedStoreId: null },
    select: { id: true, name: true, email: true },
  });
  return [...daftar, ...tambahan.map((u) => ({ id: u.id, nama: u.name ?? u.email }))].sort((a, c) =>
    a.nama.localeCompare(c.nama, "id"),
  );
}

function barisKunjungan(bahan: BahanSales, sekarang: Date): BarisKunjunganLapangan[] {
  const rincian = rincianKunjungan(bahan, sekarang);
  return rincian.map((r, i) => {
    const v = bahan.kunjunganDb[i];
    return {
      ...r,
      toko: v.store.name,
      kodeToko: v.store.code,
      lat: angka(v.checkinLat),
      lng: angka(v.checkinLng),
      jarakMeter: v.checkinDistanceMeters,
      catatan: v.outcomeNote,
      ditutupOtomatis: v.autoClosed,
    };
  });
}

export type OpsiKinerja = {
  sekarang?: Date;
  /** Batasi ke sales ini saja (tes, atau kabar untuk sebagian sales). */
  salesmanIds?: string[];
  /** Muat rencana, toko menurun dan target (lebih berat). Bawaan: ya. */
  denganRencana?: boolean;
  /** Sertakan baris kunjungan per sales (untuk ekspor). */
  denganKunjungan?: boolean;
};

export type KinerjaTim = {
  baris: (KinerjaSales & { kunjungan?: BarisKunjunganLapangan[] })[];
  total: MetrikLapangan;
};

/** Semua sales untuk satu rentang — dasbor atasan, ekspor, kabar harian. */
export async function kinerjaSemuaSales(rentang: Rentang, opsi: OpsiKinerja = {}): Promise<KinerjaTim> {
  const sekarang = opsi.sekarang ?? new Date();
  const b = batasRentang(rentang);
  const sales = opsi.salesmanIds
    ? await namaPengguna(opsi.salesmanIds).then((nama) =>
        opsi.salesmanIds!.filter((id) => nama.has(id)).map((id) => ({ id, nama: nama.get(id) as string })),
      )
    : await salesUntukLaporan(b);
  const denganRencana = opsi.denganRencana ?? true;
  const ids = sales.map((s) => s.id);
  const [bahan, atur, jadwal] = await Promise.all([
    muatBahan(ids, b),
    denganRencana ? bacaPengaturan() : Promise.resolve(null),
    denganRencana ? muatJadwal(ids, rentang) : Promise.resolve(null),
  ]);

  const baris = await Promise.all(
    sales.map(async (s) => {
      const bs = bahan.get(s.id) ?? bahanKosong();
      const tambahan = atur
        ? await rencanaSales(s.id, rentang, bs, atur, sekarang)
        : { rencana: null, tokoMenurun: null, target: null };
      return {
        salesmanId: s.id,
        nama: s.nama,
        metrik: hitungMetrikLapangan(bs, rentang, sekarang),
        ...tambahan,
        jadwal: jadwal ? nilaiJadwal(s.id, jadwal.get(s.id), bs, sekarang).ringkas : null,
        ...(opsi.denganKunjungan ? { kunjungan: barisKunjungan(bs, sekarang) } : {}),
      };
    }),
  );
  return { baris, total: jumlahkanMetrik(baris.map((x) => x.metrik)) };
}

export type BarisJadwalRincian = {
  dayKey: string;
  storeId: string;
  nama: string;
  catatan: string | null;
  status: StatusJadwal;
};

export type RincianSales = {
  kinerja: KinerjaSales;
  kunjungan: BarisKunjunganLapangan[];
  /** Toko baru di rentang, bernama. */
  tokoBaru: { storeId: string; nama: string; sumber: TokoBaruBahan["sumber"] }[];
  /** Setiap toko yang dijadwalkan kantor di rentang, dengan statusnya. Urut hari. */
  jadwal: BarisJadwalRincian[];
};

/** Satu sales untuk satu rentang — layar "Hari ini" di HP dan rincian di dasbor atasan. */
export async function kinerjaSatuSales(
  salesmanId: string,
  rentang: Rentang,
  opsi: { sekarang?: Date } = {},
): Promise<RincianSales | null> {
  const sekarang = opsi.sekarang ?? new Date();
  const b = batasRentang(rentang);
  const [nama, bahan, atur, jadwalMentah] = await Promise.all([
    namaPengguna([salesmanId]),
    muatBahan([salesmanId], b),
    bacaPengaturan(),
    muatJadwal([salesmanId], rentang),
  ]);
  const namaSales = nama.get(salesmanId);
  if (!namaSales) return null;
  const bs = bahan.get(salesmanId) ?? bahanKosong();
  const tambahan = await rencanaSales(salesmanId, rentang, bs, atur, sekarang);
  const jadwal = nilaiJadwal(salesmanId, jadwalMentah.get(salesmanId), bs, sekarang);

  const tokoBaruDalam = new Map<string, TokoBaruBahan["sumber"]>();
  for (const t of bs.tokoBaru) {
    // Usulan menang atas pesanan pertama: tokonya ADA karena usulan sales ini.
    if (t.tanggal >= b.mulai && t.tanggal < b.akhir && tokoBaruDalam.get(t.storeId) !== "USULAN") {
      tokoBaruDalam.set(t.storeId, t.sumber);
    }
  }
  const idNamaToko = [...new Set([...tokoBaruDalam.keys(), ...jadwal.baris.map((j) => j.storeId)])];
  const namaToko = idNamaToko.length
    ? await prisma.store.findMany({ where: { id: { in: idNamaToko } }, select: { id: true, name: true } })
    : [];
  const petaNamaToko = new Map(namaToko.map((s) => [s.id, s.name]));

  return {
    kinerja: {
      salesmanId,
      nama: namaSales,
      metrik: hitungMetrikLapangan(bs, rentang, sekarang),
      ...tambahan,
      jadwal: jadwal.ringkas,
    },
    jadwal: jadwal.baris.map((j) => ({
      dayKey: j.dayKey,
      storeId: j.storeId,
      nama: petaNamaToko.get(j.storeId) ?? j.storeId,
      catatan: j.note,
      status: j.status,
    })),
    kunjungan: barisKunjungan(bs, sekarang),
    tokoBaru: [...tokoBaruDalam.entries()].map(([storeId, sumber]) => ({
      storeId,
      nama: petaNamaToko.get(storeId) ?? storeId,
      sumber,
    })),
  };
}
