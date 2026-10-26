import { toast } from "sonner";

export type PrintHtmlInIframeOptions = {
  /* Localized toast text for a failed print; the English fallback shows only when a caller passes none. */
  errorMessage?: string;
};

/**
 * Prints an already-built HTML document through a hidden, invisible iframe rather than
 * `window.print()` — the caller is very often a full application page (a list, a detail
 * screen), and printing it directly would emit the whole surrounding UI instead of just the
 * document.
 *
 * Shared by every backoffice print trigger. Previously duplicated verbatim between
 * `backoffice/supplier-payments/page.tsx` and `backoffice/inventory/stock-card/page.tsx` — the
 * two copies had drifted slightly (the stock-card one alone guarded a missing `iframe.contentWindow
 * ?.document` with a toast instead of silently doing nothing), so this keeps the more defensive
 * behavior for both call sites rather than picking whichever came first alphabetically.
 *
 * A failed `print()` (it can throw inside the delayed callback, where no caller could catch it)
 * and a missing iframe document both surface as one error toast, with the caller's localized
 * `errorMessage` when given.
 */
export function printHtmlInIframe(html: string, iframeTitle: string, options: PrintHtmlInIframeOptions = {}): void {
  const errorMessage = options.errorMessage ?? "Failed to load for print";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", iframeTitle);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    toast.error(errorMessage);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } catch (err) {
      console.error("[print-html-in-iframe] print() failed", err);
      toast.error(errorMessage);
    }
  }, 350);
  setTimeout(() => {
    iframe.remove();
  }, 1000);
}
