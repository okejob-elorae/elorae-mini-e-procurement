import type { AlasanPermintaan, BarisTambahan } from "@/lib/spg/saran-minta";
import { kunciBaris } from "@/lib/spg/stok";
import type { BarisPilihan } from "../barang-pilihan";

/**
 * Baris `?tambah=` → isi awal formulir minta kiriman. Murni, untuk dites.
 *
 * Barang bervarian yang dibawa TANPA ukuran (mis. pembeli mencari "kaos ini,
 * ukuran apa saja") tidak bisa diminta begitu saja: ia menunggu SPG memilih
 * ukurannya, dan jumlah serta alasannya ikut ke ukuran yang dipilih.
 */

export type BarisAwal = { barang: BarisPilihan; qty: string; alasan: AlasanPermintaan };
export type Tertunda = { itemId: string; nama: string; sku: string; qty: number; alasan: AlasanPermintaan };

export function susunTambahan(
  pilihan: readonly BarisPilihan[],
  tambah: readonly BarisTambahan[],
  sudahAda: ReadonlySet<string>,
): { baris: BarisAwal[]; tertunda: Tertunda[]; hilang: number } {
  const perKunci = new Map(pilihan.map((p) => [p.kunci, p]));
  const ada = new Set(sudahAda);
  const baris: BarisAwal[] = [];
  const tertunda: Tertunda[] = [];
  let hilang = 0;
  for (const x of tambah) {
    const p = perKunci.get(kunciBaris(x.itemId, x.variantSku));
    if (p) {
      if (ada.has(p.kunci)) continue;
      ada.add(p.kunci);
      baris.push({ barang: p, qty: String(x.qty), alasan: x.alasan });
      continue;
    }
    const induk = pilihan.find((q) => q.itemId === x.itemId);
    if (!induk) {
      hilang += 1;
      continue;
    }
    const lama = tertunda.find((t) => t.itemId === x.itemId);
    if (lama) lama.qty += x.qty;
    else tertunda.push({ itemId: x.itemId, nama: induk.nama, sku: induk.sku, qty: x.qty, alasan: x.alasan });
  }
  return { baris, tertunda, hilang };
}

/**
 * SPG memilih barang dari pencarian. Kalau barang itu sedang menunggu ukuran,
 * jumlah dan alasannya dipakai sekali lalu dilepas; kalau tidak, pilihan biasa.
 */
export function ambilTertunda(
  tertunda: readonly Tertunda[],
  barang: BarisPilihan,
): { isi: { qty: string; alasan: AlasanPermintaan }; sisa: readonly Tertunda[] } {
  const t = tertunda.find((x) => x.itemId === barang.itemId);
  if (!t) return { isi: { qty: "1", alasan: "MANUAL" }, sisa: tertunda };
  return { isi: { qty: String(t.qty), alasan: t.alasan }, sisa: tertunda.filter((x) => x !== t) };
}
