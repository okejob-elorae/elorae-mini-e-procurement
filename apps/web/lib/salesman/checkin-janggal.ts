import { haversineMeters } from "@/lib/geo/haversine";

/**
 * Tanda check-in yang janggal — murni, tanpa basis data.
 *
 * PENTING: aplikasi web TIDAK BISA mendeteksi aplikasi pemalsu GPS. Browser
 * hanya memberi angka koordinat + akurasi; ia tidak memberi tahu apakah angka
 * itu dari satelit atau dari aplikasi "fake GPS". Yang bisa dilakukan hanya
 * membaca tanda-tanda ANOMALI di angka itu, lalu memperlihatkannya ke kantor.
 * Tanda di sini TIDAK PERNAH menolak check-in — hanya bahan pemeriksaan:
 *
 * - AKURASI_BURUK: HP sendiri melaporkan posisinya tidak pasti (> batas pemilik).
 * - AKURASI_TIDAK_ADA: HP tidak melaporkan akurasi sama sekali (aplikasi lama
 *   yang belum diperbarui juga masuk sini).
 * - LOMPATAN_MUSTAHIL: dari titik terakhir yang diketahui (check-out, atau
 *   check-in bila check-out tanpa koordinat) ke sini butuh kecepatan
 *   > 150 km/j untuk jarak > 2 km.
 * - KOORDINAT_KEMBAR: koordinat sama persis sampai 6 desimal (≈ 11 cm) dengan
 *   check-in di toko LAIN dalam 30 hari. GPS sungguhan tidak pernah jatuh di
 *   titik yang sama persis dua kali; titik yang dipakai ulang khas pemalsu GPS.
 */

export const KECEPATAN_MUSTAHIL_KMJ = 150;
export const JARAK_LOMPATAN_MIN_METER = 2000;
export const HARI_KOORDINAT_KEMBAR = 30;
const SKALA_KEMBAR = 1e6;
/** Batas atas akurasi yang disimpan — kolomnya `Int`. */
const AKURASI_SIMPAN_MAKS = 1_000_000;

export type TandaCheckin =
  | { kode: "AKURASI_BURUK"; akurasiMeter: number; batasMeter: number }
  | { kode: "AKURASI_TIDAK_ADA" }
  | { kode: "LOMPATAN_MUSTAHIL"; jarakMeter: number; menit: number; kecepatanKmj: number | null }
  | { kode: "KOORDINAT_KEMBAR"; storeId: string; namaToko: string | null; waktu: string };

export type KodeTandaCheckin = TandaCheckin["kode"];

export type Titik = { lat: number; lng: number; waktu: Date };

/** Kunjungan sebelumnya pengguna ini, dalam bentuk kolom `StoreVisit` (angka, bukan Decimal). */
export type KunjunganSebelumnya = {
  checkinLat: number;
  checkinLng: number;
  checkinAt: Date;
  checkoutLat: number | null;
  checkoutLng: number | null;
  checkoutAt: Date | null;
};

export type MasukanCheckinJanggal = {
  storeId: string;
  lat: number;
  lng: number;
  /** Waktu server saat check-in — bukan jam HP, yang bisa diatur. */
  waktu: Date;
  akurasiMeter: number | null;
  batasAkurasiMeter: number;
  sebelumnya: KunjunganSebelumnya | null;
  /** Check-in pengguna ini belakangan (boleh lebih luas dari 30 hari — disaring di sini). */
  checkinTerbaru: { storeId: string; namaToko: string | null; lat: number; lng: number; waktu: Date }[];
};

/** Akurasi dari browser → meter bulat, atau `null` bila tidak ada / tidak masuk akal. */
export function normalkanAkurasi(x: unknown): number | null {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return null;
  return Math.min(Math.round(x), AKURASI_SIMPAN_MAKS);
}

/** Titik terakhir yang diketahui dari kunjungan sebelumnya. */
export function titikTerakhir(k: KunjunganSebelumnya | null): Titik | null {
  if (!k) return null;
  if (k.checkoutAt && k.checkoutLat !== null && k.checkoutLng !== null) {
    return { lat: k.checkoutLat, lng: k.checkoutLng, waktu: k.checkoutAt };
  }
  return { lat: k.checkinLat, lng: k.checkinLng, waktu: k.checkinAt };
}

