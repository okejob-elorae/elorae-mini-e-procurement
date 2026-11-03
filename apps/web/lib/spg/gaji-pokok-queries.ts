import { prisma, type Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { wibMonthRange } from "@/lib/spg-commission/laporan-queries";
import { shiftYearMonth } from "@/lib/spg-commission/recap-display";
import {
  bacaDetailGaji,
  gajiBulananBerlaku,
  hariDinilaiGaji,
  hitungGajiPokok,
  jumlahHariBulan,
  masaKerjaBulan,
  pesertaGajiBulan,
  susunDasarHari,
  type BekuGaji,
  type HasilGaji,
  type JenisHari,
  type StatusCatatanHadirGaji,
  type StatusJadwalBulanGaji,
} from "./gaji-pokok";

/**
 * Pemuat gaji pokok SPG — semua masukan `hitungGajiPokok` (`lib/spg/gaji-pokok.ts`) dari basis data,
 * untuk banyak SPG × bulan sekaligus. Klien boleh transaksi: penulis kunci konsinyasi, "Tetapkan"
 * toko putus, dan pembayaran membacanya di dalam `runSerializable`-nya, jadi yang dihitung dan yang
 * ditulis melihat satu keadaan.
 *
 * Tidak ada yang ditulis di sini, dan tidak ada sapuan seluruh basis data: setiap pembaca dibatasi
 * ke SPG × bulan yang diminta.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);
const bulanDari = (tahun: number, bulan: number) => `${tahun}-${String(bulan).padStart(2, "0")}`;

/** Kunci peta `muatGajiPokok`: satu SPG × satu bulan kerja. */
export const kunciGaji = (userId: string, bulan: string) => `${userId}\u0000${bulan}`;
/** Kunci peta `muatPesertaGaji`: satu toko × satu bulan. */
export const kunciTokoBulan = (storeId: string, bulan: string) => `${storeId}\u0000${bulan}`;

const JENIS_IZIN_GAJI = ["IZIN", "SAKIT", "CUTI"];

/**
 * Gaji pokok setiap SPG × bulan yang diminta (B12, B15, B16). `beku` = bagian rincian bulan yang
 * sudah dibayar (`bekuDariRincian` atas `salaryDetail` tersimpan): masa, "penuh", dan pembaginya
 * tidak dihitung ulang. Toko = toko tetap SPG itu; sel jadwal dan check-in di toko lain tidak
 * dihitung.
 */
export async function muatGajiPokok(
  klien: Klien,
  pasangan: ReadonlyArray<{ userId: string; storeId: string; bulan: string; beku?: BekuGaji | null }>,
): Promise<Map<string, HasilGaji>> {
  const hasil = new Map<string, HasilGaji>();
  const daftar = pasangan.filter((p) => p.userId && p.storeId && /^\d{4}-\d{2}$/.test(p.bulan));
  if (daftar.length === 0) return hasil;
  const users = [...new Set(daftar.map((p) => p.userId))];
  const bulanSemua = [...new Set(daftar.map((p) => p.bulan))].sort();
  const bulanAwal = bulanSemua[0];
  const bulanAkhir = bulanSemua[bulanSemua.length - 1];
  const hariAwal = `${bulanAwal}-01`;
  const hariAkhir = `${bulanAkhir}-${String(jumlahHariBulan(bulanAkhir)).padStart(2, "0")}`;

  const [orang, gaji, kepala, catatan, sel, kunjungan, izin, setelan] = await Promise.all([
    klien.user.findMany({ where: { id: { in: users } }, select: { id: true, spgStartedOn: true, spgEndedOn: true } }),
    klien.spgSalary.findMany({ where: { userId: { in: users } }, select: { userId: true, effectiveFrom: true, monthlyAmount: true } }),
    klien.spgMonthSchedule.findMany({ where: { userId: { in: users }, month: { in: bulanSemua } }, select: { userId: true, month: true, status: true } }),
    klien.spgAttendanceRecord.findMany({
      where: { userId: { in: users }, month: { in: bulanSemua } },
      select: { userId: true, month: true, status: true, days: { select: { day: true, kind: true, present: true } } },
    }),
    klien.spgShift.findMany({
      where: { userId: { in: users }, day: { gte: hariAwal, lte: hariAkhir } },
      select: { userId: true, storeId: true, day: true, kind: true },
    }),
    klien.storeVisit.findMany({
      where: { userId: { in: users }, checkinAt: { gte: wibMonthRange(bulanAwal).start, lt: wibMonthRange(bulanAkhir).end } },
      select: { userId: true, storeId: true, checkinAt: true, checkinOutOfRadius: true },
    }),
    klien.leaveRequest.findMany({
      where: { userId: { in: users }, status: "DISETUJUI", type: { in: JENIS_IZIN_GAJI }, startDay: { lte: hariAkhir }, endDay: { gte: hariAwal } },
      select: { userId: true, type: true, startDay: true, endDay: true },
    }),
    klien.systemSetting.findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } }),
  ]);
  const hariKerjaSpg = bacaHariKerjaSpg(setelan?.value);
  const orangPer = new Map(orang.map((o) => [o.id, o]));
  const kepalaPer = new Map(kepala.map((k) => [kunciGaji(k.userId, k.month), k.status as StatusJadwalBulanGaji]));
  const catatanPer = new Map(catatan.map((c) => [kunciGaji(c.userId, c.month), c]));
  const gajiPer = new Map<string, { effectiveFrom: string; monthlyAmount: number }[]>();
  for (const g of gaji) gajiPer.set(g.userId, [...(gajiPer.get(g.userId) ?? []), { effectiveFrom: g.effectiveFrom, monthlyAmount: angka(g.monthlyAmount) }]);

  for (const p of daftar) {
    const o = orangPer.get(p.userId);
    const masa = masaKerjaBulan(p.bulan, o?.spgStartedOn ?? null, o?.spgEndedOn ?? null);
    // Bulan yang sudah dibayar dinilai atas masa bekunya, bukan masa sekarang (`hariDinilaiGaji`).
    const hari = hariDinilaiGaji(masa, p.beku);
    const selBulan = new Map<string, JenisHari>();
    for (const s of sel) {
      if (s.userId !== p.userId || s.storeId !== p.storeId || !s.day.startsWith(`${p.bulan}-`)) continue;
      if (s.kind === "KERJA" || s.kind === "LIBUR") selBulan.set(s.day, s.kind);
    }
    const checkin = new Map<string, { luarRadius: boolean }>();
    for (const v of kunjungan) {
      if (v.userId !== p.userId || v.storeId !== p.storeId) continue;
      const d = kunciHariWib(v.checkinAt);
      if (!d.startsWith(`${p.bulan}-`)) continue;
      const ada = checkin.get(d);
      // Hari itu dihitung "di luar radius" hanya kalau SETIAP check-in-nya di luar radius.
      checkin.set(d, { luarRadius: ada ? ada.luarRadius && v.checkinOutOfRadius : v.checkinOutOfRadius });
    }
    const c = catatanPer.get(kunciGaji(p.userId, p.bulan)) ?? null;
    const statusCatatan = (c?.status ?? null) as StatusCatatanHadirGaji | null;
    const catatanDiperiksa =
      c && statusCatatan === "DIPERIKSA"
        ? new Map(
            c.days
              .filter((d) => d.kind === "KERJA" || d.kind === "LIBUR")
              .map((d) => [d.day, { kind: d.kind as JenisHari, present: d.present }] as const),
          )
        : null;
    const statusJadwal = kepalaPer.get(kunciGaji(p.userId, p.bulan)) ?? null;
    const { dasar, tanpaDasar } = susunDasarHari({ hari, statusJadwal, sel: selBulan, catatanDiperiksa, checkin });
    hasil.set(
      kunciGaji(p.userId, p.bulan),
      hitungGajiPokok({
        bulan: p.bulan,
        gajiBulanan: gajiBulananBerlaku(gajiPer.get(p.userId) ?? [], p.bulan),
        mulaiDiisi: Boolean(o?.spgStartedOn),
        masa,
        dasar,
        tanpaDasar,
        statusJadwal,
        sel: selBulan,
        statusCatatan,
        izin: izin.filter((z) => z.userId === p.userId),
        userId: p.userId,
        hariKerjaSpg,
        beku: p.beku ?? null,
      }),
    );
  }
  return hasil;
}

