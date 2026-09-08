"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Printer, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buildSettlementBkmPrintHtml } from "@/lib/print/settlement-bkm-html";
import type { SettlementPrintDetail } from "@/lib/finance/ar-settlement/queries";

const rupiah = (n: number): string => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/* Caps the readiness-poll below — guards against a document that never finishes loading at all. */
const MAX_IFRAME_READY_ATTEMPTS = 300;

/**
 * Mirrors `apps/web/app/pwa/spg/[saleId]/nota/NotaView.tsx`'s shape (Card + sticky bottom bar +
 * `print:hidden` chrome), with deliberate differences: the copy fed to the builder's `labels`
 * comes from the `settlementBkm` locale namespace rather than being hardcoded, since the
 * backoffice caller in Task 4 needs the identical string set; and the document renders inside an
 * `<iframe srcDoc>` rather than a `dangerouslySetInnerHTML` div. `spgSaleNotaHtml` returns a bare,
 * class-scoped `<div>` fragment, safe to inject directly — `buildSettlementBkmPrintHtml` is from
 * the A4-document family instead (`print-theme.ts`'s `printPagePortrait`) and returns a FULL
 * `<html><head><style>…` document. Fragment parsing drops the stray `<html>`/`<head>`/`<body>`
 * wrapper but still attaches its `<style>` to the LIVE document — and that style's bare
 * `body { padding; background; font-size; … }` is unlayered, so per the cascade-layers spec it
 * beats every rule the app's own `globals.css` puts under `@layer base`, regardless of order or
 * specificity. Injected as a div, the whole app would carry the print document's padding,
 * background and font size for as long as this route stayed mounted. An iframe is a real,
 * separate document, so its styles cannot leak.
 */
export function BkmView({ settlement }: { settlement: SettlementPrintDetail }) {
  const t = useTranslations("settlementBkm");
  const [canShare, setCanShare] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /* A placeholder while the iframe loads; the effect below replaces it once measured. */
  const [iframeHeight, setIframeHeight] = useState(480);

  /**
   * Feature-detect after mount only — navigator is undefined during SSR and checking it during
   * render would desync the server/client markup.
   */
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const html = buildSettlementBkmPrintHtml({
    docNo: settlement.docNo,
    status: settlement.status,
    storeName: settlement.storeName,
    salesmanName: settlement.salesmanName,
    createdAt: settlement.createdAt,
    note: settlement.note,
    invoices: settlement.invoices,
    deductions: settlement.deductions,
    invoiceTotal: settlement.invoiceTotal,
    returTotal: settlement.returTotal,
    programTotal: settlement.programTotal,
    adminFeeBase: settlement.adminFeeBase,
    adminFee: settlement.adminFee,
    adminFeePercent: settlement.adminFeePercent,
    expectedAmount: settlement.expectedAmount,
    actualAmount: settlement.actualAmount,
    varianceAmount: settlement.varianceAmount,
    labels: {
      title: t("title"),
      doc: t("doc"),
      date: t("date"),
      status: t("status"),
      statusPending: t("statusPending"),
      statusApproved: t("statusApproved"),
      statusRejected: t("statusRejected"),
      store: t("store"),
      salesman: t("salesman"),
      invoiceSection: t("invoiceSection"),
      no: t("no"),
      invoiceNo: t("invoiceNo"),
      agreedAmount: t("agreedAmount"),
      deductionSection: t("deductionSection"),
      type: t("type"),
      percent: t("percent"),
      amount: t("amount"),
      deductionNote: t("deductionNote"),
      typeReturOffset: t("typeReturOffset"),
      typeProgram: t("typeProgram"),
      typeAdminFee: t("typeAdminFee"),
      invoiceTotal: t("invoiceTotal"),
      returTotal: t("returTotal"),
      programTotal: t("programTotal"),
      adminFeeBase: t("adminFeeBase"),
      adminFee: t("adminFee"),
      expected: t("expected"),
      actual: t("actual"),
      variance: t("variance"),
      regards: t("regards"),
      receivedBy: t("receivedBy"),
      issuedBy: t("issuedBy"),
      footerTitle: t("footerTitle"),
      footerNote: t("footerNote"),
    },
  });

  /**
   * Sizes the iframe from its own content rather than a single `onLoad` firing once.
   * `srcDoc` iframes have known `load`-reliability quirks on some older WebKit/iOS builds, and
   * the print document has no fixed width of its own, so its real height changes whenever the
   * available width does — rotating the phone included. Polling `readyState` (instead of waiting
   * for the `load` EVENT, which is exactly what can silently fail to dispatch) is what makes this
   * independent of that quirk: `contentDocument` is reachable immediately (`srcdoc` is
   * same-origin, `about:srcdoc` inherits the parent's origin, no CORS trip), but its
   * `documentElement` is a throwaway node until the real navigation finishes, so this waits for
   * `readyState` to leave `"loading"` before treating the reference as stable. Once stable, a
   * single `ResizeObserver` on that element covers every later width-driven reflow — rotation
   * included — with no further dependency on any one-shot event. `MAX_IFRAME_READY_ATTEMPTS` only
   * guards against a document that never finishes loading at all; ordinary content (no external
   * resources here) settles within the first frame or two.
   */
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    let rafId: number | undefined;
    let attempts = 0;
    let cancelled = false;

    function attach(): void {
      if (cancelled) return;
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.documentElement || doc.readyState === "loading") {
        attempts += 1;
        if (attempts > MAX_IFRAME_READY_ATTEMPTS) return;
        rafId = requestAnimationFrame(attach);
        return;
      }
      const target = doc.documentElement;
      setIframeHeight(target.scrollHeight);
      if (typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(() => setIframeHeight(target.scrollHeight));
      observer.observe(target);
    }

    attach();

    return () => {
      cancelled = true;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [html]);

  /* Prints only the iframe's own document — the sticky bar and header never enter the dialog. */
  function handlePrint(): void {
    iframeRef.current?.contentWindow?.print();
  }

  async function handleShare(): Promise<void> {
    try {
      await navigator.share({
        title: t("title"),
        text: t("shareText", { docNo: settlement.docNo, amount: rupiah(settlement.actualAmount) }),
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
          <Link href="/pwa/pelunasan">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <div className="print:hidden">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{settlement.docNo}</p>
      </div>

      <Card className="mx-auto w-full max-w-2xl gap-0 overflow-hidden py-0">
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title={t("title")}
          className="block w-full border-0"
          style={{ height: iframeHeight }}
        />
      </Card>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] print:hidden">
        <Button type="button" size="lg" className="flex-1" onClick={handlePrint}>
          <Printer className="h-4 w-4" />
          {t("print")}
        </Button>
        {canShare && (
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
            {t("share")}
          </Button>
        )}
      </div>
    </div>
  );
}
