import { periksaCode128 } from "@/lib/barcode/code128";
import {
  DAFTAR_GAYA_LABEL,
  DAFTAR_TATA_LETAK_LABEL,
  DAFTAR_UKURAN_LABEL,
  LEBAR_MODUL_MIN_MM,
  lebarModulMm,
  UKURAN_LABEL_BAWAAN,
  type BarisCetakLabel,
  type GayaLabel,
  type TataLetakLabel,
  type UkuranLabel,
} from "@/lib/print/label-barcode-html";

/**
 * Aturan layar label barcode kantor — murni, aman diimpor komponen klien.
 * Kuerinya di `label-queries.ts` (server saja), dokumennya di
 * `lib/print/label-barcode-html.ts`.
 *
 * Kode di label HARUS kode yang dikenali pemindai SPG (`cocokkanKode` di
 * `lib/spg/stok.ts`: barcode varian → SKU varian → SKU barang). Label pemilik
 * (2026-10-03) mencetak barcode varian seperti "0127000038PS", jadi bawaannya:
 *   - barang bervarian: barcode varian; bila kosong, SKU varian;
 *   - pilihan "SKU varian": selalu SKU varian;
 *   - barang tanpa varian: SKU barang (keduanya).
 */

export type SumberKodeLabel = "BARCODE" | "SKU";
export const DAFTAR_SUMBER_KODE_LABEL: readonly SumberKodeLabel[] = ["BARCODE", "SKU"];

/** Satu label sekali cetak paling banyak sekian — lebih dari itu pecah beberapa kali cetak. */
export const MAKS_LABEL_SEKALI_CETAK = 2000;
export const MAKS_LABEL_PER_VARIAN = 9999;

export type VarianLabel = {
  /** "" untuk barang tanpa varian. */
  variantSku: string;
  ukuran: string | null;
  warna: string | null;
  barcode: string | null;
  /** Stok fisik di gudang (qtyOnHand); boleh negatif di data, tidak pernah jadi label. */
  stokGudang: number;
};

export type BarangLabel = {
  itemId: string;
  nama: string;
  sku: string;
  /** Harga eceran (sama dengan harga jual SPG); null = belum diset. */
  harga: number | null;
  aktif: boolean;
  bervarian: boolean;
  varian: VarianLabel[];
  /** Barang bervarian: stok gudang yang tercatat tanpa ukuran (baris gabungan) — tidak bisa dibagi otomatis. */
  stokTanpaUkuran: number;
};

/** Jumlah label per baris, berkunci `kunciLabel`. */
export type JumlahLabel = Record<string, number>;

export function kunciLabel(itemId: string, variantSku: string): string {
  return `${itemId}::${variantSku}`;
}

export type AsalKode = "BARCODE" | "SKU_VARIAN" | "SKU_BARANG";

/** Kode yang dicetak untuk satu varian, dan asalnya (untuk peringatan di layar). */
export function kodeLabel(barang: Pick<BarangLabel, "sku" | "bervarian">, varian: Pick<VarianLabel, "variantSku" | "barcode">, sumber: SumberKodeLabel): { kode: string; asal: AsalKode } {
  if (!barang.bervarian || !varian.variantSku) return { kode: barang.sku.trim(), asal: "SKU_BARANG" };
  const barcode = varian.barcode?.trim() ?? "";
  if (sumber === "BARCODE" && barcode) return { kode: barcode, asal: "BARCODE" };
  return { kode: varian.variantSku.trim(), asal: "SKU_VARIAN" };
}

/** "XL · Hitam"; null bila ukuran dan warna tidak diketahui. */
export function teksVarian(v: Pick<VarianLabel, "ukuran" | "warna">): string | null {
  const t = [v.ukuran, v.warna].map((s) => s?.trim() ?? "").filter(Boolean).join(" · ");
  return t || null;
}

