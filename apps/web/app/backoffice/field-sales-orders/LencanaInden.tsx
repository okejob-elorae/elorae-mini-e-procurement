"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { FieldSalesOrderListItem } from "@/lib/field-sales/queries";

/**
 * Lencana "Inden · <nama jendela>" untuk pesanan pre-order. Tidak tampil apa
 * pun untuk pesanan stok siap. `tautan` membuka jendela pre-order-nya —
 * jangan dipakai di baris tabel yang barisnya sendiri sudah bisa diklik.
 */
export function LencanaInden({
  preorder,
  tautan = false,
}: {
  preorder: FieldSalesOrderListItem["preorder"];
  tautan?: boolean;
}) {
  const t = useTranslations("fieldSalesOrders.inden");
  if (!preorder) return null;
  const label = preorder.name ? t("lencana", { nama: preorder.name }) : t("lencanaTanpaNama");
  const badge = (
    <Badge variant="outline" className="max-w-[16rem] justify-start border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" title={label}>
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
  if (!tautan) return badge;
  return (
    <Link href={`/backoffice/inden/${preorder.id}`} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {badge}
    </Link>
  );
}