/** Bulan kerja setiap SPG yang punya baris gaji & komisi SUDAH dibayar (konsinyasi atau putus). */
export async function bulanGajiDibayar(klien: Klien, userIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const hasil = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  if (ids.length === 0) return hasil;
  const [konsi, putus] = await Promise.all([
    klien.consignmentCommission.findMany({
      where: { spgUserId: { in: ids }, paidAt: { not: null } },
      select: { spgUserId: true, cycle: { select: { periodYear: true, periodMonth: true } } },
    }),
    klien.spgCommission.findMany({ where: { userId: { in: ids }, paidAt: { not: null } }, select: { userId: true, period: true } }),
  ]);
  for (const k of konsi) hasil.get(k.spgUserId)?.add(bulanDari(k.cycle.periodYear, k.cycle.periodMonth));
  for (const p of putus) hasil.get(p.userId)?.add(p.period);
  return hasil;
}

/**
 * Peserta gaji setiap toko × bulan yang diminta (B19): pemegang kepala jadwal bulan itu, penjual di
 * toko itu bulan itu, pemilik catatan check-in, dan setiap orang yang masa tugasnya di toko itu
 * menyentuh bulan itu (tanggal mulai wajib diisi). Setiap peserta mendapat tepat satu baris saat
 * siklus dikunci atau bulan putusnya ditetapkan, walau komisinya nol.
 */
