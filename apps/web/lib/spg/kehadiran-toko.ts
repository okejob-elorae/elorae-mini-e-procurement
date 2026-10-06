import { prisma } from "@elorae/db";
import { batasHariIniWib } from "@/lib/dashboard/hari-wib";
import { bacaHariKerjaSpg, izinPadaHari, KUNCI_HARI_KERJA_SPG, type JenisIzin } from "@/lib/salesman/izin";
import { izinDisetujuiRentang } from "@/lib/salesman/izin-queries";

/**
 * Kehadiran SPG sebuah toko HARI INI (hari kalender WIB), untuk salesman yang
 * membuka halaman toko itu: siapa sudah datang dan pukul berapa, siapa sudah
 * pulang, siapa izin, siapa libur menurut jadwal, siapa tidak ditunggu karena
 * hari ini bukan hari kerja SPG (Pengaturan → `spg.hariKerja`), siapa belum
 * datang. Jadwal shift hari itu mengalahkan pengaturan hari kerja.
 *
 * SPG = pengguna dengan `assignedStoreId` toko ini — sama dengan
 * `ambilTokoTetap`, bukan nama peran. Hadir = check-in di toko ini hari ini;
 * kunjungan kemarin yang lupa ditutup bukan bukti hadir hari ini. Datang
 * mengalahkan izin dan libur: yang datang tetap tercatat datang.
 *
 * Tanpa rupiah apa pun — kartunya hanya nama, keadaan, dan jam.
 */

export type KeadaanHadir = "DI_TOKO" | "PULANG" | "IZIN" | "LIBUR" | "BUKAN_HARI_KERJA" | "BELUM";

export type KehadiranSpg = {
  userId: string;
  nama: string;
  keadaan: KeadaanHadir;
  /** Check-in pertama hari ini. */
  masuk: Date | null;
  /** Check-out terakhir — hanya bila semua kunjungan hari ini sudah ditutup. */
  pulang: Date | null;
  jenisIzin: JenisIzin | null;
  /** Jam mulai shift hari ini ("14:00") bila dijadwalkan kerja. */
  jadwalMulai: string | null;
};

type Kunjungan = { userId: string; checkinAt: Date; checkoutAt: Date | null };
type Shift = { userId: string; kind: string; startTime: string | null };

/** Aturan murni: satu baris per SPG dari kunjungan, izin, dan jadwal hari itu. */
export function susunKehadiran(m: {
  spg: { id: string; nama: string }[];
  kunjungan: Kunjungan[];
  izin: { userId: string; type: string; startDay: string; endDay: string }[];
  shift: Shift[];
  hari: string;
  /** Hari ini hari kerja SPG menurut pengaturan (`spg.hariKerja`). */
  hariKerja: boolean;
}): KehadiranSpg[] {
  return m.spg
    .map((s): KehadiranSpg => {
      const milik = m.kunjungan
        .filter((k) => k.userId === s.id)
        .sort((a, b) => a.checkinAt.getTime() - b.checkinAt.getTime());
      const shift = m.shift.find((x) => x.userId === s.id) ?? null;
      const jadwalMulai = shift?.kind === "KERJA" ? shift.startTime : null;
      const dasar = { userId: s.id, nama: s.nama, jadwalMulai };
      if (milik.length > 0) {
        const masuk = milik[0].checkinAt;
        const masihDiToko = milik.some((k) => k.checkoutAt === null);
        const pulang = masihDiToko
          ? null
          : new Date(Math.max(...milik.map((k) => (k.checkoutAt as Date).getTime())));
        return { ...dasar, keadaan: masihDiToko ? "DI_TOKO" : "PULANG", masuk, pulang, jenisIzin: null };
      }
      const jenisIzin = izinPadaHari(
        m.izin.filter((i) => i.userId === s.id),
        m.hari,
      );
      if (jenisIzin) return { ...dasar, keadaan: "IZIN", masuk: null, pulang: null, jenisIzin };
      if (shift?.kind === "LIBUR") return { ...dasar, keadaan: "LIBUR", masuk: null, pulang: null, jenisIzin: null };
      // Tanpa jadwal KERJA hari itu, hari yang bukan hari kerja SPG tidak menunggu siapa pun.
      if (!m.hariKerja && shift?.kind !== "KERJA") {
        return { ...dasar, keadaan: "BUKAN_HARI_KERJA", masuk: null, pulang: null, jenisIzin: null };
      }
      return { ...dasar, keadaan: "BELUM", masuk: null, pulang: null, jenisIzin: null };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

/**
 * SPG toko ini beserta keadaannya hari ini (WIB). Toko tanpa SPG → [].
 * `hariKerjaSpg` (0 = Minggu) hanya untuk tes; bawaannya dibaca dari pengaturan.
 */
export async function kehadiranSpgToko(
  storeId: string,
  sekarang: Date = new Date(),
  opsi?: { hariKerjaSpg?: readonly number[] },
): Promise<KehadiranSpg[]> {
  const orang = await prisma.user.findMany({
    where: { assignedStoreId: storeId },
    select: { id: true, name: true, email: true },
  });
  if (orang.length === 0) return [];
  const ids = orang.map((o) => o.id);
  const { awal, akhir, tanggal } = batasHariIniWib(sekarang);
  const [kunjungan, izin, shift, hariKerjaSpg] = await Promise.all([
    prisma.storeVisit.findMany({
      where: { storeId, userId: { in: ids }, checkinAt: { gte: awal, lte: akhir } },
      select: { userId: true, checkinAt: true, checkoutAt: true },
    }),
    izinDisetujuiRentang(ids, tanggal, tanggal),
    prisma.spgShift.findMany({
      where: { userId: { in: ids }, day: tanggal },
      select: { userId: true, kind: true, startTime: true },
    }),
    opsi?.hariKerjaSpg ??
      prisma.systemSetting
        .findUnique({ where: { key: KUNCI_HARI_KERJA_SPG }, select: { value: true } })
        .then((s) => bacaHariKerjaSpg(s?.value)),
  ]);
  const hariMinggu = new Date(`${tanggal}T00:00:00Z`).getUTCDay();
  return susunKehadiran({
    spg: orang.map((o) => ({ id: o.id, nama: o.name ?? o.email })),
    kunjungan,
    izin,
    shift,
    hari: tanggal,
    hariKerja: hariKerjaSpg.includes(hariMinggu),
  });
}

/** Jam diformat di server, WIB — format di klien bisa berbeda antara Node dan Safari. */
const JAM_WIB = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export type KehadiranSpgTampil = {
  userId: string;
  nama: string;
  keadaan: KeadaanHadir;
  /** "08.15" (WIB). */
  masuk: string | null;
  pulang: string | null;
  jenisIzin: JenisIzin | null;
  jadwalMulai: string | null;
};

/** Bentuk yang dikirim ke HP: jam sudah berupa teks WIB. */
export function tampilKehadiran(baris: readonly KehadiranSpg[]): KehadiranSpgTampil[] {
  return baris.map((b) => ({
    userId: b.userId,
    nama: b.nama,
    keadaan: b.keadaan,
    masuk: b.masuk ? JAM_WIB.format(b.masuk) : null,
    pulang: b.pulang ? JAM_WIB.format(b.pulang) : null,
    jenisIzin: b.jenisIzin,
    jadwalMulai: b.jadwalMulai,
  }));
}
