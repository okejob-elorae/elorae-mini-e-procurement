/**
 * Warna pilihan pemilik — murni, aman untuk klien.
 *
 * Pemilik (2026-10-09): "warna-warna ini, apakah tidak bisa di custom juga? biarkan saya yang pilih",
 * lalu "kenapa tidak menggunakan warna pantone saja". Jadi warna dipilih dari katalog Pantone TCX
 * (tabel PantoneColor, sama dengan pemilih warna tema) dan disimpan sebagai kodenya + hex + nama;
 * hex selalu diambil SERVER dari katalog, tidak pernah dipercaya dari peramban.
 * Dua tempat:
 * - Warna grafik beranda: pilihan PRIBADI (User.chartColors), seperti warna tema. Slot yang tidak
 *   dipilih tetap memakai warna bawaan — skala tema untuk umur piutang dan komposisi stok, palet
 *   kategoris untuk garis tren.
 * - Warna jenis pemasok: milik data (SupplierType.colorTcx + color), sama di layar semua orang.
 */

const POLA_HEX = /^#?([0-9a-f]{6})$/i;
const POLA_TCX = /^(\d{2}-\d{4})(?:\s*TCX)?$/i;

/** "#AbC123" / "abc123" → "#abc123"; selain itu null. */
export function normalHex(nilai: unknown): string | null {
  if (typeof nilai !== "string") return null;
  const m = POLA_HEX.exec(nilai.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** "19-4052" / "19-4052 TCX" → "19-4052"; selain itu null. Bentuk kode di tabel PantoneColor. */
export function normalTcx(nilai: unknown): string | null {
  if (typeof nilai !== "string") return null;
  const m = POLA_TCX.exec(nilai.trim());
  return m ? m[1] : null;
}

/** Satu warna Pantone pilihan. */
export type WarnaPantone = { tcx: string; nama: string; hex: string };

/** Saringan rona di pemilih — label Indonesia → tag `hue` di PantoneColor.filterTags. */
export const RONA_PANTONE = [
  { kunci: "merah", tag: "Red" },
  { kunci: "pink", tag: "Pink" },
  { kunci: "oranye", tag: "Orange" },
  { kunci: "kuning", tag: "Yellow" },
  { kunci: "hijau", tag: "Green" },
  { kunci: "toska", tag: "Teal/Cyan" },
  { kunci: "biru", tag: "Blue" },
  { kunci: "ungu", tag: "Purple" },
  { kunci: "cokelat", tag: "Brown" },
  { kunci: "abu", tag: "Gray" },
  { kunci: "hitam", tag: "Black" },
  { kunci: "putih", tag: "White" },
] as const;

export type RonaPantone = (typeof RONA_PANTONE)[number]["kunci"];

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
export type WarnaGrafik = Partial<Record<SlotGrafik, WarnaPantone>>;

const SLOT_SAH: ReadonlySet<string> = new Set(SLOT_GRAFIK.map((s) => s.kunci));

export function slotSah(slot: unknown): slot is SlotGrafik {
  return typeof slot === "string" && SLOT_SAH.has(slot);
}

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

/** Satu nilai tersimpan → WarnaPantone sah (kode TCX + hex wajib; nama boleh kosong), selain itu null. */
export function bacaWarnaPantone(nilai: unknown): WarnaPantone | null {
  if (!nilai || typeof nilai !== "object" || Array.isArray(nilai)) return null;
  const o = nilai as Record<string, unknown>;
  const tcx = normalTcx(o.tcx);
  const hex = normalHex(o.hex);
  if (!tcx || !hex) return null;
  return { tcx, hex, nama: typeof o.nama === "string" ? o.nama.slice(0, 80) : "" };
}

/** Isi kolom User.chartColors (JSON teks, objek, atau kosong) → hanya slot dikenal dengan warna Pantone sah. */
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
    const w = bacaWarnaPantone(v);
    if (slotSah(k) && w) hasil[k] = w;
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
  for (const [k, v] of Object.entries(bacaWarnaGrafik(peta))) hasil[namaVarSlot(k as SlotGrafik)] = v.hex;
  return hasil;
}

/** Permintaan simpan dari layar: {slot: kode TCX} — hanya slot dan kode yang sah; hex dicari server. */
export function bacaPermintaanWarnaGrafik(input: unknown): Partial<Record<SlotGrafik, string>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const hasil: Partial<Record<SlotGrafik, string>> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const tcx = normalTcx(v);
    if (slotSah(k) && tcx) hasil[k] = tcx;
  }
  return hasil;
}