export async function muatPesertaGaji(klien: Klien, pasangan: ReadonlyArray<{ storeId: string; bulan: string }>): Promise<Map<string, string[]>> {
  const hasil = new Map<string, string[]>();
  const daftar = [...new Map(pasangan.filter((p) => p.storeId && /^\d{4}-\d{2}$/.test(p.bulan)).map((p) => [kunciTokoBulan(p.storeId, p.bulan), p])).values()];
  if (daftar.length === 0) return hasil;
  const toko = [...new Set(daftar.map((p) => p.storeId))];
  const bulanSemua = [...new Set(daftar.map((p) => p.bulan))];
  const [kepala, catatan, tugas, penjualPerBulan] = await Promise.all([
    klien.spgMonthSchedule.findMany({ where: { storeId: { in: toko }, month: { in: bulanSemua } }, select: { userId: true, storeId: true, month: true } }),
    klien.spgAttendanceRecord.findMany({ where: { storeId: { in: toko }, month: { in: bulanSemua } }, select: { userId: true, storeId: true, month: true } }),
    klien.user.findMany({
      where: { OR: [{ assignedStoreId: { in: toko } }, { spgEndedStoreId: { in: toko } }] },
      select: { id: true, assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true },
    }),
    Promise.all(
      bulanSemua.map(async (bulan) => {
        const { start, end } = wibMonthRange(bulan);
        const grup = await klien.spgSale.groupBy({ by: ["storeId", "salesmanId"], where: { storeId: { in: toko }, createdAt: { gte: start, lt: end } } });
        return [bulan, grup] as const;
      }),
    ),
  ]);
  const penjual = new Map(penjualPerBulan);
  for (const p of daftar) {
    const tokoTugas = (u: (typeof tugas)[number]) => u.assignedStoreId ?? u.spgEndedStoreId;
    hasil.set(
      kunciTokoBulan(p.storeId, p.bulan),
      pesertaGajiBulan({
        bulan: p.bulan,
        jadwal: kepala.filter((k) => k.storeId === p.storeId && k.month === p.bulan).map((k) => k.userId),
        penjual: (penjual.get(p.bulan) ?? []).filter((g) => g.storeId === p.storeId).map((g) => g.salesmanId),
        catatan: catatan.filter((c) => c.storeId === p.storeId && c.month === p.bulan).map((c) => c.userId),
        tugas: tugas.filter((u) => tokoTugas(u) === p.storeId).map((u) => ({ userId: u.id, mulai: u.spgStartedOn, akhir: u.spgEndedOn })),
      }),
    );
  }
  return hasil;
}

/**
 * Setiap toko × bulan tempat seorang SPG menjadi peserta gaji (B28): bulan masa tugasnya di tokonya
 * (dari bulan mulai sampai bulan berhenti, atau bulan berjalan), bulan yang punya kepala jadwal
 * atau catatan check-in, dan bulan tempat ia menjual.
 */
