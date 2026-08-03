"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { spgSaleNotaHtml } from "@/lib/print/spg-sale-nota-html";
import type { SpgSaleDetail } from "@/lib/spg/sale-queries";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** Mirrors the van-sale nota view (apps/web/app/pwa/van/[saleId]/nota/NotaView.tsx). */
export function NotaView({ sale }: { sale: SpgSaleDetail }) {
  const [canShare, setCanShare] = useState(false);

  /**
   * Feature-detect after mount only — navigator is undefined during SSR and
   * checking it during render would desync the server/client markup.
   */
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const html = useMemo(() => spgSaleNotaHtml(sale), [sale]);

  function handlePrint() {
    window.print();
  }

  async function handleShare() {
    try {
      await navigator.share({
        title: "Nota Penjualan",
        text: `Nota ${sale.docNo} - Total ${rupiah(sale.total)}`,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error("Gagal membagikan nota.");
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/spg/sale">
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      </header>

      <div className="print:hidden">
        <h1 className="text-lg font-semibold">Nota Penjualan</h1>
        <p className="text-sm text-muted-foreground">{sale.docNo}</p>
      </div>

      <Card className="mx-auto w-full max-w-[320px] gap-0 overflow-hidden py-0">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Card>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] print:hidden">
        <div className="flex gap-2">
          <Button type="button" className="flex-1" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Cetak
          </Button>
          {canShare && (
            <Button type="button" variant="outline" className="flex-1" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
              Bagikan
            </Button>
          )}
        </div>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/pwa/spg/sale">Jual Lagi</Link>
        </Button>
      </div>
    </div>
  );
}
