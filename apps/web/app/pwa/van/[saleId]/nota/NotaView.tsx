"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { vanSaleNotaHtml } from "@/lib/print/van-sale-nota-html";
import type { VanSaleDetail } from "@/lib/canvassing/sale-queries";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function NotaView({ sale }: { sale: VanSaleDetail }) {
  const t = useTranslations("vanSale");
  const [canShare, setCanShare] = useState(false);

  // Feature-detect after mount only — navigator is undefined during SSR and
  // checking it during render would desync the server/client markup.
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const html = useMemo(() => vanSaleNotaHtml(sale), [sale]);

  function handlePrint() {
    window.print();
  }

  async function handleShare() {
    try {
      await navigator.share({
        title: t("notaTitle"),
        text: t("shareText", { docNo: sale.docNo, total: rupiah(sale.total) }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(t("shareError"));
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/van">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <div className="print:hidden">
        <h1 className="text-lg font-semibold">{t("notaTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notaSubtitle", { docNo: sale.docNo })}</p>
      </div>

      <Card className="mx-auto w-full max-w-[320px] gap-0 overflow-hidden py-0">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Card>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] print:hidden">
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            {t("printButton")}
          </Button>
          {canShare && (
            <Button type="button" variant="outline" className="flex-1" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              {t("shareButton")}
            </Button>
          )}
        </div>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/pwa/van">{t("sellAgain")}</Link>
        </Button>
      </div>
    </div>
  );
}