export async function bulanPesertaSpg(klien: Klien, userId: string, sekarang: Date = new Date()): Promise<{ storeId: string; bulan: string }[]> {
  const u = await klien.user.findUnique({ where: { id: userId }, select: { assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true } });
  const storeId = u?.assignedStoreId ?? u?.spgEndedStoreId ?? null;
  if (!u || !storeId) return [];
  const [kepala, catatan, jual] = await Promise.all([
    klien.spgMonthSchedule.findMany({ where: { userId, storeId }, select: { month: true } }),
    klien.spgAttendanceRecord.findMany({ where: { userId, storeId }, select: { month: true } }),
    klien.spgSale.aggregate({ where: { salesmanId: userId, storeId }, _min: { createdAt: true }, _max: { createdAt: true } }),
  ]);
  const bulan = new Set<string>([...kepala.map((k) => k.month), ...catatan.map((c) => c.month)]);
  const batasAkhir = u.spgEndedOn ? u.spgEndedOn.slice(0, 7) : bulanWib(sekarang);
  const rentang = (dari: string, sampai: string) => {
    for (let m = dari; m <= sampai; m = shiftYearMonth(m, 1)) bulan.add(m);
  };
  if (u.spgStartedOn) rentang(u.spgStartedOn.slice(0, 7), batasAkhir);
  if (jual._min?.createdAt && jual._max?.createdAt) {
    // Bulan di antara nota pertama dan terakhir bisa tanpa nota; hanya membuat satu bulan ikut diperiksa.
    rentang(bulanWib(jual._min.createdAt), bulanWib(jual._max.createdAt));
  }
  return [...bulan]
    .filter((b) => b <= batasAkhir)
    .sort()
    .map((b) => ({ storeId, bulan: b }));
}

export type BarisGajiBulananSpg = {
  userId: string;
  nama: string;
  storeId: string | null;
  namaToko: string | null;
  mulai: string | null;
  berhenti: string | null;
  riwayat: { effectiveFrom: string; jumlah: number }[];
  /** Bulan kerja terakhir yang SUDAH dibayar — gaji bulan itu dan sebelumnya dikunci. */
  bulanDibayarTerakhir: string | null;
  bulanDibayar: string[];
};

/** Kartu Pengaturan → Komisi SPG #gaji-pokok: setiap SPG (masih bertugas maupun sudah berhenti). */
export async function daftarGajiBulananSpg(klien: Klien = prisma): Promise<BarisGajiBulananSpg[]> {
  const orang = await klien.user.findMany({
    where: { OR: [{ assignedStoreId: { not: null } }, { spgEndedStoreId: { not: null } }] },
    select: { id: true, name: true, email: true, assignedStoreId: true, spgEndedStoreId: true, spgStartedOn: true, spgEndedOn: true },
  });
  const ids = orang.map((o) => o.id);
  const tokoIds = [...new Set(orang.map((o) => o.assignedStoreId ?? o.spgEndedStoreId).filter((x): x is string => Boolean(x)))];
  const [gaji, toko, dibayar] = await Promise.all([
    ids.length ? klien.spgSalary.findMany({ where: { userId: { in: ids } }, orderBy: [{ effectiveFrom: "asc" }], select: { userId: true, effectiveFrom: true, monthlyAmount: true } }) : [],
    tokoIds.length ? klien.store.findMany({ where: { id: { in: tokoIds } }, select: { id: true, name: true } }) : [],
    bulanGajiDibayar(klien, ids),
  ]);
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  return orang
    .map((o) => {
      const storeId = o.assignedStoreId ?? o.spgEndedStoreId;
      const bulanBayar = [...(dibayar.get(o.id) ?? [])].sort();
      return {
        userId: o.id,
        nama: o.name?.trim() || o.email,
        storeId,
        namaToko: storeId ? (namaToko.get(storeId) ?? null) : null,
        mulai: o.spgStartedOn,
        berhenti: o.spgEndedOn,
        riwayat: gaji.filter((g) => g.userId === o.id).map((g) => ({ effectiveFrom: g.effectiveFrom, jumlah: angka(g.monthlyAmount) })),
        bulanDibayarTerakhir: bulanBayar.length ? bulanBayar[bulanBayar.length - 1] : null,
        bulanDibayar: bulanBayar,
      };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama) || (a.userId < b.userId ? -1 : 1));
}

/** Rincian tersimpan di `salaryDetail`, atau null. Satu pembaca untuk HP, kantor, dan cetak. */
export const detailGajiBaris = bacaDetailGaji;
