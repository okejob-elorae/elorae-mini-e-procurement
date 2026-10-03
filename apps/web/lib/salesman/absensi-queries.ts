import { prisma } from "@elorae/db";
import { daftarSalesman, daftarSpg } from "./queries";
import { hariTidakKerjaPengguna, hariTidakKerjaSatu, izinDisetujuiRentang } from "./izin-queries";
import { HARI_TIDAK_KERJA, hitungHariIzinBulan, izinPadaHari, petaHariIzin, type HitungIzin, type JenisIzin } from "./izin";
import {
  bacaPengaturanAbsensi,
  KUNCI_PENGATURAN_ABSENSI,
  kunciHariAbsen,
  lamaKerjaMenit,
  menitTerlambat,
  ringkasBulanAbsen,
  susunHariBulan,
  tanpaSwafoto,
  tautanPeta,
  type DataKartuAbsen,
  type PengaturanAbsensi,
  type RingkasanAbsen,
} from "./absensi";

/**
 * Bacaan absensi. `Attendance` tidak punya relasi Prisma, jadi nama orang
 * digabung dengan kueri kedua. Jam dan tanggal diformat DI SERVER (WIB) dan
 * dikirim sebagai teks — format di klien bisa berbeda antara Node dan Safari.
 */

export async function pengaturanAbsensiDb(): Promise<PengaturanAbsensi> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KUNCI_PENGATURAN_ABSENSI }, select: { value: true } });
  return bacaPengaturanAbsensi(row?.value);
}

const JAM = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
export const jamWib = (d: Date) => JAM.format(d);

/** "Sen, 29 Sep" — label hari untuk riwayat. */
export function labelHari(dayKey: string): string {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${dayKey}T12:00:00Z`),
  );
}

/** "Rabu, 30 September 2026" — label hari lengkap untuk judul. */
export function labelHariPanjang(dayKey: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dayKey}T12:00:00Z`));
}

const angka = (d: { toString(): string } | null): number | null => (d === null ? null : Number(d.toString()));

const PILIH = {
  id: true,
  userId: true,
  dayKey: true,
  clockInAt: true,
  clockInLat: true,
  clockInLng: true,
  clockInAccuracy: true,
  selfieUrl: true,
  clockOutAt: true,
  clockOutLat: true,
  clockOutLng: true,
  note: true,
} as const;

// ─── HP ──────────────────────────────────────────────────────────────────────

/**
 * Kartu absen di beranda salesman. `null` = tidak ditampilkan: absensi mati
 * DAN hari ini belum ada absen DAN hari ini tidak sedang izin. Kalau absensi
 * dimatikan sesudah ia absen masuk, kartunya tetap ada supaya ia bisa absen
 * pulang. Hari yang izinnya disetujui menampilkan "Hari ini Anda cuti", bukan
 * tombol absen masuk.
 */
export async function absenBeranda(userId: string, sekarang: Date): Promise<DataKartuAbsen | null> {
  const dayKey = kunciHariAbsen(sekarang);
  const [pengaturan, absen, izin] = await Promise.all([
    pengaturanAbsensiDb(),
    prisma.attendance.findUnique({ where: { userId_dayKey: { userId, dayKey } }, select: PILIH }),
    izinDisetujuiRentang([userId], dayKey, dayKey),
  ]);
  const izinHariIni = izinPadaHari(izin, dayKey);
  if (!pengaturan.aktif && !absen && !izinHariIni) return null;
  return {
    aktif: pengaturan.aktif,
    selfieWajib: pengaturan.selfieWajib,
    jamMasukPaling: pengaturan.jamMasukPaling,
    masuk: absen ? { jam: jamWib(absen.clockInAt), menitTerlambat: menitTerlambat(absen.clockInAt, pengaturan.jamMasukPaling) } : null,
    pulang: absen?.clockOutAt ? { jam: jamWib(absen.clockOutAt) } : null,
    lamaKerja: absen ? lamaKerjaMenit(absen.clockInAt, absen.clockOutAt) : null,
    izinHariIni,
  };
}

