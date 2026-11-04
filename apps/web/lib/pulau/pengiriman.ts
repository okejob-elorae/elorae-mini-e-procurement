/*
 * Kapan pulau status menyebut "Mengirim…" — murni, dipakai pemantau sinyal
 * kantor (`OfflineIndicator`) dan HP (`PemantauLuringHp`).
 *
 * "Mengirim…" hanya untuk pengiriman yang ditunggu orang: sinyal kembali
 * sementara antrean masih berisi, atau tombol kirim ulang diketuk. Sinkron
 * diam-diam saat aplikasi dibuka lagi tidak memunculkan apa pun. Pengiriman
 * berhenti saat antrean habis, saat tidak ada perubahan lagi ("tenang"), atau
 * saat batas waktunya lewat — sisanya lalu tampil sebagai "N belum terkirim".
 */

export type KeadaanKirim = { luring: boolean; mengirim: boolean; belum: number };

export type PeristiwaKirim =
  | { jenis: "luring" }
  | { jenis: "daring" }
  | { jenis: "hitung"; belum: number }
  | { jenis: "kirimUlang" }
  | { jenis: "tenang" }
  | { jenis: "batas" };

export function awalKirim(daring: boolean, belum: number): KeadaanKirim {
  return { luring: !daring, mengirim: false, belum: Math.max(0, belum) };
}

export function langkahKirim(k: KeadaanKirim, p: PeristiwaKirim): KeadaanKirim {
  switch (p.jenis) {
    case "luring":
      return { ...k, luring: true, mengirim: false };
    case "daring":
      return { ...k, luring: false, mengirim: k.belum > 0 };
    case "hitung": {
      const belum = Math.max(0, p.belum);
      return { ...k, belum, mengirim: k.mengirim && !k.luring && belum > 0 };
    }
    case "kirimUlang":
      return k.luring || k.belum === 0 ? k : { ...k, mengirim: true };
    case "tenang":
    case "batas":
      return k.mengirim ? { ...k, mengirim: false } : k;
  }
}
