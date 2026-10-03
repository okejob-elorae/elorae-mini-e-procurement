import { Prisma, prisma } from "@elorae/db";
import { koordinatSah, kunciHariAbsen, putuskanAbsenCheckin, putuskanAbsenCheckout } from "./absensi";
import { pengaturanAbsensiDb } from "./absensi-queries";

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
