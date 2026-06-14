"use client";

import { useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/sales-orders/format";
import { PRINT_STYLES, BRAND } from "@/lib/sales-orders/print-styles";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";

type Props = { order: SalesOrderDetail; items: SalesOrderItemRow[] };

export function PickListPrint({ order, items }: Props) {
  const t = useTranslations("salesOrdersPrint.pickList");
  const locale = useLocale();

  useEffect(() => {
    window.print();
  }, []);

  const liveItems = items.filter((it) => !it.isCanceledItem);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print-root">
        <div className="print-header">{BRAND.name} — {t("title")}</div>
        <div className="print-divider" />

        <div className="print-meta">
          <div className="print-meta-row">
            <span className="print-meta-label">{t("orderLabel")}</span>
            <span>{order.salesorderNo}</span>
          </div>
          <div className="print-meta-row">
            <span className="print-meta-label">{t("channelLabel")}</span>
            <span>{order.sourceName}</span>
          </div>
          <div className="print-meta-row">
            <span className="print-meta-label">{t("dateLabel")}</span>
            <span>{formatDateTime(order.transactionDate, locale)}</span>
          </div>
        </div>

        <div className="print-divider" />

        <table>
          <thead>
            <tr>
              <th>{t("colSku")}</th>
              <th>{t("colProduct")}</th>
              <th className="num">{t("colQty")}</th>
            </tr>
          </thead>
          <tbody>
            {liveItems.map((it) => (
              <tr key={it.id}>
                <td>{it.jubelioItemCode}</td>
                <td>{it.productName}</td>
                <td className="num">{it.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-signature">
          <div>{t("pickedBy")} <span className="print-signature-line" /></div>
          <div style={{ marginTop: "4mm" }}>
            {t("dateSigned")} <span className="print-signature-line" />
          </div>
        </div>
      </div>
    </>
  );
}
