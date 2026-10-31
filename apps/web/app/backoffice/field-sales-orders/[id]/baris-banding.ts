import type { FieldSalesOrderDetail } from "@/lib/field-sales/queries";
import type { AppealedLine } from "./ApproveRejectCard";

type BarisPesanan = FieldSalesOrderDetail["lines"][number];

/** Di kartu persetujuan kedua kolom ini opsional; di sini wajib agar tidak bisa terlupa lagi. */
export type BarisBanding = AppealedLine & Required<Pick<AppealedLine, "lineDiscount" | "promoName">>;

/**
 * Baris yang harganya dibanding salesman, untuk kartu persetujuan. Potongan promo baris
 * dan nama promonya ikut dikirim: harga final menggugurkan promo itu, dan tanpa keduanya
 * peringatan per baris "promo gugur" tidak pernah tampil.
 */
export function barisBanding(lines: BarisPesanan[]): BarisBanding[] {
  return lines
    .filter((line) => line.requestedUnitPrice != null)
    .map((line) => ({
      id: line.id,
      productName: line.productName,
      variantLabel: line.variantLabel,
      variantSku: line.variantSku,
      unitPrice: line.unitPrice,
      requestedUnitPrice: line.requestedUnitPrice as number,
      appealReason: line.appealReason,
      lineDiscount: line.discountAmount,
      promoName: line.appliedPromoName,
    }));
}
