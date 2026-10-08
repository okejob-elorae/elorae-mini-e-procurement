/**
 * Keadaan galeri foto barang di halaman rincian. Galeri punya tombol
 * "Simpan gambar" sendiri, terpisah dari "Simpan barang" — gambar yang ditambah,
 * digeser, atau dihapus belum tersimpan sampai tombol itu ditekan. Murni.
 */

export type ButirGaleri = {
  id?: string;
  url: string;
  variantSku: string | null;
  sortOrder: number;
};

/** Identitas butir: id untuk gambar yang sudah ada, URL unggahan untuk yang baru. */
const kunci = (b: ButirGaleri) => b.id ?? `url:${b.url}`;

export type PerubahanGaleri = {
  /** Gambar yang ditambah sejak simpan terakhir. */
  baru: number;
  /** Gambar yang dihapus sejak simpan terakhir. */
  dihapus: number;
  /** Gambar yang urutannya (atau galerinya) berubah. */
  digeser: number;
  adaPerubahan: boolean;
};

export function perubahanGaleri(
  tersimpan: readonly ButirGaleri[],
  sekarang: readonly ButirGaleri[],
): PerubahanGaleri {
  const lama = new Map(tersimpan.map((b) => [kunci(b), b]));
  const kini = new Set(sekarang.map(kunci));
  let baru = 0;
  let digeser = 0;
  for (const b of sekarang) {
    const l = lama.get(kunci(b));
    if (!l) baru += 1;
    else if (l.sortOrder !== b.sortOrder || l.variantSku !== b.variantSku) digeser += 1;
  }
  let dihapus = 0;
  for (const b of tersimpan) if (!kini.has(kunci(b))) dihapus += 1;
  return { baru, dihapus, digeser, adaPerubahan: baru + dihapus + digeser > 0 };
}

/** Kunci pesan `items.images.*` untuk unggahan yang ditolak `/api/upload/item-image`. */
export function kunciGalatUnggah(status: number, kode: string | undefined): string {
  if (status === 401 || status === 403) return "error.forbidden";
  if (status === 503) return "errPenyimpanan";
  if (kode === "image_mime_invalid" || kode === "image_too_large" || kode === "image_count_exceeded") {
    return `error.${kode}`;
  }
  return "errUnggah";
}

const KODE_SIMPAN_DIKENAL = new Set([
  "forbidden",
  "image_mime_invalid",
  "image_too_large",
  "image_count_exceeded",
  "image_variant_unknown",
  "image_url_untrusted",
  "image_jubelio_owned",
]);

/** Kunci pesan `items.images.*` untuk penolakan "Simpan gambar". */
export function kunciGalatSimpanGambar(kode: string): string {
  if (kode === "item_not_found") return "errBarangTidakAda";
  return KODE_SIMPAN_DIKENAL.has(kode) ? `error.${kode}` : "errSimpan";
}
