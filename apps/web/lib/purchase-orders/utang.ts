import { Decimal } from "decimal.js";
import { hitungTotalPo } from "./ppn";

/*
 * Utang ke pemasok untuk satu PO, untuk DITAMPILKAN (detail PO, daftar PO,
 * register pembayaran pemasok). Murni — tidak menyentuh GL.
 *
 *   utang = total PO − nilai yang tidak akan datang − kredit retur pemasok
 *
 * "Tidak akan datang" hanya berlaku untuk PO yang ditutup lewat "Tutup PO"
 * (`closedAt` terisi DAN status masih CLOSED): sisa qty × harga PO, ditambah
 * PPN baris "Exclude PPN" dengan tarif yang tersimpan di PO. PO yang masih
 * terbuka tetap diutangi penuh karena barangnya masih ditunggu — termasuk PO
 * tertutup yang dibuka lagi oleh GRN (status kembali PARTIAL, `closedAt` tetap).
 */

type Angka = number | string | { toString(): string };

export type PoUntukUtang = {
  status: string;
  grandTotal: Angka;
  ppnRatePercent: Angka | null;
  closedAt: Date | string | null;
  items: ReadonlyArray<{ qty: Angka; receivedQty: Angka; price: Angka; ppnIncluded: boolean }>;
};

export type RincianUtangPo = {
  nilaiPo: number;
  nilaiTidakDatang: number;
  kreditRetur: number;
  utang: number;
};

function desimal(v: Angka | null | undefined): Decimal {
  if (v == null) return new Decimal(0);
  try {
    const d = new Decimal(typeof v === "number" ? v : v.toString());
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

export function hitungUtangPo(po: PoUntukUtang, kreditRetur: Angka): RincianUtangPo {
  const nilaiPo = desimal(po.grandTotal);
  let nilaiTidakDatang = new Decimal(0);
  if (po.status === "CLOSED" && po.closedAt != null) {
    const sisa = po.items
      .map((l) => ({ qty: desimal(l.qty).minus(desimal(l.receivedQty)), price: l.price, ppnIncluded: l.ppnIncluded }))
      .filter((l) => l.qty.gt(0));
    const tarif = po.ppnRatePercent == null ? null : desimal(po.ppnRatePercent).toNumber();
    nilaiTidakDatang = new Decimal(hitungTotalPo(sisa, tarif).grandTotal);
  }
  const kredit = Decimal.max(desimal(kreditRetur), 0);
  const utang = Decimal.max(nilaiPo.minus(nilaiTidakDatang).minus(kredit), 0);
  return {
    nilaiPo: nilaiPo.toDecimalPlaces(2).toNumber(),
    nilaiTidakDatang: nilaiTidakDatang.toDecimalPlaces(2).toNumber(),
    kreditRetur: kredit.toDecimalPlaces(2).toNumber(),
    utang: utang.toDecimalPlaces(2).toNumber(),
  };
}
