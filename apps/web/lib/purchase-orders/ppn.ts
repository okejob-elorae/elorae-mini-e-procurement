import { Decimal } from "decimal.js";

/*
 * Total PO dengan PPN. Murni (tanpa Prisma) supaya formulir PO di browser,
 * penulis PO di server, dan kredit retur pemasok memakai SATU rumus.
 *
 * - Baris "Include PPN": harganya sudah memuat PPN → tidak ditambah apa pun.
 * - Baris "Exclude PPN": PPN = jumlah baris-baris ini × tarif, dihitung SEKALI
 *   atas jumlahnya (bukan per baris) lalu dibulatkan ke bawah ke rupiah penuh.
 * - Diskon PO (rupiah, opsional) mengurangi subtotal SEBELUM PPN dihitung. Diskon
 *   dibagi pro-rata nilai baris: hanya bagian yang jatuh ke baris "Exclude PPN"
 *   yang mengurangi dasar PPN. Saat ini PO belum punya kolom diskon, jadi semua
 *   pemanggil mengirim 0 — rumusnya sudah siap bila kolom itu ditambahkan.
 * - Tarif `null` = PO lama yang dibuat sebelum PPN dihitung: tidak ada PPN,
 *   total sama dengan subtotal — PO lama tidak berubah nilainya.
 */

type Angka = number | string | { toString(): string };

export type BarisHargaPo = {
  qty: Angka;
  price: Angka;
  ppnIncluded: boolean;
};

export type RincianTotalPo = {
  /** Σ qty × harga semua baris. */
  subtotal: number;
  /** Σ qty × harga baris "Exclude PPN" dikurangi bagian diskonnya — yang dikenai PPN. */
  dasarPpn: number;
  /** PPN yang DITAMBAHKAN di atas subtotal setelah diskon. */
  taxAmount: number;
  /** Diskon PO dalam rupiah. */
  diskon: number;
  grandTotal: number;
  ppnRatePercent: number | null;
};

function desimal(v: Angka): Decimal {
  try {
    const d = new Decimal(typeof v === "number" ? v : v.toString());
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

export function tarifPpnSah(tarif: number | null): tarif is number {
  return tarif != null && Number.isFinite(tarif) && tarif >= 0 && tarif <= 100;
}

/**
 * Tarif Pengaturan dibulatkan ke 2 desimal — presisi kolom
 * `PurchaseOrder.ppnRatePercent` (DECIMAL(5,2)). Tanpa ini PO dibuat dengan
 * 11,125% tetapi tersimpan 11,13%, dan menyunting PO itu kemudian mengubah PPN-nya.
 */
export function bulatkanTarifPpn(tarif: number): number {
  return new Decimal(tarif).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function hitungTotalPo(
  baris: readonly BarisHargaPo[],
  ppnRatePercent: number | null,
  opsi?: { diskon?: Angka },
): RincianTotalPo {
  if (ppnRatePercent != null && !tarifPpnSah(ppnRatePercent)) {
    throw new RangeError(`Tarif PPN tidak sah: ${ppnRatePercent}`);
  }
  let subtotal = new Decimal(0);
  let dasarPpn = new Decimal(0);
  for (const b of baris) {
    const nilai = desimal(b.qty).mul(desimal(b.price));
    subtotal = subtotal.plus(nilai);
    if (!b.ppnIncluded) dasarPpn = dasarPpn.plus(nilai);
  }
  const sub2 = subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const diskon = desimal(opsi?.diskon ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (diskon.lt(0) || diskon.gt(sub2)) {
    throw new RangeError(`Diskon PO tidak sah: ${diskon.toString()}`);
  }
  // Bagian diskon yang jatuh ke baris "Exclude PPN" (pro-rata nilai baris).
  const diskonDasar = subtotal.gt(0) ? diskon.mul(dasarPpn).div(subtotal) : new Decimal(0);
  const dasarSetelahDiskon = Decimal.max(dasarPpn.minus(diskonDasar), 0);
  const taxAmount =
    ppnRatePercent == null
      ? new Decimal(0)
      : dasarSetelahDiskon.mul(ppnRatePercent).div(100).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
  return {
    subtotal: sub2.toNumber(),
    dasarPpn: dasarSetelahDiskon.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    taxAmount: taxAmount.toNumber(),
    diskon: diskon.toNumber(),
    grandTotal: sub2.minus(diskon).plus(taxAmount).toNumber(),
    ppnRatePercent,
  };
}
