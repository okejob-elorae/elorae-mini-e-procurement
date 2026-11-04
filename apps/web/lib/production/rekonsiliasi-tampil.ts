// Bukan aksi server: penolong tampilan rekonsiliasi bahan WO (aman untuk klien).

type BarisRekon = {
  issuedQty: number;
  theoreticalUsage: number;
  usedValue: number;
  varianceValue: number;
  status: "OK" | "OVER" | "UNDER";
};

/** Status untuk layar: "Kurang" dibedakan dari "belum dikirim sama sekali". */
export type StatusTampilRekon = "OK" | "OVER" | "UNDER" | "BELUM_DIKIRIM";

export function statusTampilRekon(b: Pick<BarisRekon, "issuedQty" | "theoreticalUsage" | "status">): StatusTampilRekon {
  if (b.issuedQty <= 0 && b.theoreticalUsage > 0) return "BELUM_DIKIRIM";
  return b.status;
}

/**
 * Efisiensi bahan = nilai pemakaian teoretis ÷ nilai yang benar-benar terpakai
 * × 100. 100% = pas, di bawah 100% = boros (kain lebih pakai 154% → 39%), di
 * atas 100% = hemat. Dulu "nilai terpakai ÷ nilai dikeluarkan", yang selalu
 * 100% selama tidak ada bahan kembali walau kain kelebihan pakai.
 * null bila belum ada pemakaian.
 */
export function efisiensiBahan(baris: BarisRekon[]): number | null {
  let teori = 0;
  let pakai = 0;
  for (const b of baris) {
    pakai += b.usedValue;
    teori += b.usedValue - b.varianceValue;
  }
  if (pakai <= 0) return null;
  return (teori / pakai) * 100;
}

/** "+154,0%" / "-12,5%" — format Indonesia, satu desimal, bertanda. */
export function persenBertanda(n: number): string {
  const teks = Math.abs(n).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${teks}%`;
}

/** Qty bahan, format Indonesia, maksimal 2 desimal. */
export function qtyBahan(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
