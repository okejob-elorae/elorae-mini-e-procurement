"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDateTime } from "@/lib/date-only";

/*
 * Rincian nilai PO: subtotal, PPN (tarif yang tersimpan di PO), total, lalu
 * pengurang utang — sisa yang tidak akan datang (PO ditutup) dan retur ke
 * pemasok yang selesai. Tampilan saja; GL tidak membaca angka ini.
 */

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export type DataRingkasanUtangPo = {
  status: string;
  totalAmount: number;
  taxAmount: number;
  grandTotal: number;
  ppnRatePercent: number | null;
  closedAt: string | null;
  closeReason: string | null;
  closedByName: string | null;
  returPemasok: Array<{ id: string; docNumber: string; completedAt: string | null; poCreditAmount: number }>;
  utang: { nilaiPo: number; nilaiTidakDatang: number; kreditRetur: number; utang: number };
};

function Baris({ label, nilai, tebal, kurang }: { label: ReactNode; nilai: number; tebal?: boolean; kurang?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 text-sm ${tebal ? "font-semibold" : ""}`}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="shrink-0 tabular-nums">
        {kurang ? "− " : ""}
        {rp(nilai)}
      </span>
    </div>
  );
}

export function RingkasanUtangPo({ po }: { po: DataRingkasanUtangPo }) {
  const t = useTranslations("purchaseOrders.ringkasan");
  const locale = useLocale();
  const adaPengurang = po.utang.nilaiTidakDatang > 0 || po.returPemasok.length > 0;

  return (
    <div className="space-y-3 border-t pt-4">
      {/* Hanya selama masih CLOSED: GRN yang membuka PO lagi tidak menghapus closedAt. */}
      {po.status === "CLOSED" && po.closedAt && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            {t("ditutup", {
              waktu: formatDisplayDateTime(po.closedAt, locale),
              nama: po.closedByName ?? "—",
            })}
          </p>
          {po.closeReason && <p className="mt-1 whitespace-pre-wrap break-words">{t("alasan", { alasan: po.closeReason })}</p>}
        </div>
      )}
      <div className="space-y-1.5 max-w-md ml-auto">
        <Baris label={t("subtotal")} nilai={po.totalAmount} />
        {po.ppnRatePercent == null ? (
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{t("ppnTidakDihitung")}</span>
            <span className="shrink-0 tabular-nums">{rp(po.taxAmount)}</span>
          </div>
        ) : (
          <Baris label={t("ppn", { tarif: po.ppnRatePercent.toLocaleString("id-ID") })} nilai={po.taxAmount} />
        )}
        <Baris label={t("totalPo")} nilai={po.grandTotal} tebal />
        {adaPengurang && (
          <>
            {po.utang.nilaiTidakDatang > 0 && (
              <Baris label={t("tidakDatang")} nilai={po.utang.nilaiTidakDatang} kurang />
            )}
            {po.returPemasok.map((r) => (
              <Baris
                key={r.id}
                label={
                  <Link href={`/backoffice/vendor-returns/${r.id}`} className="underline underline-offset-2">
                    {t("retur", { docNumber: r.docNumber })}
                  </Link>
                }
                nilai={r.poCreditAmount}
                kurang
              />
            ))}
            <Baris label={t("utang")} nilai={po.utang.utang} tebal />
          </>
        )}
      </div>
    </div>
  );
}
