import { Prisma, prisma } from "@elorae/db";
import { koordinatSah, kunciHariAbsen, putuskanAbsenCheckin, putuskanAbsenCheckout } from "./absensi";
import { pengaturanAbsensiDb } from "./absensi-queries";
import { runSerializable } from "@/lib/db/tx-retry";

/**
 * Absen SPG lewat check-in/check-out di toko tetapnya (lihat catatan di
 * `absensi.ts`). Dipanggil `checkIn`/`checkOut` (`app/pwa/stores/actions.ts`)
 * SESUDAH kunjungannya tercatat, dan tidak pernah melempar: absen adalah
 * pelengkap — gagal mencatatnya tidak boleh menggagalkan check-in yang membuka
 * penjualan.
 *
 * Jam diambil dari server (`sekarang` milik pemanggil), sama dengan jam
 * kunjungannya. Satu baris per orang per hari WIB: kunci unik yang menjaga,
 * jadi dua check-in yang berpacu tetap satu absen.
 */

export type HasilAbsenCheckin = "MASUK" | "BUKA_LAGI" | "LEWATI" | "GAGAL";

export async function absenMasukLewatCheckin(input: {
  userId: string;
  lat: number;
  lng: number;
  akurasi: number | null;
  sekarang: Date;
}): Promise<HasilAbsenCheckin> {
  const dayKey = kunciHariAbsen(input.sekarang);
  try {
    const [pengaturan, absen] = await Promise.all([
      pengaturanAbsensiDb(),
      prisma.attendance.findUnique({
        where: { userId_dayKey: { userId: input.userId, dayKey } },
        select: { id: true, clockOutAt: true },
      }),
    ]);
    const putusan = putuskanAbsenCheckin({ pengaturan, absen });
    if (putusan === "LEWATI") return "LEWATI";

    if (putusan === "BUKA_LAGI" && absen) {
      // Kembali ke toko sesudah check-out siang: harinya belum selesai. Jam
      // pulang diisi lagi oleh check-out berikutnya; kunjungannya sendiri
      // tetap tercatat lengkap di `StoreVisit`.
      await prisma.attendance.updateMany({
        where: { id: absen.id, clockOutAt: { not: null } },
        data: { clockOutAt: null, clockOutLat: null, clockOutLng: null },
      });
      return "BUKA_LAGI";
    }

    const adaLokasi = koordinatSah(input.lat, input.lng);
    await prisma.attendance.create({
      data: {
        userId: input.userId,
        dayKey,
        clockInAt: input.sekarang,
        clockInLat: adaLokasi ? input.lat : null,
        clockInLng: adaLokasi ? input.lng : null,
        clockInAccuracy: input.akurasi,
        // Check-in tidak memotret. Kalau swafoto wajib, kantor melihat tandanya (`tanpaSwafoto`).
        selfieUrl: null,
      },
    });
    return "MASUK";
  } catch (err) {
    // Check-in kembar yang berpacu: yang kedua menabrak kunci unik — absennya sudah ada.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "LEWATI";
    console.error("absenMasukLewatCheckin gagal", err);
    return "GAGAL";
  }
}

export type HasilAbsenCheckout = "PULANG" | "LEWATI" | "GAGAL";

/**
 * Check-out = absen pulang, bila hari ini sudah absen masuk dan belum pulang.
 * Lokasinya lokasi check-out. Hanya menutup yang masih terbuka: check-out
 * yang diketuk dua kali tidak menggeser jam pulangnya.
 */
export async function absenPulangLewatCheckout(input: {
  userId: string;
  lat: number;
  lng: number;
  sekarang: Date;
}): Promise<HasilAbsenCheckout> {
  const dayKey = kunciHariAbsen(input.sekarang);
  try {
    const absen = await prisma.attendance.findUnique({
      where: { userId_dayKey: { userId: input.userId, dayKey } },
      select: { id: true, clockOutAt: true },
    });
    if (putuskanAbsenCheckout(absen) === "LEWATI" || !absen) return "LEWATI";
    const adaLokasi = koordinatSah(input.lat, input.lng);
    const r = await prisma.attendance.updateMany({
      where: { id: absen.id, clockOutAt: null },
      data: {
        clockOutAt: input.sekarang,
        clockOutLat: adaLokasi ? input.lat : null,
        clockOutLng: adaLokasi ? input.lng : null,
      },
    });
    return r.count === 1 ? "PULANG" : "LEWATI";
  } catch (err) {
    console.error("absenPulangLewatCheckout gagal", err);
    return "GAGAL";
  }
}

// ─── Check-in / check-out tanpa sinyal yang tiba terlambat ──────────────────

const HARI_MS = 86_400_000;

/** Awal hari WIB berikutnya sesudah `dayKey` ("2026-09-30"). */
function akhirHariWib(dayKey: string): Date {
  return new Date(new Date(`${dayKey}T00:00:00+07:00`).getTime() + HARI_MS);
}

