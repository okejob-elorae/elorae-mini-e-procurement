/*
 * Bagian murni beranda SPG yang dipakai server DAN HP — tanpa basis data,
 * jadi aman diimpor komponen klien.
 */

const HARI_WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
const JAM_WIB = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const TANGGAL_JAM_WIB = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

/** "2026-10-07" — hari kalender Jakarta sebuah instant. */
export function hariWib(d: Date | number): string {
  return HARI_WIB.format(typeof d === "number" ? new Date(d) : d);
}

export type LabelMasuk = {
  /** Hari WIB check-in. */
  hari: string;
  /** Jam saja ("19.16"). */
  jam: string;
  /** Hari, tanggal, dan jam ("Senin, 5 Okt 19.16") — untuk check-in yang bukan hari ini. */
  tanggalJam: string;
};

/** Jam check-in dalam dua bentuk; pemanggil memilih menurut hari ini (`labelMasukUntuk`). */
export function labelMasuk(checkin: Date | number): LabelMasuk {
  const d = typeof checkin === "number" ? new Date(checkin) : checkin;
  return { hari: hariWib(d), jam: JAM_WIB.format(d), tanggalJam: TANGGAL_JAM_WIB.format(d) };
}

/** Teks jam masuk: jam saja bila check-in hari ini (WIB), selain itu dengan tanggalnya. */
export function labelMasukUntuk(l: LabelMasuk, hariIni: string): { lama: boolean; teks: string } {
  const lama = l.hari !== hariIni;
  return { lama, teks: lama ? l.tanggalJam : l.jam };
}

export type TataKunjungan = {
  /** Tombol Jual ditawarkan. */
  bisaJual: boolean;
  /** Tombol kunjungan (check-in, check-out, atau kartu kunjungan HP) di kartu absen. */
  tombolDiKartu: boolean;
  /** Tombol kunjungan paling bawah: check-out kunjungan server, atau kartu kunjungan HP. */
  tombolDiBawah: "SERVER" | "LOKAL" | null;
};

/**
 * Tata letak kunjungan di beranda SPG. Kunjungan dari hari lain (server, atau
 * check-in tanpa sinyal bila tidak ada kunjungan server) tidak membuka Jual dan
 * tombolnya tetap di kartu absen — check-out memang langkah berikutnya. Tombol
 * kunjungan dirender SEKALI: di kartu absen atau paling bawah, tidak keduanya.
 */
export function tataKunjunganBeranda(k: { server: { lama: boolean } | null; lokal: { lama: boolean } | null }): TataKunjungan {
  const lamaServer = k.server?.lama === true;
  const bisaJual = (k.server !== null && !(lamaServer && k.lokal === null)) || (k.lokal !== null && !k.lokal.lama);
  const diKartuSaja = lamaServer || (k.server === null && k.lokal?.lama === true);
  return {
    bisaJual,
    tombolDiKartu: !bisaJual || diKartuSaja,
    tombolDiBawah: diKartuSaja ? null : k.server ? "SERVER" : k.lokal ? "LOKAL" : null,
  };
}

/** Kunci kiriman yang sama dengan daftar Terima kiriman (`jenis:id`). */
export function kunciKiriman(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

/**
 * Kiriman yang masih menunggu diterima, dikurangi yang tanda terimanya sudah
 * tersimpan di HP ini (antrean tanpa sinyal, menunggu atau ditolak) — yang
 * itu sudah dihitung; yang gagal muncul di tugas "Belum terkirim".
 */
export function kirimanBelumDipegang(
  menunggu: readonly string[],
  dipegang: readonly { storeId?: string | null; sourceType: string; sourceId: string }[],
  storeId: string,
): number {
  const dihp = new Set(dipegang.filter((d) => !d.storeId || d.storeId === storeId).map((d) => kunciKiriman(d.sourceType, d.sourceId)));
  return new Set(menunggu).size - [...new Set(menunggu)].filter((k) => dihp.has(k)).length;
}

/**
 * Tanda terima yang tadi tersimpan di HP sudah lepas dari antrean (terkirim,
 * atau dihapus) padahal halaman ini masih menghitung kirimannya menunggu —
 * angka server di halaman sudah basi, jadi halaman dimuat ulang. Tanpa ini
 * angkanya naik lagi sesaat sesudah terkirim. `sebelum` null = bacaan pertama.
 */
export function kirimanLepasDariHp(
  sebelum: ReadonlySet<string> | null,
  kini: ReadonlySet<string>,
  menunggu: readonly string[],
): boolean {
  if (!sebelum) return false;
  const halaman = new Set(menunggu);
  for (const k of sebelum) if (!kini.has(k) && halaman.has(k)) return true;
  return false;
}
