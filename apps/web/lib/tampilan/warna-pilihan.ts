/**
 * Warna pilihan pemilik — murni, aman untuk klien.
 *
 * Pemilik (2026-10-09): "warna-warna ini, apakah tidak bisa di custom juga? biarkan saya yang pilih".
 * Dua tempat:
 * - Warna grafik beranda: pilihan PRIBADI (User.chartColors), seperti warna tema. Slot yang tidak
 *   dipilih tetap memakai warna bawaan — skala tema untuk umur piutang dan komposisi stok, palet
 *   kategoris untuk garis tren.
 * - Warna jenis pemasok: milik data (SupplierType.color), sama di layar semua orang.
 *
 * Satu bentuk warna saja: "#rrggbb" huruf kecil. Apa pun yang lain dibuang, tidak ditebak.
 */

const POLA_HEX = /^#?([0-9a-f]{6})$/i;

/** "#AbC123" / "abc123" → "#abc123"; selain itu null. */
export function normalHex(nilai: unknown): string | null {
  if (typeof nilai !== "string") return null;
  const m = POLA_HEX.exec(nilai.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * Pilihan cepat di pemilih warna: 24 warna dari seluruh lingkaran warna, masing-masing dalam nada
 * gelap dan terang, supaya ada pilihan yang terbaca di tema terang maupun gelap. Warna lain tetap
 * bisa diketik sebagai kode hex.
 */
export const PALET_PILIHAN: readonly string[] = [
  "#dc2626", "#f87171",
  "#ea580c", "#fb923c",
  "#ca8a04", "#facc15",
  "#65a30d", "#a3e635",
  "#16a34a", "#4ade80",
  "#0d9488", "#2dd4bf",
  "#0891b2", "#22d3ee",
  "#2563eb", "#60a5fa",
  "#4f46e5", "#818cf8",
  "#9333ea", "#c084fc",
  "#db2777", "#f472b6",
  "#57534e", "#a8a29e",
];

/** Slot warna grafik beranda, dalam urutan tampil di Pengaturan. `grup` = kartu di beranda. */
export const SLOT_GRAFIK = [
  { kunci: "umur.belum", grup: "umur" },
  { kunci: "umur.h1_30", grup: "umur" },
  { kunci: "umur.h31_60", grup: "umur" },
  { kunci: "umur.lebih60", grup: "umur" },
  { kunci: "stok.bahan", grup: "stok" },
  { kunci: "stok.jadi", grup: "stok" },
  { kunci: "tren.marketplace", grup: "tren" },
  { kunci: "tren.lapangan", grup: "tren" },
  { kunci: "tren.shopee", grup: "tren" },
  { kunci: "tren.tiktok", grup: "tren" },
  { kunci: "tren.tokopedia", grup: "tren" },
  { kunci: "tren.mpLain", grup: "tren" },
  { kunci: "tren.putus", grup: "tren" },
  { kunci: "tren.van", grup: "tren" },
  { kunci: "tren.spg", grup: "tren" },
] as const;

export type SlotGrafik = (typeof SLOT_GRAFIK)[number]["kunci"];
export type GrupGrafik = (typeof SLOT_GRAFIK)[number]["grup"];
export type WarnaGrafik = Partial<Record<SlotGrafik, string>>;

const SLOT_SAH: ReadonlySet<string> = new Set(SLOT_GRAFIK.map((s) => s.kunci));

/**
 * Warna bawaan tiap slot (nilai CSS). Sama dengan yang dipakai beranda sebelum ada pilihan, jadi
 * slot kosong tidak mengubah apa pun.
 */
export const BAWAAN_GRAFIK: Record<SlotGrafik, string> = {
  "umur.belum": "var(--viz-netral)",
  "umur.h1_30": "var(--viz-tema-lemah)",
  "umur.h31_60": "var(--viz-tema-sedang)",
  "umur.lebih60": "var(--viz-tema-kuat)",
  "stok.bahan": "var(--viz-tema-kuat)",
  "stok.jadi": "var(--viz-tema-lemah)",
  "tren.marketplace": "var(--viz-1)",
  "tren.lapangan": "var(--viz-3)",
  "tren.shopee": "var(--viz-2)",
  "tren.tiktok": "var(--viz-5)",
  "tren.tokopedia": "var(--viz-6)",
  "tren.mpLain": "var(--muted-foreground)",
  "tren.putus": "var(--viz-3)",
  "tren.van": "var(--viz-4)",
  "tren.spg": "var(--viz-1)",
};

/** Nama custom property satu slot: "umur.h1_30" → "--warna-umur-h1_30". */
export function namaVarSlot(slot: SlotGrafik): string {
  return `--warna-${slot.replace(".", "-")}`;
}

/** Nilai CSS satu slot: warna pilihan bila ada (lewat custom property di akar beranda), selain itu bawaannya. */
export function warnaSlot(slot: SlotGrafik): string {
  return `var(${namaVarSlot(slot)}, ${BAWAAN_GRAFIK[slot]})`;
}

/** Isi kolom User.chartColors (JSON teks, objek, atau kosong) → hanya slot dikenal dengan hex sah. */
export function bacaWarnaGrafik(nilai: unknown): WarnaGrafik {
  let objek: unknown = nilai;
  if (typeof nilai === "string") {
    if (!nilai.trim()) return {};
    try {
      objek = JSON.parse(nilai);
    } catch {
      return {};
    }
  }
  if (!objek || typeof objek !== "object" || Array.isArray(objek)) return {};
  const hasil: WarnaGrafik = {};
  for (const [k, v] of Object.entries(objek as Record<string, unknown>)) {
    const hex = normalHex(v);
    if (SLOT_SAH.has(k) && hex) hasil[k as SlotGrafik] = hex;
  }
  return hasil;
}

/** Untuk disimpan: JSON berurutan slot, atau null bila tidak ada pilihan (= ikut bawaan). */
export function tulisWarnaGrafik(peta: WarnaGrafik): string | null {
  const bersih = bacaWarnaGrafik(peta);
  const urut: WarnaGrafik = {};
  for (const { kunci } of SLOT_GRAFIK) if (bersih[kunci]) urut[kunci] = bersih[kunci];
  return Object.keys(urut).length ? JSON.stringify(urut) : null;
}

/** Custom property untuk akar beranda: hanya slot yang dipilih. */
export function varCssGrafik(peta: WarnaGrafik): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const [k, v] of Object.entries(bacaWarnaGrafik(peta))) hasil[namaVarSlot(k as SlotGrafik)] = v;
  return hasil;
}