const kunciKembar = (lat: number, lng: number) => `${Math.round(lat * SKALA_KEMBAR)}:${Math.round(lng * SKALA_KEMBAR)}`;

export function nilaiCheckinJanggal(m: MasukanCheckinJanggal): TandaCheckin[] {
  const tanda: TandaCheckin[] = [];

  if (m.akurasiMeter === null) {
    tanda.push({ kode: "AKURASI_TIDAK_ADA" });
  } else if (m.akurasiMeter > m.batasAkurasiMeter) {
    tanda.push({ kode: "AKURASI_BURUK", akurasiMeter: m.akurasiMeter, batasMeter: m.batasAkurasiMeter });
  }

  const titik = titikTerakhir(m.sebelumnya);
  if (titik) {
    const jarakMeter = Math.round(haversineMeters(titik, { lat: m.lat, lng: m.lng }));
    if (jarakMeter > JARAK_LOMPATAN_MIN_METER) {
      const selisihMs = m.waktu.getTime() - titik.waktu.getTime();
      if (selisihMs <= 0) {
        tanda.push({ kode: "LOMPATAN_MUSTAHIL", jarakMeter, menit: 0, kecepatanKmj: null });
      } else {
        const kecepatan = jarakMeter / 1000 / (selisihMs / 3_600_000);
        if (kecepatan > KECEPATAN_MUSTAHIL_KMJ) {
          tanda.push({
            kode: "LOMPATAN_MUSTAHIL",
            jarakMeter,
            menit: Math.round(selisihMs / 60_000),
            kecepatanKmj: Math.round(kecepatan),
          });
        }
      }
    }
  }

  const sejak = m.waktu.getTime() - HARI_KOORDINAT_KEMBAR * 86_400_000;
  const kunci = kunciKembar(m.lat, m.lng);
  const kembar = m.checkinTerbaru
    .filter((c) => c.storeId !== m.storeId && c.waktu.getTime() >= sejak && kunciKembar(c.lat, c.lng) === kunci)
    .sort((a, b) => b.waktu.getTime() - a.waktu.getTime())[0];
  if (kembar) {
    tanda.push({
      kode: "KOORDINAT_KEMBAR",
      storeId: kembar.storeId,
      namaToko: kembar.namaToko,
      waktu: kembar.waktu.toISOString(),
    });
  }

  return tanda;
}

const angka = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Kolom JSON `StoreVisit.checkinFlags` → tanda yang sah. Entri rusak atau
 * kode tak dikenal dibuang diam-diam: layar riwayat tidak boleh pecah karena
 * satu baris lama.
 */
export function bacaTandaCheckin(json: unknown): TandaCheckin[] {
  if (!Array.isArray(json)) return [];
  const hasil: TandaCheckin[] = [];
  for (const x of json) {
    if (!x || typeof x !== "object") continue;
    const t = x as Record<string, unknown>;
    switch (t.kode) {
      case "AKURASI_BURUK":
        if (angka(t.akurasiMeter) && angka(t.batasMeter)) {
          hasil.push({ kode: "AKURASI_BURUK", akurasiMeter: t.akurasiMeter, batasMeter: t.batasMeter });
        }
        break;
      case "AKURASI_TIDAK_ADA":
        hasil.push({ kode: "AKURASI_TIDAK_ADA" });
        break;
      case "LOMPATAN_MUSTAHIL":
        if (angka(t.jarakMeter) && angka(t.menit) && (t.kecepatanKmj === null || angka(t.kecepatanKmj))) {
          hasil.push({
            kode: "LOMPATAN_MUSTAHIL",
            jarakMeter: t.jarakMeter,
            menit: t.menit,
            kecepatanKmj: t.kecepatanKmj as number | null,
          });
        }
        break;
      case "KOORDINAT_KEMBAR":
        if (typeof t.storeId === "string" && typeof t.waktu === "string") {
          hasil.push({
            kode: "KOORDINAT_KEMBAR",
            storeId: t.storeId,
            namaToko: typeof t.namaToko === "string" ? t.namaToko : null,
            waktu: t.waktu,
          });
        }
        break;
      default:
        break;
    }
  }
  return hasil;
}
