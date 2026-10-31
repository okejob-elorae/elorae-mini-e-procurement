/**
 * Halaman mana yang sedang dibuka, menurut pohon menu — murni, tanpa React.
 *
 * Dipakai kepala halaman kantor (nama halaman di bilah atas) dan menu samping
 * (tautan aktif + `aria-current`). Satu definisi supaya keduanya tidak pernah
 * menunjuk entri yang berbeda.
 */

export interface EntriMenu {
  href: string;
  labelKey: string;
  children?: readonly { href: string; labelKey: string }[];
}

/** `pathname` berada di `href` itu sendiri atau di bawahnya. */
export function cocokRute(pathname: string, href: string): boolean {
  if (!href || href === "#") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Entri menu untuk `pathname`: kecocokan terpanjang menang, dan bila panjangnya
 * SAMA, anak menang atas induknya.
 *
 * Induk grup sering berbagi href dengan anak pertamanya (Laporan dan Neraca
 * Saldo, Data Master dan Pemasok, Tim Lapangan dan Ringkasan sales). Dulu induk
 * yang menang, jadi kepala halaman menyebut nama grup di halaman pertama setiap
 * grup dan nama halaman di halaman lainnya.
 */
export function entriHalamanAktif(
  pathname: string,
  items: readonly EntriMenu[],
): { href: string; labelKey: string } | null {
  let terbaik: { href: string; labelKey: string } | null = null;
  for (const item of items) {
    const kandidat = [
      ...(item.children ?? []).map((c) => ({ href: c.href, labelKey: c.labelKey })),
      { href: item.href, labelKey: item.labelKey },
    ];
    for (const k of kandidat) {
      if (!cocokRute(pathname, k.href)) continue;
      if (!terbaik || k.href.length > terbaik.href.length) terbaik = k;
    }
  }
  return terbaik;
}

/**
 * Berapa piksel wadah gulir harus digeser supaya elemen terlihat utuh, dengan
 * sedikit ruang di tepinya. 0 bila sudah terlihat. Positif = gulir ke bawah.
 *
 * Bukan `scrollIntoView`: itu ikut menggulir SEMUA leluhur yang bisa digulir,
 * termasuk dokumen kantor yang sengaja `overflow: hidden`, sehingga halaman
 * bisa ikut bergeser.
 */
export function geserAgarTerlihat(
  wadah: { top: number; bottom: number },
  elemen: { top: number; bottom: number },
  ruang = 24,
): number {
  const tinggiWadah = wadah.bottom - wadah.top;
  const tinggiElemen = elemen.bottom - elemen.top;
  if (tinggiElemen + ruang * 2 > tinggiWadah) {
    // Elemen lebih tinggi dari wadah: cukup sejajarkan atasnya.
    return elemen.top - wadah.top - ruang;
  }
  if (elemen.bottom > wadah.bottom) return elemen.bottom - wadah.bottom + ruang;
  if (elemen.top < wadah.top) return elemen.top - wadah.top - ruang;
  return 0;
}

/**
 * Berapa piksel wadah gulir halaman (`<main>`) harus digeser supaya jangkar
 * `#…` berada di atas wadah, dengan ruang kecil. Positif = gulir ke bawah.
 */
export function geserKeJangkar(wadahTop: number, jangkarTop: number, ruang = 16): number {
  return jangkarTop - wadahTop - ruang;
}

/** Id jangkar dari `location.hash` ("#target" → "target"), atau null. */
export function idJangkar(hash: string): string | null {
  const mentah = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!mentah) return null;
  try {
    return decodeURIComponent(mentah);
  } catch {
    return mentah;
  }
}
