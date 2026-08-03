/**
 * SPG-sale thermal nota — narrow single-column receipt (~80mm / 280px),
 * monospace, self-contained `<div>` + inline `<style>`. Pure function:
 * no I/O, no @elorae/db import — safe to call from a client component.
 * Adapted from lib/print/van-sale-nota-html.ts — the buyer is always the
 * SPG's assigned store (SpgSale.storeId is required, unlike VanSale's
 * optional store/walk-in buyer).
 */

import type { SpgSaleDetail } from "@/lib/spg/sale-queries";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function spgSaleNotaHtml(sale: SpgSaleDetail): string {
  const lines = sale.lines
    .map((l) => {
      const name = `${esc(l.productName)}${l.variantSku ? ` (${esc(l.variantSku)})` : ""}`;
      return `<div class="line">
        <div class="line-name">${name}</div>
        <div class="line-detail">
          <span>${l.qty} x ${rupiah(l.unitPrice)}</span>
          <span class="line-total">${rupiah(l.lineTotal)}</span>
        </div>
      </div>`;
    })
    .join("");

  return `<div class="spg-nota">
  <style>
    .spg-nota {
      width: 280px;
      margin: 0 auto;
      padding: 14px 12px;
      background: #fff;
      color: #111;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    .spg-nota .center { text-align: center; }
    .spg-nota .header { text-align: center; margin-bottom: 8px; }
    .spg-nota .shop-name { font-size: 14px; font-weight: 700; letter-spacing: 0.04em; }
    .spg-nota .salesman { margin-top: 2px; }
    .spg-nota .docno { margin-top: 6px; font-weight: 700; }
    .spg-nota .date { color: #555; }
    .spg-nota .divider {
      border-top: 1px dashed #999;
      margin: 8px 0;
    }
    .spg-nota .buyer-label {
      font-size: 10px;
      letter-spacing: 0.08em;
      color: #555;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .spg-nota .lines { margin: 2px 0; }
    .spg-nota .line { margin-bottom: 6px; }
    .spg-nota .line:last-child { margin-bottom: 0; }
    .spg-nota .line-name { word-break: break-word; }
    .spg-nota .line-detail {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #333;
    }
    .spg-nota .line-total {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .spg-nota .tot-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-variant-numeric: tabular-nums;
      margin-bottom: 2px;
    }
    .spg-nota .tot-row.grand {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .spg-nota .footer {
      text-align: center;
      margin-top: 10px;
      font-weight: 700;
    }
    @media print {
      @page { size: 80mm auto; margin: 0; }
      .spg-nota { width: 100%; }
    }
  </style>
  <div class="header">
    <div class="shop-name">ELORAE</div>
    <div class="salesman">${esc(sale.salesmanLabel)}</div>
    <div class="docno">${esc(sale.docNo)}</div>
    <div class="date">${esc(fmtDate(sale.createdAtIso))}</div>
  </div>
  <div class="divider"></div>
  <div class="buyer-label">Toko</div>
  <div class="buyer">${esc(sale.storeName)}</div>
  <div class="divider"></div>
  <div class="lines">${lines}</div>
  <div class="divider"></div>
  <div class="tot-row grand"><span>TOTAL</span><span>${rupiah(sale.total)}</span></div>
  <div class="tot-row"><span>TUNAI</span><span>${rupiah(sale.cashReceived)}</span></div>
  <div class="tot-row"><span>KEMBALI</span><span>${rupiah(sale.changeGiven)}</span></div>
  <div class="divider"></div>
  <div class="footer">Terima kasih</div>
</div>`;
}
