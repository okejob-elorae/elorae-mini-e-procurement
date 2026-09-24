import type { SellThroughLineDetail } from "@/lib/konsi-sell-through/queries";

/* 2dp on purpose: every invoiced figure carries sen, and whole rupiah would make the lines visibly not add up to the total. */
export function formatRupiahExact(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Resolves `${itemId}::${variantSku}` keys — the shape the pricing rule and the approve writer's
 * UNPRICED refusal both use — back to the product names on the report. A key no line matches is
 * shown raw rather than dropped, so the admin still learns something is unpriced.
 */
export function productNamesForKeys(lines: SellThroughLineDetail[], keys: string[]): string {
  return keys
    .map((key) => {
      const line = lines.find((l) => `${l.itemId}::${l.variantSku}` === key);
      if (!line) return key;
      const variant = line.variantLabel ?? (line.variantSku === "" ? null : line.variantSku);
      return variant ? `${line.productName} (${variant})` : line.productName;
    })
    .join(", ");
}
