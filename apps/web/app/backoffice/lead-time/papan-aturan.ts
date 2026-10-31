/*
 * Lead time → bagian murni layar (aman untuk klien, tanpa Prisma):
 * format angka setempat, ringkasan lama rantai pemasok, catatan pemasok yang
 * tidak tampil di papan, dan apakah melepas langkah ikut membuang pengaturan.
 */

/** Locale angka layar: `en` → en-GB (sama dengan `formatDisplayDate`), selain itu id-ID. */
export function localeAngka(locale: string): string {
  return locale.startsWith("en") ? "en-GB" : "id-ID";
}

/** Angka dengan pemisah setempat: 10000 → "10.000", 1.43 (1 desimal) → "1,4". */
export function formatAngka(n: number, locale: string, maksDesimal = 0): string {
  return new Intl.NumberFormat(localeAngka(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maksDesimal,
  }).format(n);
}

/** Total hari rantai dalam hari, minggu (÷7) dan bulan (÷30), sudah diformat. */
export function ringkasLamaRantai(totalHari: number, locale: string): { hari: string; minggu: string; bulan: string } {
  return {
    hari: formatAngka(totalHari, locale),
    minggu: formatAngka(totalHari / 7, locale, 1),
    bulan: formatAngka(totalHari / 30, locale, 1),
  };
}

export type StatusPemasok = "PENDING_APPROVAL" | "ACTIVE" | "REJECTED";

/** Satu baris `groupBy(status, isActive)` pemasok. */
export type BarisStatusPemasok = { status: StatusPemasok; isActive: boolean; jumlah: number };

export type JenisTersembunyi = "menunggu" | "nonaktif" | "ditolak";

export type PemasokTersembunyi = Record<JenisTersembunyi, number>;

/**
 * Papan pemasok hanya memuat pemasok `isActive && status = ACTIVE`
 * (`getAllSupplierChains`). Sisanya dihitung SEKALI per pemasok:
 * nonaktif lebih dulu (apa pun statusnya, sama dengan `?aktif=nonaktif`),
 * lalu yang aktif dipilah menurut status persetujuan.
 */
export function hitungPemasokTersembunyi(baris: readonly BarisStatusPemasok[]): PemasokTersembunyi {
  const hasil: PemasokTersembunyi = { menunggu: 0, nonaktif: 0, ditolak: 0 };
  for (const b of baris) {
    if (b.jumlah <= 0) continue;
    if (!b.isActive) hasil.nonaktif += b.jumlah;
    else if (b.status === "PENDING_APPROVAL") hasil.menunggu += b.jumlah;
    else if (b.status === "REJECTED") hasil.ditolak += b.jumlah;
  }
  return hasil;
}

export function totalTersembunyi(r: PemasokTersembunyi): number {
  return r.menunggu + r.nonaktif + r.ditolak;
}

/** Daftar pemasok tersaring untuk tiap kelompok yang tidak tampil di papan. */
export const ALAMAT_PEMASOK_TERSEMBUNYI: Record<JenisTersembunyi, string> = {
  menunggu: "/backoffice/suppliers?status=PENDING_APPROVAL",
  nonaktif: "/backoffice/suppliers?aktif=nonaktif",
  ditolak: "/backoffice/suppliers?status=REJECTED",
};

const URUTAN_TERSEMBUNYI: readonly JenisTersembunyi[] = ["menunggu", "nonaktif", "ditolak"];

/** Bagian catatan yang bukan nol, berurutan; kosong = semua pemasok tampil (tanpa catatan). */
export function bagianPemasokTersembunyi(
  r: PemasokTersembunyi,
): Array<{ jenis: JenisTersembunyi; jumlah: number; href: string }> {
  return URUTAN_TERSEMBUNYI.filter((j) => r[j] > 0).map((jenis) => ({
    jenis,
    jumlah: r[jenis],
    href: ALAMAT_PEMASOK_TERSEMBUNYI[jenis],
  }));
}

/**
 * Melepas langkah menghapus barisnya. Kalau langkah itu membawa lama khusus
 * atau catatan, pengaturan itu ikut hilang (tidak bisa dipasang ulang dari
 * pustaka) — hanya saat itu pelepasan diperlakukan sebagai penghapusan.
 */
export function lepasMembuangPengaturan(langkah: {
  overrideDays: number | null;
  overrideRateQty: number | null;
  notes: string | null;
}): boolean {
  return langkah.overrideDays != null || langkah.overrideRateQty != null || (langkah.notes ?? "").trim() !== "";
}
