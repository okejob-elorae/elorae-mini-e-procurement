import { kurangiHariKerja, tambahHariKerja, type KalenderKerja } from "./hari-kerja";

/*
 * Jadwal proses satu tahap Plan Kerja — bagian murni (2026-10-07).
 *
 * Meniru program SSG milik pemilik:
 *  - langkah disusun berurutan; langkah pertama mulai dari tanggal mulai tahap,
 *    setiap langkah berikutnya mulai dari tanggal selesai langkah sebelumnya;
 *  - lama tiap langkah dalam HARI KERJA (`tambahHariKerja`);
 *  - langkah yang SELESAI berjangkar pada tanggal selesai sebenarnya, jadi
 *    selesai lebih cepat/lambat menggeser semua langkah sesudahnya;
 *    langkah yang baru PROSES tidak menggeser apa pun;
 *  - mode mundur: tanggal mulai dicari dari tenggat (`mulaiDariTenggat`).
 * Lama langkah per qty dihitung sebanding (`computeStepDays`, lib/leadtime).
 */

export type StatusLangkah = "BELUM" | "PROSES" | "SELESAI";

export type LangkahJadwal = {
  durationDays: number;
  status: StatusLangkah;
  /** "YYYY-MM-DD"; hanya dipakai bila status SELESAI. */
  doneDate: string | null;
};

/** Tanggal selesai (target) tiap langkah, berurutan, dari tanggal mulai tahap. */
export function susunTanggal(langkah: readonly LangkahJadwal[], mulai: string, kal: KalenderKerja): string[] {
  let kursor = mulai;
  return langkah.map((l) => {
    const target =
      l.status === "SELESAI" && l.doneDate ? l.doneDate : tambahHariKerja(kursor, Math.max(0, l.durationDays), kal);
    kursor = target;
    return target;
  });
}

export function totalHariJadwal(langkah: readonly Pick<LangkahJadwal, "durationDays">[]): number {
  return langkah.reduce((s, l) => s + Math.max(0, l.durationDays), 0);
}

/** Mode mundur: tanggal mulai supaya rantai `totalHari` hari kerja selesai tepat di `tenggat`. */
export function mulaiDariTenggat(totalHari: number, tenggat: string, kal: KalenderKerja): string {
  return kurangiHariKerja(tenggat, totalHari, kal);
}

export type KeadaanLangkah = "SELESAI" | "TELAT" | "HARI_INI" | "MENDATANG";

/** "Telat" baru sesudah harinya lewat (WIB) — tidak pernah pada hari itu sendiri. */
export function keadaanLangkah(status: StatusLangkah, targetDate: string, hariIni: string): KeadaanLangkah {
  if (status === "SELESAI") return "SELESAI";
  if (targetDate < hariIni) return "TELAT";
  if (targetDate === hariIni) return "HARI_INI";
  return "MENDATANG";
}

export type RingkasanJadwal = {
  jumlah: number;
  selesai: number;
  telat: number;
  /** Langkah pertama (urutan) yang belum selesai. */
  berikutnya: { name: string; targetDate: string; keadaan: KeadaanLangkah } | null;
  /** Target langkah terakhir = perkiraan tahap selesai. */
  selesaiPada: string | null;
};

export function ringkasJadwal(
  langkah: readonly { name: string; status: StatusLangkah; targetDate: string }[],
  hariIni: string,
): RingkasanJadwal {
  let selesai = 0;
  let telat = 0;
  let berikutnya: RingkasanJadwal["berikutnya"] = null;
  for (const l of langkah) {
    const k = keadaanLangkah(l.status, l.targetDate, hariIni);
    if (k === "SELESAI") selesai += 1;
    if (k === "TELAT") telat += 1;
    if (!berikutnya && k !== "SELESAI") berikutnya = { name: l.name, targetDate: l.targetDate, keadaan: k };
  }
  return {
    jumlah: langkah.length,
    selesai,
    telat,
    berikutnya,
    selesaiPada: langkah.length > 0 ? langkah[langkah.length - 1].targetDate : null,
  };
}
