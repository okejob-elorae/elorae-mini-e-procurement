import { toast } from "sonner";

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
 */
export function printHtmlInIframe(html: string, iframeTitle: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", iframeTitle);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    toast.error("Failed to load for print");
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.print();
  }, 350);
  setTimeout(() => {
    iframe.remove();
  }, 1000);
}
