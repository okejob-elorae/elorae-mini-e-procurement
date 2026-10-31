import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";

/**
 * Batas laju API ekstensi pantau — jendela geser di memori proses, sama
 * dengan portal toko (alasan dan batasannya ditulis di
 * `lib/field-sales/portal-toko-batas.ts`: satu proses web di produksi; mulai
 * ulang mengosongkannya; N proses → N × batas).
 *
 * - Per token (dikunci hash-nya, dihitung SEBELUM basis data disentuh):
 *   120 permintaan per menit. Ekstensi yang sehat memakai beberapa per menit.
 * - `/sambung` per alamat IP: 20 per menit. Kode 8 tanda dari 31 huruf
 *   berlaku 15 menit — menebak lewat jalur ini tidak masuk akal.
 * - `/otomatis` per perangkat: 120 kiriman per jam. Panel mengirim sendiri
 *   setiap profil/video yang selesai dibacanya (ekstensi sudah membatasi satu
 *   kiriman per URL per 6 jam); ini rem untuk ekstensi yang rusak atau
 *   berputar, bukan pembukuan.
 */

export const MAKS_PERMINTAAN_TOKEN_PER_MENIT = 120;
export const MAKS_SAMBUNG_PER_MENIT = 20;
export const MAKS_OTOMATIS_PER_JAM = 120;

export const pembatasTokenPantau = buatPembatasJendela(MAKS_PERMINTAAN_TOKEN_PER_MENIT, 60_000);
export const pembatasSambungPantau = buatPembatasJendela(MAKS_SAMBUNG_PER_MENIT, 60_000);
export const pembatasOtomatisPantau = buatPembatasJendela(MAKS_OTOMATIS_PER_JAM, 3_600_000);
