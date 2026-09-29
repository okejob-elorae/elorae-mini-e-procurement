"use client";

import { useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/sales-orders/format";
import { PRINT_STYLES, BRAND } from "@/lib/sales-orders/print-styles";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";
import { logPrintQuietly } from "@/lib/audit/log-print-quietly";
import { ResiBarcode } from "@/components/resi-barcode";
import { isAwaitingResi } from "@/lib/sales-orders/resi-pending";

type Props = {
  order: SalesOrderDetail;
  items: SalesOrderItemRow[];
  lineImages?: Record<string, string>;
};

export function PackingSlipPrint({ order, items, lineImages = {} }: Props) {
  const t = useTranslations("salesOrdersPrint.packingSlip");
  const locale = useLocale();
  const printLogged = useRef(false);

  /* Children's effects run before this one, so `ResiBarcode` has drawn its bars before `window.print()` fires. */
  useEffect(() => {
    /* The ref survives React StrictMode's double effect, so one page open logs one print. */
    if (!printLogged.current) {
      printLogged.current = true;
      logPrintQuietly("SalesOrderPackingSlip", order.id);
    }
    window.print();
  }, [order.id]);

  const liveItems = items.filter((it) => !it.isCanceledItem);
  const shippingAddressLines = buildShippingLines(order);
  const awaitingResi = isAwaitingResi(order);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print-root">
        <div className="print-header">{BRAND.name}</div>
        <div className="print-address-block">{BRAND.address}</div>
        <div className="print-divider" />

        <div className="print-header" style={{ fontSize: "14pt" }}>
          {t("title")} — {order.salesorderNo}
        </div>
        <div className="print-subheader">
          {formatDateTime(order.transactionDate, locale)}
        </div>

        <div className="print-meta">
          <div style={{ fontWeight: 600, marginBottom: "2mm" }}>{t("shipToLabel")}</div>
          <div className="print-address-block">
            {shippingAddressLines.join("\n")}
          </div>
        </div>

        {(order.courierName || order.trackingNumber || awaitingResi) && (
          <div className="print-meta">
            {order.courierName && (
              <div className="print-meta-row">
                <span className="print-meta-label">{t("courierLabel")}</span>
                <span>{order.courierName}</span>
              </div>
            )}
            {order.trackingNumber ? (
              <>
                <div className="print-meta-row">
                  <span className="print-meta-label">{t("trackingLabel")}</span>
                  <span style={{ fontFamily: "monospace" }}>{order.trackingNumber}</span>
                </div>
                <ResiBarcode value={order.trackingNumber} height={56} />
              </>
            ) : awaitingResi ? (
              <div className="print-meta-row">
                <span className="print-meta-label">{t("trackingLabel")}</span>
                <span>{t("resiPending")}</span>
              </div>
            ) : null}
          </div>
        )}

        <div className="print-divider" />

        <table>
          <thead>
            <tr>
              <th style={{ width: "44px" }}></th>
              <th>{t("colSku")}</th>
              <th>{t("colProduct")}</th>
              <th className="num">{t("colQty")}</th>
            </tr>
          </thead>
          <tbody>
            {liveItems.map((it) => {
              const imgKey = it.itemId ? `${it.itemId}|` : null;
              const imgUrl = imgKey ? lineImages[imgKey] : undefined;
              return (
                <tr key={it.id}>
                  <td>
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt=""
                        style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "2px" }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ width: "40px", height: "40px", background: "#e5e7eb", borderRadius: "2px" }} />
                    )}
                  </td>
                  <td>{it.jubelioItemCode}</td>
                  <td>{it.productName}</td>
                  <td className="num">{it.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="print-footer">
          {t("thankYou")}
          <br />
          {t("questionsContact", { email: BRAND.email })}
        </div>
      </div>
    </>
  );
}

function buildShippingLines(order: SalesOrderDetail): string[] {
  const addr = order.shippingAddress ?? {};
  const lines: string[] = [];
  const name = (addr.full_name as string | undefined) ?? order.customerName;
  if (name) lines.push(name);
  const phone = (addr.phone as string | undefined) ?? order.customerPhone;
  if (phone) lines.push(phone);
  const street = addr.address as string | undefined;
  if (street) lines.push(street);
  const cityProvince = [
    (addr.city as string | undefined) ?? order.shippingCity,
    (addr.province as string | undefined) ?? order.shippingProvince,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityProvince) lines.push(cityProvince);
  const postCode = addr.post_code as string | undefined;
  if (postCode) lines.push(postCode);
  const country = addr.country as string | undefined;
  if (country) lines.push(country);
  return lines;
}
