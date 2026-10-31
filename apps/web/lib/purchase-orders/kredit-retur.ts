import { Decimal } from "decimal.js";
import { hitungTotalPo } from "./ppn";

/*
 * Nilai retur pemasok yang mengurangi utang PO. Murni — penulisnya di
 * `kredit-retur-writer.ts`.
 *
 * Harga yang dipakai adalah harga BELI di baris PO (ditambah PPN bila baris itu
 * "Exclude PPN", dengan tarif yang tercatat di PO), bukan `costValue` retur
 * (harga rata-rata stok): yang kita utangi ke pemasok adalah harga PO.
 *
 * Padanan baris: varian sama (null dan "" dianggap sama); kalau tidak ada,
 * semua baris PO barang itu — dipakai hanya bila harga dan pilihan PPN-nya
 * sama semua. Selain itu tidak ditebak: baris masuk `tanpaPadanan` dan tidak
 * mengurangi utang.
 */

type Angka = number | string | { toString(): string };

export type BarisPoUntukKredit = {
  itemId: string;
  variantSku: string | null;
  price: Angka;
  ppnIncluded: boolean;
};

export type BarisReturUntukKredit = {
  itemId: string;
  variantSku?: string | null;
  qty: Angka;
};

export type RincianKreditRetur = {
  itemId: string;
  variantSku: string | null;
  qty: number;
  harga: number;
  ppnIncluded: boolean;
  nilai: number;
};

export type BarisTanpaPadanan = {
  itemId: string;
  variantSku: string | null;
  qty: number;
  sebab: "TIDAK_ADA_DI_PO" | "HARGA_VARIAN_BERBEDA";
};

export type HasilKreditRetur = {
  /** Pengurang utang PO, termasuk PPN. */
  kredit: number;
  /** Σ qty × harga PO (tanpa PPN tambahan). */
  dasar: number;
  /** PPN yang ikut dikurangkan (baris "Exclude PPN"). */
  ppn: number;
  rincian: RincianKreditRetur[];
  tanpaPadanan: BarisTanpaPadanan[];
};

const varian = (v: string | null | undefined) => (v ?? "").trim();

function angka(v: Angka): Decimal | null {
  try {
    const d = new Decimal(typeof v === "number" ? v : v.toString());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function hitungKreditRetur(
  barisPo: readonly BarisPoUntukKredit[],
  ppnRatePercent: number | null,
  barisRetur: readonly BarisReturUntukKredit[],
): HasilKreditRetur {
  const rincian: RincianKreditRetur[] = [];
  const tanpaPadanan: BarisTanpaPadanan[] = [];

  for (const r of barisRetur) {
    const qty = angka(r.qty);
    if (!qty || qty.lte(0)) continue;
    const varianRetur = r.variantSku == null || varian(r.variantSku) === "" ? null : varian(r.variantSku);
    const sebarang = barisPo.filter((p) => p.itemId === r.itemId);
    const persis = sebarang.filter((p) => varian(p.variantSku) === (varianRetur ?? ""));
    const calon = persis.length > 0 ? persis : sebarang;
    if (calon.length === 0) {
      tanpaPadanan.push({ itemId: r.itemId, variantSku: varianRetur, qty: qty.toNumber(), sebab: "TIDAK_ADA_DI_PO" });
      continue;
    }
    const harga0 = angka(calon[0].price) ?? new Decimal(0);
    const seragam = calon.every(
      (p) => (angka(p.price) ?? new Decimal(0)).eq(harga0) && p.ppnIncluded === calon[0].ppnIncluded,
    );
    if (!seragam) {
      tanpaPadanan.push({ itemId: r.itemId, variantSku: varianRetur, qty: qty.toNumber(), sebab: "HARGA_VARIAN_BERBEDA" });
      continue;
    }
    rincian.push({
      itemId: r.itemId,
      variantSku: varianRetur,
      qty: qty.toNumber(),
      harga: harga0.toNumber(),
      ppnIncluded: calon[0].ppnIncluded,
      nilai: qty.mul(harga0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    });
  }

  const total = hitungTotalPo(
    rincian.map((b) => ({ qty: b.qty, price: b.harga, ppnIncluded: b.ppnIncluded })),
    ppnRatePercent,
  );
  return { kredit: total.grandTotal, dasar: total.subtotal, ppn: total.taxAmount, rincian, tanpaPadanan };
}
