"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CloudOff, Printer, Share2, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDisplayDateTime } from "@/lib/date-only";
import { rincianNotaSpg, spgSaleNotaHtml } from "@/lib/print/spg-sale-nota-html";
import { bacaSelisihTotalDiHp, type SelisihTotal } from "@/lib/pwa/offline/spg-jual-selisih";
import { formatIDR } from "@/lib/sales-orders/format";
import type { SpgSaleDetail } from "@/lib/spg/sale-queries";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

const tanpaLangganan = () => () => undefined;
const bisaBagikanServer = () => false;
const bisaBagikan = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/** "62812…" (bentuk tersimpan) → "0812…" untuk dibaca orang. */
function tampilHp(hp: string): string {
  return hp.startsWith("62") ? `0${hp.slice(2)}` : hp;
}

/**
 * Nota satu penjualan SPG — cetak, bagikan, jual lagi, atau catat barang yang
 * dikembalikan pembeli. Mirrors the van-sale nota view
 * (apps/web/app/pwa/van/[saleId]/nota/NotaView.tsx). The printed receipt
 * itself (`spgSaleNotaHtml`) stays Indonesian: it goes to the shopper.
 *
 * Di atas kertas nota (tidak ikut tercetak): nota yang dicatat tanpa sinyal,
 * pembeli, alasan diskon SPG, dan — kalau HP ini mencatatnya — total di layar
 * saat dijual yang berbeda dari total tercatat (harga/promo dinilai ulang server).
 */
export function NotaView({ sale }: { sale: SpgSaleDetail }) {
  const t = useTranslations("pwa.spgNota.detail");
  const locale = useLocale();
  // Feature-detect lewat useSyncExternalStore: navigator tidak ada di server,
  // dan memeriksanya saat render akan membuat markup server/klien berbeda.
  const canShare = useSyncExternalStore(tanpaLangganan, bisaBagikan, bisaBagikanServer);
  const selisihTeks = useSyncExternalStore(
    tanpaLangganan,
    () => bacaSelisihTotalDiHp(sale.id),
    () => null,
  );
  const selisih = useMemo(() => (selisihTeks ? (JSON.parse(selisihTeks) as SelisihTotal) : null), [selisihTeks]);

  const html = useMemo(() => spgSaleNotaHtml(sale), [sale]);
  const rincian = useMemo(() => rincianNotaSpg(sale), [sale]);

  function handlePrint() {
    window.print();
  }

  async function handleShare() {
    try {
      await navigator.share({
        title: t("shareTitle"),
        // Total BERSIH — yang dibayar pembeli di kasir, sesudah semua potongan.
        text:
          rincian.potonganTotal > 0
            ? t("shareTextSaving", { docNo: sale.docNo, total: formatIDR(sale.total), saving: formatIDR(rincian.potonganTotal) })
            : t("shareText", { docNo: sale.docNo, total: formatIDR(sale.total) }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(t("shareFailed"));
    }
  }

  const adaKeterangan = sale.capturedOffline || sale.customer || rincian.diskonSpg > 0 || rincian.diskonMember || selisih;

  return (
    <div className="flex min-h-dvh flex-col gap-3 p-4">
      <header className="-ml-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa/spg/nota" />
        </Button>
      </header>

      <div className="print:hidden">
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{sale.docNo}</p>
      </div>

      {adaKeterangan ? (
        <Card className="py-0 print:hidden">
          <CardContent className="space-y-2 py-3 text-sm">
            {sale.capturedOffline ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <CloudOff className="h-3 w-3" aria-hidden />
                  {t("offlineBadge")}
                </Badge>
                {sale.syncedAtIso ? (
                  <span className="text-xs text-muted-foreground">{t("syncedAt", { time: formatDisplayDateTime(sale.syncedAtIso, locale) })}</span>
                ) : null}
              </div>
            ) : null}
            {sale.customer ? (
              <p>
                <span className="text-muted-foreground">{t("buyer")}: </span>
                <span className="font-medium">{sale.customer.name}</span>
                <span className="text-muted-foreground tabular-nums"> · {tampilHp(sale.customer.phone)}</span>
              </p>
            ) : null}
            {rincian.diskonMember ? (
              <p className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t("memberDiscount", { tingkat: rincian.diskonMember.tingkat })}</span>
                <span className="shrink-0 whitespace-nowrap tabular-nums">−{formatIDR(rincian.diskonMember.potongan)}</span>
              </p>
            ) : null}
            {rincian.diskonSpg > 0 ? (
              <div>
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">{t("manualDiscount")}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">−{formatIDR(rincian.diskonSpg)}</span>
                </p>
                {sale.manualDiscountReason ? (
                  <p className="text-xs text-muted-foreground">{t("manualReason", { reason: sale.manualDiscountReason })}</p>
                ) : null}
              </div>
            ) : null}
            {selisih ? (
              <p className="text-xs text-amber-800 dark:text-amber-200">
                {t("totalDiffers", { preview: formatIDR(selisih.pratinjau), total: formatIDR(selisih.tercatat) })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mx-auto w-full max-w-[320px] gap-0 overflow-hidden py-0">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Card>

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] print:hidden">
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            {t("print")}
          </Button>
          {canShare && (
            <Button type="button" variant="outline" className="flex-1" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              {t("share")}
            </Button>
          )}
        </div>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/pwa/spg/sale">{t("sellAgain")}</Link>
        </Button>
        <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
          <Link href={`/pwa/spg/${sale.id}/kembali`}>
            <Undo2 className="h-4 w-4" aria-hidden />
            {t("returnGoods")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
