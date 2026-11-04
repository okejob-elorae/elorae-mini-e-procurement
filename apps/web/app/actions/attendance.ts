"use server";

import { revalidatePath } from "next/cache";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import * as XLSX from "xlsx";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { bacaBulan } from "@/lib/salesman/biaya";
import {
  bolehMelihatAbsensi,
  koordinatSah,
  kunciHariAbsen,
  periksaMasuk,
  periksaPulang,
  type KodeTolakMasuk,
} from "@/lib/salesman/absensi";
import { absensiBulan, pengaturanAbsensiDb } from "@/lib/salesman/absensi-queries";

/**
 * Absen masuk / pulang dari HP, dan ekspor bulanan untuk kantor.
 *
 * Satu baris per orang per hari WIB — `@@unique([userId, dayKey])` yang
 * menjaga, bukan pemeriksaan di sini saja. Jam diambil dari SERVER, bukan
 * dari HP: jam HP bisa diputar mundur.
 */

const bolehAbsen = (izin: string[] | undefined) => (izin ?? []).includes("pwa:access");

const segarkan = () => {
  revalidatePath("/pwa");
  revalidatePath("/pwa/absen");
  revalidatePath("/backoffice/absensi");
};

export type HasilAbsenMasuk = { ok: true } | { ok: false; kode: KodeTolakMasuk | "TANPA_AKSES" | "GAGAL" };