/** Jumlah dari isian layar: bilangan bulat 0–9999; isian tak sah = 0. */
export function rapikanJumlah(nilai: unknown): number {
  const n = typeof nilai === "number" ? nilai : Number(String(nilai ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAKS_LABEL_PER_VARIAN, Math.floor(n));
}

/** Bawaan saat barang ditambahkan: satu label per varian. */
export function jumlahAwal(barang: BarangLabel): JumlahLabel {
  return Object.fromEntries(barang.varian.map((v) => [kunciLabel(barang.itemId, v.variantSku), 1]));
}

/** "Isi sesuai stok gudang": label sebanyak stok fisik tiap varian (stok ≤ 0 → 0). */
export function jumlahSesuaiStok(barang: BarangLabel): JumlahLabel {
  return Object.fromEntries(barang.varian.map((v) => [kunciLabel(barang.itemId, v.variantSku), rapikanJumlah(v.stokGudang)]));
}

export function jumlahBarang(barang: BarangLabel, jumlah: JumlahLabel): number {
  return barang.varian.reduce((n, v) => n + rapikanJumlah(jumlah[kunciLabel(barang.itemId, v.variantSku)] ?? 0), 0);
}

export function totalJumlah(barang: readonly BarangLabel[], jumlah: JumlahLabel): number {
  return barang.reduce((n, b) => n + jumlahBarang(b, jumlah), 0);
}

/** Baris untuk `buildLabelBarcodeHtml`, urut barang lalu varian; jumlah 0 dilewati. */
export function susunBarisCetak(barang: readonly BarangLabel[], jumlah: JumlahLabel, sumber: SumberKodeLabel): BarisCetakLabel[] {
  const hasil: BarisCetakLabel[] = [];
  for (const b of barang) {
    for (const v of b.varian) {
      const n = rapikanJumlah(jumlah[kunciLabel(b.itemId, v.variantSku)] ?? 0);
      if (n === 0) continue;
      hasil.push({
        kode: kodeLabel(b, v, sumber).kode,
        nama: b.nama,
        varian: b.bervarian ? teksVarian(v) : null,
        sku: b.bervarian && v.variantSku ? v.variantSku : b.sku,
        artikel: b.sku,
        ukuran: b.bervarian ? (v.ukuran?.trim() || null) : null,
        harga: b.harga,
        jumlah: n,
      });
    }
  }
  return hasil;
}

export type PeringatanLabel = {
  /** Varian bervarian yang memakai SKU karena barcode-nya kosong (hanya saat sumber = BARCODE). */
  tanpaBarcode: { itemId: string; nama: string; variantSku: string }[];
  /** Barang tanpa harga eceran (hanya saat harga ditampilkan). */
  tanpaHarga: { itemId: string; nama: string }[];
  /** Kode yang tidak bisa dibuat batang (huruf di luar ASCII, terlalu panjang, kosong). */
  tidakBisa: { itemId: string; nama: string; kode: string }[];
  /** Kode terlalu panjang untuk ukuran label ini — garisnya terlalu rapat untuk kamera HP. */
  rapat: { itemId: string; nama: string; kode: string; lebarModulMm: number }[];
};

/** Peringatan atas label yang AKAN dicetak (jumlah > 0) dengan pilihan sekarang. */
export function periksaLabel(
  barang: readonly BarangLabel[],
  jumlah: JumlahLabel,
  pilihan: { sumberKode: SumberKodeLabel; ukuran: UkuranLabel; tampilHarga: boolean },
): PeringatanLabel {
  const hasil: PeringatanLabel = { tanpaBarcode: [], tanpaHarga: [], tidakBisa: [], rapat: [] };
  for (const b of barang) {
    const dicetak = b.varian.filter((v) => rapikanJumlah(jumlah[kunciLabel(b.itemId, v.variantSku)] ?? 0) > 0);
    if (dicetak.length === 0) continue;
    if (pilihan.tampilHarga && b.harga === null) hasil.tanpaHarga.push({ itemId: b.itemId, nama: b.nama });
    const kodeDilihat = new Set<string>();
    for (const v of dicetak) {
      const { kode, asal } = kodeLabel(b, v, pilihan.sumberKode);
      if (pilihan.sumberKode === "BARCODE" && asal === "SKU_VARIAN") hasil.tanpaBarcode.push({ itemId: b.itemId, nama: b.nama, variantSku: v.variantSku });
      if (kodeDilihat.has(kode)) continue;
      kodeDilihat.add(kode);
      if (periksaCode128(kode) !== null) {
        hasil.tidakBisa.push({ itemId: b.itemId, nama: b.nama, kode });
        continue;
      }
      const modul = lebarModulMm(kode, pilihan.ukuran);
      if (modul !== null && modul < LEBAR_MODUL_MIN_MM) hasil.rapat.push({ itemId: b.itemId, nama: b.nama, kode, lebarModulMm: modul });
    }
  }
  return hasil;
}

/**
 * SKU induk yang mungkin dari SKU varian yang diketik/dipindai: `KAOS-01-HTM-XL`
 * → `KAOS-01-HTM`, `KAOS-01`, `KAOS`. Supaya label tag yang dipegang gudang
 * bisa langsung dicari.
 */
export function kandidatSkuInduk(kata: string): string[] {
  const bagian = kata.split("-");
  const hasil: string[] = [];
  for (let n = bagian.length - 1; n >= 1; n--) {
    const s = bagian.slice(0, n).join("-");
    if (s) hasil.push(s);
  }
  return hasil;
}

// ─── Isi dari dokumen kiriman ─────────────────────────────────────────────────

export type JenisDokumenLabel = "pengiriman" | "mutasi" | "konsi";
export const DAFTAR_JENIS_DOKUMEN_LABEL: readonly JenisDokumenLabel[] = ["pengiriman", "mutasi", "konsi"];
export type SumberDokumenLabel = { jenis: JenisDokumenLabel; id: string };

/** `?dari=pengiriman:<id>` / `mutasi:<id>` / `konsi:<id>`; selain itu null. */
export function bacaSumberDokumen(dari: string | string[] | null | undefined): SumberDokumenLabel | null {
  const s = (Array.isArray(dari) ? dari[0] : dari)?.trim() ?? "";
  const titik = s.indexOf(":");
  if (titik <= 0) return null;
  const jenis = s.slice(0, titik) as JenisDokumenLabel;
  const id = s.slice(titik + 1).trim();
  if (!DAFTAR_JENIS_DOKUMEN_LABEL.includes(jenis) || !id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return { jenis, id };
}

/** Alamat layar label — untuk tombol "Cetak label" di halaman lain. */
export function alamatLabel(sumber: { itemId: string } | SumberDokumenLabel): string {
  const q = new URLSearchParams();
  if ("itemId" in sumber) q.set("item", sumber.itemId);
  else q.set("dari", `${sumber.jenis}:${sumber.id}`);
  return `/backoffice/items/labels?${q.toString()}`;
}

export type BarisDokumenLabel = { itemId: string | null; variantSku: string | null; nama: string; qty: number };
export type AlasanDilewati = "TANPA_BARANG" | "BARANG_TIDAK_ADA" | "VARIAN_TIDAK_ADA";
export type DilewatiDokumen = { nama: string; variantSku: string | null; qty: number; alasan: AlasanDilewati };
export type TanpaUkuranDokumen = { itemId: string; nama: string; qty: number };

/**
 * Jumlah label = jumlah barang di dokumen, per varian. Yang tidak bisa
 * dijadikan label tidak dibuang diam-diam:
 *   - baris tanpa ukuran untuk barang bervarian (kiriman konsinyasi tidak
 *     mencatat ukuran) → `tanpaUkuran`, kantor mengisi per ukuran sendiri;
 *   - baris tanpa barang master (nama diketik), barang yang sudah dihapus,
 *     atau varian yang tidak ada lagi di master → `dilewati` dengan alasannya.
 *     Varian yang tidak ada di master tidak dicetak: layar jual SPG tidak
 *     akan mengenali kodenya.
 */
export function isiDariDokumen(
  barang: readonly BarangLabel[],
  baris: readonly BarisDokumenLabel[],
): { jumlah: JumlahLabel; tanpaUkuran: TanpaUkuranDokumen[]; dilewati: DilewatiDokumen[] } {
  const peta = new Map(barang.map((b) => [b.itemId, b]));
  const jumlah: JumlahLabel = {};
  const tanpaUkuran = new Map<string, TanpaUkuranDokumen>();
  const dilewati: DilewatiDokumen[] = [];
  const tambah = (k: string, qty: number) => {
    jumlah[k] = Math.min(MAKS_LABEL_PER_VARIAN, (jumlah[k] ?? 0) + qty);
  };

  for (const r of baris) {
    const qty = rapikanJumlah(r.qty);
    if (qty === 0) continue;
    const vs = r.variantSku?.trim() ?? "";
    if (!r.itemId) {
      dilewati.push({ nama: r.nama, variantSku: vs || null, qty, alasan: "TANPA_BARANG" });
      continue;
    }
    const b = peta.get(r.itemId);
    if (!b) {
      dilewati.push({ nama: r.nama, variantSku: vs || null, qty, alasan: "BARANG_TIDAK_ADA" });
      continue;
    }
    if (!b.bervarian) {
      tambah(kunciLabel(b.itemId, ""), qty);
      continue;
    }
    if (!vs) {
      const ada = tanpaUkuran.get(b.itemId);
      if (ada) ada.qty += qty;
      else tanpaUkuran.set(b.itemId, { itemId: b.itemId, nama: b.nama, qty });
      continue;
    }
    const v = b.varian.find((x) => x.variantSku.toLowerCase() === vs.toLowerCase());
    if (!v) {
      dilewati.push({ nama: b.nama, variantSku: vs, qty, alasan: "VARIAN_TIDAK_ADA" });
      continue;
    }
    tambah(kunciLabel(b.itemId, v.variantSku), qty);
  }
  return { jumlah, tanpaUkuran: [...tanpaUkuran.values()], dilewati };
}

// ─── Pilihan cetak yang diingat peramban ─────────────────────────────────────

export const KUNCI_SIMPAN_OPSI_LABEL = "elorae.label-barcode.opsi";

export type OpsiLayarLabel = {
  gaya: GayaLabel;
  ukuran: UkuranLabel;
  tataLetak: TataLetakLabel;
  tampilHarga: boolean;
  tampilNama: boolean;
  sumberKode: SumberKodeLabel;
};

/** Gaya ELORAE dan tanpa harga — pemilik: "harga tidak di cetak di label". */
export const OPSI_LABEL_BAWAAN: OpsiLayarLabel = {
  gaya: "ELORAE",
  ukuran: UKURAN_LABEL_BAWAAN,
  tataLetak: "A4",
  tampilHarga: false,
  tampilNama: true,
  sumberKode: "BARCODE",
};

/** Simpanan peramban → pilihan sah; setiap isian yang tak dikenal kembali ke bawaannya. */
export function bacaOpsiLabel(simpanan: string | null | undefined): OpsiLayarLabel {
  let o: Record<string, unknown> = {};
  try {
    const p: unknown = simpanan ? JSON.parse(simpanan) : null;
    if (p && typeof p === "object" && !Array.isArray(p)) o = p as Record<string, unknown>;
  } catch {
    o = {};
  }
  const pilih = <T extends string>(nilai: unknown, daftar: readonly T[], bawaan: T): T =>
    typeof nilai === "string" && (daftar as readonly string[]).includes(nilai) ? (nilai as T) : bawaan;
  return {
    gaya: pilih(o.gaya, DAFTAR_GAYA_LABEL, OPSI_LABEL_BAWAAN.gaya),
    ukuran: pilih(o.ukuran, DAFTAR_UKURAN_LABEL, OPSI_LABEL_BAWAAN.ukuran),
    tataLetak: pilih(o.tataLetak, DAFTAR_TATA_LETAK_LABEL, OPSI_LABEL_BAWAAN.tataLetak),
    tampilHarga: typeof o.tampilHarga === "boolean" ? o.tampilHarga : OPSI_LABEL_BAWAAN.tampilHarga,
    tampilNama: typeof o.tampilNama === "boolean" ? o.tampilNama : OPSI_LABEL_BAWAAN.tampilNama,
    sumberKode: pilih(o.sumberKode, DAFTAR_SUMBER_KODE_LABEL, OPSI_LABEL_BAWAAN.sumberKode),
  };
}
