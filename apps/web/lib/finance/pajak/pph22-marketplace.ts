/**
 * PPh 22 yang DIPUNGUT marketplace dari penjual (PMK 37/2025) — murni.
 *
 * Sejak 1 Oktober 2026 Shopee, Tokopedia (termasuk TikTok Shop), Lazada, dan
 * Blibli memungut 0,5% dari penjualan bruto (tanpa PPN) dan memotongnya dari
 * uang yang dilepas; tagihan marketplace berlaku sebagai bukti pungutnya. Bagi
 * penjual PPh final 0,5% pungutan ini MELUNASI PPh final atas penjualan itu;
 * bagi penjual lain ia kredit pajak (angsuran) — di buku besar keduanya
 * `PPH22_PREPAID` (pajak dibayar dimuka).
 *
 * Bentuk kolomnya di berkas settlement belum diketahui (contoh berkas sesudah
 * 1 Oktober belum ada), jadi pembacaan ini LONGGAR: kolom apa pun yang namanya
 * memuat "PPh 22" / "PPh Pasal 22" (huruf besar/kecil, spasi, titik diabaikan)
 * di baris Income, atau — bila tidak ada di baris — di ringkasan. Nilainya
 * selalu besaran positif (berkas menyimpan potongan sebagai negatif).
 * Berkas tanpa kolom itu → 0 dan jurnal settlement tidak berubah.
 */

const POLA_KOLOM = /pph\W*(pasal\W*)?22(?!\d)/i;

/** Sama dengan pembaca angka parser settlement (`shopee-settlement-parser.ts`), supaya kolom pajak dibaca seperti kolom biaya. */
function angka(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function objek(v: unknown): Record<string, unknown> | null {
  let o = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
}

/** Nama kolom PPh 22 di satu baris mentah, atau null. */
export function kolomPph22(raw: unknown): string | null {
  const o = objek(raw);
  if (!o) return null;
  return Object.keys(o).find((k) => POLA_KOLOM.test(k)) ?? null;
}

export type Pph22Settlement = {
  /** Rupiah, positif, dibulatkan ke sen. */
  nilai: number;
  sumber: "BARIS" | "RINGKASAN" | null;
  kolom: string | null;
};

/** Σ PPh 22 dari baris Income (diutamakan) atau ringkasan settlement. */
export function pph22DariSettlement(barisMentah: readonly unknown[], ringkasanMentah: unknown): Pph22Settlement {
  let sen = 0;
  let kolom: string | null = null;
  for (const raw of barisMentah) {
    const k = kolomPph22(raw);
    if (!k) continue;
    kolom ??= k;
    sen += Math.round(Math.abs(angka((objek(raw) as Record<string, unknown>)[k])) * 100);
  }
  if (kolom) return { nilai: sen / 100, sumber: "BARIS", kolom };
  const k = kolomPph22(ringkasanMentah);
  if (k) {
    const nilai = Math.round(Math.abs(angka((objek(ringkasanMentah) as Record<string, unknown>)[k])) * 100) / 100;
    return { nilai, sumber: "RINGKASAN", kolom: k };
  }
  return { nilai: 0, sumber: null, kolom: null };
}