/** Satu baris katalog untuk contoh spektrum. `L`/`C` = terang dan kroma CIELAB (null bila tidak ada di katalog). */
export type BarisSpektrum = { tcx: string; nama: string; hex: string; rona: readonly string[]; L: number | null; C: number | null };

const RONA_NETRAL: ReadonlySet<RonaPantone> = new Set(["abu", "hitam", "putih"]);

/** Perkiraan L* dari hex bila katalog tidak punya nilai Lab. */
function terangDariHex(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * Tampilan awal pemilih (tanpa cari/rona): satu baris per rona, `perRona` warna dari terang ke
 * gelap, supaya pemilik melihat seluruh spektrum alih-alih 30 warna putih pertama di urutan buku.
 * Rona berwarna hanya mengambil warna dengan kroma ≥ median rona itu (yang jelas warnanya);
 * abu/hitam/putih mengambil semuanya. Satu warna tidak muncul di dua rona.
 */
export function contohSpektrum(baris: readonly BarisSpektrum[], perRona = 8): { kunci: RonaPantone; warna: WarnaPantone[] }[] {
  const dipakai = new Set<string>();
  const hasil: { kunci: RonaPantone; warna: WarnaPantone[] }[] = [];
  for (const { kunci, tag } of RONA_PANTONE) {
    let calon = baris.filter((b) => b.rona.includes(tag) && !dipakai.has(b.tcx) && normalHex(b.hex));
    if (!calon.length) continue;
    if (!RONA_NETRAL.has(kunci)) {
      const kroma = calon.map((b) => b.C ?? 0).sort((a, b) => a - b);
      const median = kroma[Math.floor((kroma.length - 1) / 2)];
      calon = calon.filter((b) => (b.C ?? 0) >= median);
    }
    const urut = calon
      .map((b) => ({ b, L: b.L ?? terangDariHex(normalHex(b.hex)!) }))
      .sort((x, y) => y.L - x.L || x.b.tcx.localeCompare(y.b.tcx));
    const n = Math.min(perRona, urut.length);
    const indeks = new Set<number>();
    for (let i = 0; i < n; i++) indeks.add(n === 1 ? 0 : Math.round((i * (urut.length - 1)) / (n - 1)));
    const warna = [...indeks].map((i) => {
      const { b } = urut[i];
      dipakai.add(b.tcx);
      return { tcx: b.tcx, nama: b.nama, hex: normalHex(b.hex)! };
    });
    hasil.push({ kunci, warna });
  }
  return hasil;
}

/**
 * Urutan warna satu rona di pemilih: yang paling jelas warnanya (kroma tinggi) dulu, per halaman
 * `perHalaman`, dan di dalam setiap halaman dari terang ke gelap — supaya halaman pertama "Merah"
 * berisi merah sungguhan, bukan putih kemerahan yang ada di depan urutan buku.
 */
export function urutRona(baris: readonly BarisSpektrum[], tag: string, perHalaman: number): WarnaPantone[] {
  const calon = baris
    .filter((b) => b.rona.includes(tag) && normalHex(b.hex))
    .map((b) => ({ b, L: b.L ?? terangDariHex(normalHex(b.hex)!), C: b.C ?? 0 }))
    .sort((x, y) => y.C - x.C || x.b.tcx.localeCompare(y.b.tcx));
  const hasil: WarnaPantone[] = [];
  for (let i = 0; i < calon.length; i += perHalaman) {
    const halaman = calon.slice(i, i + perHalaman).sort((x, y) => y.L - x.L || x.b.tcx.localeCompare(y.b.tcx));
    for (const { b } of halaman) hasil.push({ tcx: b.tcx, nama: b.nama, hex: normalHex(b.hex)! });
  }
  return hasil;
}