/** Hari terakhir bulan "YYYY-MM" yang sudah terjadi (bulan berjalan: hari ini). */
function sampaiHari(bulan: string, hariIni: string): string {
  const [y, m] = bulan.split("-").map(Number);
  const akhir = `${bulan}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return akhir < hariIni ? akhir : hariIni;
}

export type HariRiwayatAbsen = {
  dayKey: string;
  label: string;
  hadir: boolean;
  masuk: string | null;
  pulang: string | null;
  menitTerlambat: number;
  lamaKerja: number | null;
  catatan: string | null;
  /** Hari kosong yang izinnya disetujui — tampil Izin/Sakit/Cuti, bukan "Tidak absen". */
  izin: JenisIzin | null;
};

export async function riwayatAbsenSaya(
  userId: string,
  bulan: string,
  sekarang: Date,
): Promise<{ hari: HariRiwayatAbsen[]; ringkasan: RingkasanAbsen; izin: HitungIzin; pengaturan: PengaturanAbsensi }> {
  const [pengaturan, rows, izinRows, libur] = await Promise.all([
    pengaturanAbsensiDb(),
    prisma.attendance.findMany({ where: { userId, dayKey: { startsWith: `${bulan}-` } }, select: PILIH }),
    izinDisetujuiRentang([userId], `${bulan}-01`, `${bulan}-31`),
    hariTidakKerjaSatu(userId),
  ]);
  const hariIni = kunciHariAbsen(sekarang);
  const peta = petaHariIzin(izinRows, bulan);
  // Hari kerja orangnya sendiri: Minggu di tengah cuti SPG adalah hari kerja yang ia tinggalkan.
  const izin = hitungHariIzinBulan(peta, new Set(rows.map((r) => r.dayKey)), sampaiHari(bulan, hariIni), libur);
  const hari = susunHariBulan(bulan, rows, pengaturan.jamMasukPaling, hariIni, peta).map((h) => ({
    dayKey: h.dayKey,
    label: labelHari(h.dayKey),
    hadir: h.hadir,
    masuk: h.absen ? jamWib(h.absen.clockInAt) : null,
    pulang: h.absen?.clockOutAt ? jamWib(h.absen.clockOutAt) : null,
    menitTerlambat: h.menitTerlambat,
    lamaKerja: h.absen ? lamaKerjaMenit(h.absen.clockInAt, h.absen.clockOutAt) : null,
    catatan: h.absen?.note ?? null,
    izin: h.izin,
  }));
  return { hari, ringkasan: ringkasBulanAbsen(rows, pengaturan.jamMasukPaling), izin, pengaturan };
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

export type BarisAbsenKantor = {
  userId: string;
  nama: string;
  dayKey: string;
  masuk: string | null;
  pulang: string | null;
  menitTerlambat: number;
  lamaKerja: number | null;
  selfieUrl: string | null;
  petaMasuk: string | null;
  petaPulang: string | null;
  akurasi: number | null;
  catatan: string | null;
  /** Belum absen tapi izinnya hari itu disetujui. */
  izin: JenisIzin | null;
  /** SPG: absennya mengikuti check-in di toko tetapnya. */
  spg: boolean;
  /** Absen masuk tanpa swafoto padahal swafoto wajib (SPG lewat check-in). */
  tanpaSwafoto: boolean;
};

/**
 * Orang lapangan yang DIHARAPKAN absen: semua salesman dan semua SPG (yang
 * belum absen justru yang dicari atasan). Nama SPG membawa tokonya.
 */
async function orangDiharapkan(): Promise<{ id: string; nama: string; spg: boolean }[]> {
  const [salesman, spg] = await Promise.all([daftarSalesman(), daftarSpg()]);
  return [
    ...salesman.map((s) => ({ id: s.id, nama: s.nama, spg: false })),
    ...spg.map((s) => ({ id: s.id, nama: s.tokoNama ? `${s.nama} · ${s.tokoNama}` : s.nama, spg: true })),
  ];
}

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

type BarisDb = {
  userId: string;
  dayKey: string;
  clockInAt: Date;
  clockInLat: { toString(): string } | null;
  clockInLng: { toString(): string } | null;
  clockInAccuracy: number | null;
  selfieUrl: string | null;
  clockOutAt: Date | null;
  clockOutLat: { toString(): string } | null;
  clockOutLng: { toString(): string } | null;
  note: string | null;
};

function barisKantor(a: BarisDb, nama: string, pengaturan: PengaturanAbsensi, spg: boolean): BarisAbsenKantor {
  const jamMasukPaling = pengaturan.jamMasukPaling;
  return {
    spg,
    tanpaSwafoto: tanpaSwafoto(a, pengaturan),
    userId: a.userId,
    nama,
    dayKey: a.dayKey,
    masuk: jamWib(a.clockInAt),
    pulang: a.clockOutAt ? jamWib(a.clockOutAt) : null,
    menitTerlambat: menitTerlambat(a.clockInAt, jamMasukPaling),
    lamaKerja: lamaKerjaMenit(a.clockInAt, a.clockOutAt),
    selfieUrl: a.selfieUrl,
    petaMasuk: tautanPeta(angka(a.clockInLat), angka(a.clockInLng)),
    petaPulang: tautanPeta(angka(a.clockOutLat), angka(a.clockOutLng)),
    akurasi: a.clockInAccuracy,
    catatan: a.note,
    izin: null,
  };
}

/**
 * Satu hari: SEMUA salesman dan SPG — yang belum absen justru yang dicari
 * atasan — ditambah siapa pun yang absen atau izin hari itu walau bukan
 * keduanya. Yang izinnya disetujui ditandai, bukan "belum absen".
 */
export async function absensiHari(dayKey: string): Promise<{ baris: BarisAbsenKantor[]; pengaturan: PengaturanAbsensi }> {
  const [pengaturan, salesman, rows, izinRows] = await Promise.all([
    pengaturanAbsensiDb(),
    orangDiharapkan(),
    prisma.attendance.findMany({ where: { dayKey }, select: PILIH }),
    izinDisetujuiRentang(null, dayKey, dayKey),
  ]);
  const dikenal = new Map(salesman.map((s) => [s.id, s.nama]));
  const spg = new Set(salesman.filter((s) => s.spg).map((s) => s.id));
  const lain = await namaPengguna(
    [...rows.map((r) => r.userId), ...izinRows.map((r) => r.userId)].filter((id) => !dikenal.has(id)),
  );
  const perOrang = new Map(rows.map((r) => [r.userId, r]));
  const izinOrang = (id: string) => izinPadaHari(izinRows.filter((r) => r.userId === id), dayKey);

  const orang = [...salesman.map((s) => ({ id: s.id, nama: s.nama })), ...[...lain].map(([id, nama]) => ({ id, nama }))];
  const baris = orang.map((o) => {
    const a = perOrang.get(o.id);
    if (a) return barisKantor(a, o.nama, pengaturan, spg.has(o.id));
    return {
      spg: spg.has(o.id),
      tanpaSwafoto: false,
      userId: o.id,
      nama: o.nama,
      dayKey,
      masuk: null,
      pulang: null,
      menitTerlambat: 0,
      lamaKerja: null,
      selfieUrl: null,
      petaMasuk: null,
      petaPulang: null,
      akurasi: null,
      catatan: null,
      izin: izinOrang(o.id),
    };
  });
  // Yang sudah absen dulu (urut jam masuk), lalu yang belum, lalu yang izin — urut nama.
  const urutan = (b: BarisAbsenKantor) => (b.masuk ? 0 : b.izin ? 2 : 1);
  baris.sort((x, y) => {
    if (x.masuk && y.masuk) return x.masuk.localeCompare(y.masuk);
    return urutan(x) - urutan(y) || x.nama.localeCompare(y.nama);
  });
  return { baris, pengaturan };
}

/** `izin` = hari KERJA izin/sakit/cuti yang disetujui dan sudah lewat (lihat `hitungHariIzinBulan`). */
export type RekapOrangBulan = { userId: string; nama: string; izin: HitungIzin } & RingkasanAbsen;

/** Satu bulan: rekap per orang + semua baris (untuk Excel). */
export async function absensiBulan(
  bulan: string,
  sekarang: Date = new Date(),
): Promise<{
  rekap: RekapOrangBulan[];
  baris: BarisAbsenKantor[];
  pengaturan: PengaturanAbsensi;
}> {
  const [pengaturan, salesman, rows, izinRows] = await Promise.all([
    pengaturanAbsensiDb(),
    orangDiharapkan(),
    prisma.attendance.findMany({
      where: { dayKey: { startsWith: `${bulan}-` } },
      select: PILIH,
      orderBy: [{ dayKey: "asc" }, { clockInAt: "asc" }],
    }),
    izinDisetujuiRentang(null, `${bulan}-01`, `${bulan}-31`),
  ]);
  const dikenal = new Map(salesman.map((s) => [s.id, s.nama]));
  const lain = await namaPengguna(
    [...rows.map((r) => r.userId), ...izinRows.map((r) => r.userId)].filter((id) => !dikenal.has(id)),
  );
  const nama = (id: string) => dikenal.get(id) ?? lain.get(id) ?? "—";
  const spgIds = new Set(salesman.filter((s) => s.spg).map((s) => s.id));

  const perOrang = new Map<string, typeof rows>();
  for (const r of rows) perOrang.set(r.userId, [...(perOrang.get(r.userId) ?? []), r]);
  const sampai = sampaiHari(bulan, kunciHariAbsen(sekarang));
  const izinOrang = (id: string, hadir: typeof rows) =>
    hitungHariIzinBulan(
      petaHariIzin(izinRows.filter((r) => r.userId === id), bulan),
      new Set(hadir.map((r) => r.dayKey)),
      sampai,
      liburPer.get(id) ?? HARI_TIDAK_KERJA,
    );
  const ids = [...salesman.map((s) => s.id), ...[...lain.keys()]];
  const liburPer = await hariTidakKerjaPengguna(ids);
  const rekap = ids
    .map((id) => {
      const milik = perOrang.get(id) ?? [];
      return { userId: id, nama: nama(id), izin: izinOrang(id, milik), ...ringkasBulanAbsen(milik, pengaturan.jamMasukPaling) };
    })
    .sort((x, y) => x.nama.localeCompare(y.nama));

  return {
    rekap,
    baris: rows.map((r) => barisKantor(r, nama(r.userId), pengaturan, spgIds.has(r.userId))),
    pengaturan,
  };
}