export async function absenMasukAction(input: {
  selfieUrl?: string | null;
  lat: number | null;
  lng: number | null;
  akurasi?: number | null;
  catatan?: string | null;
}): Promise<HasilAbsenMasuk> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !bolehAbsen(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  // SPG absen lewat check-in di tokonya (`lib/salesman/absensi-writer.ts`); absen
  // manual dari HP akan menjadi jalur kedua yang tidak terikat lokasi toko.
  if (await ambilTokoTetap(userId)) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input !== "object") return { ok: false, kode: "GAGAL" };

  const sekarang = new Date();
  const dayKey = kunciHariAbsen(sekarang);
  try {
    const [pengaturan, ada] = await Promise.all([
      pengaturanAbsensiDb(),
      prisma.attendance.findUnique({ where: { userId_dayKey: { userId, dayKey } }, select: { id: true } }),
    ]);
    const periksa = periksaMasuk({
      pengaturan,
      sudahMasuk: ada !== null,
      selfieUrl: input.selfieUrl,
      lat: input.lat,
      lng: input.lng,
      akurasi: input.akurasi,
      catatan: input.catatan,
    });
    if (!periksa.ok) return { ok: false, kode: periksa.kode };

    const n = periksa.nilai;
    await prisma.attendance.create({
      data: {
        userId,
        dayKey,
        clockInAt: sekarang,
        clockInLat: n.lat,
        clockInLng: n.lng,
        clockInAccuracy: n.akurasi,
        selfieUrl: n.selfieUrl,
        note: n.catatan,
      },
    });
    segarkan();
    return { ok: true };
  } catch (err) {
    // Dua ketukan yang berpacu: yang kedua menabrak kunci unik — absennya
    // sudah tercatat oleh yang pertama.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, kode: "SUDAH_MASUK" };
    }
    console.error("absenMasukAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilAbsenPulang = { ok: true } | { ok: false; kode: "BELUM_MASUK" | "SUDAH_PULANG" | "TANPA_AKSES" | "GAGAL" };

/**
 * Lokasi pulang boleh kosong: pulang tanpa sinyal GPS lebih baik tercatat jam
 * pulangnya daripada tidak tercatat sama sekali.
 */
export async function absenPulangAction(input: { lat?: number | null; lng?: number | null }): Promise<HasilAbsenPulang> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !bolehAbsen(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  const sekarang = new Date();
  const dayKey = kunciHariAbsen(sekarang);
  try {
    const absen = await prisma.attendance.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
      select: { id: true, clockOutAt: true },
    });
    const periksa = periksaPulang(absen);
    if (!periksa.ok || !absen) return { ok: false, kode: periksa.ok ? "BELUM_MASUK" : periksa.kode };

    const adaLokasi = koordinatSah(input?.lat, input?.lng);
    // Hanya menutup yang masih terbuka: dua ketukan tidak menggeser jam pulang.
    const r = await prisma.attendance.updateMany({
      where: { id: absen.id, clockOutAt: null },
      data: {
        clockOutAt: sekarang,
        clockOutLat: adaLokasi ? (input.lat as number) : null,
        clockOutLng: adaLokasi ? (input.lng as number) : null,
      },
    });
    if (r.count !== 1) return { ok: false, kode: "SUDAH_PULANG" };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("absenPulangAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

// ─── Ekspor ──────────────────────────────────────────────────────────────────

/** Teks kolom dari klien — lihat catatan yang sama di `expense-claims.ts`. */
export type LabelEksporAbsensi = {
  judul: string;
  kolom: {
    tanggal: string;
    nama: string;
    masuk: string;
    pulang: string;
    terlambat: string;
    lamaKerja: string;
    akurasi: string;
    petaMasuk: string;
    petaPulang: string;
    swafoto: string;
    catatan: string;
  };
  rekap: string;
  kolomRekap: { nama: string; hadir: string; terlambat: string; menitTerlambat: string; tanpaPulang: string };
  ada: string;
};

export type HasilEksporAbsensi = { ok: true; base64: string; filename: string } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

const teks = (x: unknown, cadangan: string): string => (typeof x === "string" && x.trim() ? x.slice(0, 200) : cadangan);

export async function eksporAbsensiExcelAction(input: { bulan: string; label: LabelEksporAbsensi }): Promise<HasilEksporAbsensi> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelihatAbsensi(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const bulan = bacaBulan(input?.bulan, new Date());
    const L = input?.label ?? ({} as LabelEksporAbsensi);
    const k = L.kolom ?? ({} as LabelEksporAbsensi["kolom"]);
    const kr = L.kolomRekap ?? ({} as LabelEksporAbsensi["kolomRekap"]);
    const data = await absensiBulan(bulan);
    type Sel = string | number;

    const detail: Sel[][] = [
      [`${teks(L.judul, "Absensi")} — ${bulan}`],
      [],
      [
        teks(k.tanggal, "Tanggal"),
        teks(k.nama, "Nama"),
        teks(k.masuk, "Masuk"),
        teks(k.pulang, "Pulang"),
        teks(k.terlambat, "Terlambat (menit)"),
        teks(k.lamaKerja, "Lama kerja (menit)"),
        teks(k.akurasi, "Akurasi GPS (m)"),
        teks(k.petaMasuk, "Lokasi masuk"),
        teks(k.petaPulang, "Lokasi pulang"),
        teks(k.swafoto, "Swafoto"),
        teks(k.catatan, "Catatan"),
      ],
      ...data.baris.map((b): Sel[] => [
        b.dayKey,
        b.nama,
        b.masuk ?? "",
        b.pulang ?? "",
        b.menitTerlambat,
        b.lamaKerja ?? "",
        b.akurasi ?? "",
        b.petaMasuk ?? "",
        b.petaPulang ?? "",
        b.selfieUrl ? teks(L.ada, "Ada") : "",
        b.catatan ?? "",
      ]),
    ];
    const rekap: Sel[][] = [
      [`${teks(L.rekap, "Rekap")} — ${bulan}`],
      [],
      [
        teks(kr.nama, "Nama"),
        teks(kr.hadir, "Hari hadir"),
        teks(kr.terlambat, "Hari terlambat"),
        teks(kr.menitTerlambat, "Total menit terlambat"),
        teks(kr.tanpaPulang, "Tanpa absen pulang"),
      ],
      ...data.rekap.map((r): Sel[] => [r.nama, r.hadir, r.terlambat, r.menitTerlambat, r.tanpaPulang]),
    ];

    const wb = XLSX.utils.book_new();
    const wsRekap = XLSX.utils.aoa_to_sheet(rekap);
    wsRekap["!cols"] = [24, 12, 14, 20, 18].map((wch) => ({ wch }));
    const wsDetail = XLSX.utils.aoa_to_sheet(detail);
    wsDetail["!cols"] = [12, 22, 8, 8, 16, 16, 14, 40, 40, 10, 30].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, wsRekap, teks(L.rekap, "Rekap").slice(0, 31));
    XLSX.utils.book_append_sheet(wb, wsDetail, bulan);
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    return { ok: true, base64: buffer.toString("base64"), filename: `absensi-${bulan}.xlsx` };
  } catch (err) {
    console.error("eksporAbsensiExcelAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}