export type HasilAbsenKunjunganLampau = "MASUK" | "MAJU" | "LEWATI" | "GAGAL";

/**
 * Check-in tanpa sinyal yang tiba SESUDAH kunjungan yang lebih baru tercatat
 * (kunjungannya dicatat sudah selesai): absen hari itu tetap dicatat dari
 * waktu tangkapnya, dengan aturan check-in biasa — jam masuk = check-in
 * PERTAMA hari itu. Belum ada absen → dibuat; jam masuk yang ada lebih lambat
 * → dimajukan ke check-in ini; selain itu tidak berubah. Hari yang sudah
 * pulang TIDAK dibuka lagi: kunjungan ini sudah selesai.
 *
 * Idempoten (kiriman ulang menemukan absennya sudah sama) dan tidak pernah
 * melempar, seperti `absenMasukLewatCheckin`.
 */
export async function absenMasukKunjunganLampau(input: {
  userId: string;
  lat: number;
  lng: number;
  akurasi: number | null;
  waktu: Date;
}): Promise<HasilAbsenKunjunganLampau> {
  const dayKey = kunciHariAbsen(input.waktu);
  const adaLokasi = koordinatSah(input.lat, input.lng);
  const lokasi = {
    clockInLat: adaLokasi ? input.lat : null,
    clockInLng: adaLokasi ? input.lng : null,
    clockInAccuracy: input.akurasi,
  };
  const tulis = () =>
    runSerializable(async (tx): Promise<HasilAbsenKunjunganLampau> => {
      const absen = await tx.attendance.findUnique({
        where: { userId_dayKey: { userId: input.userId, dayKey } },
        select: { id: true, clockInAt: true },
      });
      if (!absen) {
        await tx.attendance.create({ data: { userId: input.userId, dayKey, clockInAt: input.waktu, selfieUrl: null, ...lokasi } });
        return "MASUK";
      }
      if (absen.clockInAt.getTime() <= input.waktu.getTime()) return "LEWATI";
      await tx.attendance.update({ where: { id: absen.id }, data: { clockInAt: input.waktu, ...lokasi } });
      return "MAJU";
    });
  try {
    const pengaturan = await pengaturanAbsensiDb();
    if (putuskanAbsenCheckin({ pengaturan, absen: null }) === "LEWATI") return "LEWATI";
    try {
      return await tulis();
    } catch (err) {
      // Dua kiriman berpacu membuat absen yang sama: yang kalah membaca milik pemenang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return await tulis();
      throw err;
    }
  } catch (err) {
    console.error("absenMasukKunjunganLampau gagal", err);
    return "GAGAL";
  }
}

/**
 * Check-out tanpa sinyal yang MELURUSKAN kunjungan yang tercatat selesai
 * otomatis (oleh check-in berikutnya): jam pulang hari check-in itu =
 * check-out TERAKHIR hari itu. Diisi — atau dimundurkan — hanya bila tidak ada
 * kunjungan lain hari itu yang dimulai sesudah kunjungan ini (check-out
 * kunjungan itulah yang menentukan jam pulang) dan jam pulang yang ada kosong
 * atau lebih awal. Belum ada absen hari itu → tidak ada yang dipulangkan.
 */
export async function absenPulangKoreksi(input: {
  userId: string;
  visitId: string;
  checkinAt: Date;
  lat: number;
  lng: number;
  waktuKeluar: Date;
}): Promise<HasilAbsenCheckout> {
  const dayKey = kunciHariAbsen(input.checkinAt);
  try {
    return await runSerializable(async (tx): Promise<HasilAbsenCheckout> => {
      const absen = await tx.attendance.findUnique({
        where: { userId_dayKey: { userId: input.userId, dayKey } },
        select: { id: true, clockOutAt: true },
      });
      if (!absen) return "LEWATI";
      if (absen.clockOutAt && absen.clockOutAt.getTime() >= input.waktuKeluar.getTime()) return "LEWATI";
      const sesudahnya = await tx.storeVisit.findFirst({
        where: { userId: input.userId, id: { not: input.visitId }, checkinAt: { gt: input.checkinAt, lt: akhirHariWib(dayKey) } },
        select: { id: true },
      });
      if (sesudahnya) return "LEWATI";
      const adaLokasi = koordinatSah(input.lat, input.lng);
      await tx.attendance.update({
        where: { id: absen.id },
        data: {
          clockOutAt: input.waktuKeluar,
          clockOutLat: adaLokasi ? input.lat : null,
          clockOutLng: adaLokasi ? input.lng : null,
        },
      });
      return "PULANG";
    });
  } catch (err) {
    console.error("absenPulangKoreksi gagal", err);
    return "GAGAL";
  }
}
