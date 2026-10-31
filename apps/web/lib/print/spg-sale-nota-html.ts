/**
 * SPG-sale thermal nota — narrow single-column receipt for 58 mm or 80 mm
 * paper, monospace, self-contained `<div>` + inline `<style>`. Pure function:
 * no I/O, no @elorae/db import — safe to call from a client component.
 * Adapted from lib/print/van-sale-nota-html.ts — the buyer is always the
 * SPG's assigned store (SpgSale.storeId is required, unlike VanSale's
 * optional store/walk-in buyer).
 *
 * Selalu bahasa Indonesia: nota dibawa pembeli ke kasir toko.
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

/**
 * Exact 2dp, for the rows above a rounded TOTAL only (Subtotal, the discount breakdown and the
 * rounding row): whole-rupiah would print them so they no longer add up to the TOTAL, and a
 * Subtotal identical to the already-rounded TOTAL — the very difference those rows explain.
 */
function rupiahExact(n: number): string {
  return `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function adjustmentExact(n: number): string {
  return `${n >= 0 ? "+" : "-"}${rupiahExact(Math.abs(n))}`;
}

function roundingRow(adjustment: number): string {
  return `<div class="tot-row"><span>Pembulatan tunai</span><span>${adjustmentExact(adjustment)}</span></div>
  `;
}

/**
 * The Subtotal and rounding rows of a receipt without discounts, printed only when the
 * whole-rupiah TOTAL differs from the exact line sum. Same rule and labels as the cash screens.
 */
function roundingRows(subtotal: number, adjustment: number): string {
  if (adjustment === 0) return "";
  return `<div class="tot-row"><span>Subtotal</span><span>${rupiahExact(subtotal)}</span></div>
  ${roundingRow(adjustment)}`;
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
    // Dipanggil di klien: tanpa zona tetap, HP di luar WIB mencetak jam lain.
    timeZone: "Asia/Jakarta",
  });
}

type NotaUntukRincian = Pick<SpgSaleDetail, "subtotal" | "total" | "discountTotal" | "orderPromoName" | "orderDiscount" | "manualDiscount" | "lines"> &
  Partial<Pick<SpgSaleDetail, "memberDiscount" | "memberTier">> & {
    lines: Array<SpgSaleDetail["lines"][number] | Omit<SpgSaleDetail["lines"][number], "promoDiscount">>;
  };

export type RincianBarisNota = {
  /** qty × harga sebelum potongan. */
  kotor: number;
  /** Nama promo barang di baris ini, kalau ada. */
  promo: string | null;
  /**
   * Potongan baris yang boleh ditulis di baris itu sendiri, atau null.
   * Hanya kalau seluruh potongan nota berasal dari promo barang: begitu ada
   * promo belanja atau diskon SPG, potongan baris (`SpgSaleLine.discount`)
   * ikut memuat bagian keduanya, dan menulisnya di bawah nama promo barang
   * akan salah label. Rinciannya kemudian ada di ringkasan bawah.
   * Nota yang punya rincian promo (sejak 2026-10-20) selalu menulis bagian
   * promo barangnya sendiri, persis.
   */
  potongan: number | null;
};

export type RincianNota = {
  baris: RincianBarisNota[];
  subtotal: number;
  /** Potongan promo barang seluruh nota (seluruh potongan − promo belanja − diskon member − diskon SPG). */
  promoBarang: number;
  promoBelanja: { nama: string; potongan: number } | null;
  /** Diskon member dan tingkatnya, atau null. */
  diskonMember: { tingkat: string; potongan: number } | null;
  diskonSpg: number;
  potonganTotal: number;
  /**
   * Pembulatan tunai: TOTAL (rupiah utuh, dibulatkan penulis nota) − jumlah persisnya
   * (subtotal − seluruh potongan). 0 kalau tidak ada yang dibulatkan, termasuk nota lama.
   */
  pembulatan: number;
  total: number;
};

/**
 * Rincian nota untuk dicetak dan ditampilkan — satu tempat, supaya HP, kantor,
 * dan kertas nota membaca angka yang sama. Jumlah baris kotor = subtotal;
 * promo barang + promo belanja + diskon member + diskon SPG = seluruh potongan; subtotal −
 * seluruh potongan = total persis (= jumlah nilai bersih baris, dijamin penulis nota), dan
 * total persis + pembulatan = TOTAL rupiah utuh yang ditagih.
 */
export function rincianNotaSpg(sale: NotaUntukRincian): RincianNota {
  const promoBelanja = sale.orderDiscount > 0 ? { nama: sale.orderPromoName ?? "Promo belanja", potongan: sale.orderDiscount } : null;
  const diskonSpg = Math.max(0, sale.manualDiscount);
  const member = Math.max(0, sale.memberDiscount ?? 0);
  const diskonMember = member > 0 ? { tingkat: sale.memberTier ?? "Member", potongan: member } : null;
  const potonganTotal = Math.max(0, sale.discountTotal);
  const promoBarang = Math.max(0, Math.round((potonganTotal - (promoBelanja?.potongan ?? 0) - member - diskonSpg) * 100) / 100);
  const hanyaPromoBarang = !promoBelanja && diskonSpg === 0 && member === 0;
  return {
    baris: sale.lines.map((l) => {
      const persis = "promoDiscount" in l && l.promoDiscount !== null ? l.promoDiscount : null;
      return {
        kotor: l.qty * l.unitPrice,
        promo: l.promoName,
        potongan: persis !== null ? (persis > 0 ? persis : null) : hanyaPromoBarang && l.discount > 0 ? l.discount : null,
      };
    }),
    subtotal: sale.subtotal,
    promoBarang,
    promoBelanja,
    diskonMember,
    diskonSpg,
    potonganTotal,
    pembulatan: Math.round((sale.total - (sale.subtotal - (potonganTotal > 0 ? potonganTotal : 0))) * 100) / 100,
    total: sale.total,
  };
}

/**
 * Berapa jenis potongan di nota (promo barang, promo belanja, diskon SPG).
 * Baris "Total potongan" hanya dicetak kalau lebih dari satu — dengan satu
 * jenis saja ia mengulang angka yang sama persis dan terbaca seperti dua potongan.
 */
export function jenisPotongan(r: Pick<RincianNota, "promoBarang" | "promoBelanja" | "diskonSpg"> & Partial<Pick<RincianNota, "diskonMember">>): number {
  return (r.promoBarang > 0 ? 1 : 0) + (r.promoBelanja ? 1 : 0) + (r.diskonMember ? 1 : 0) + (r.diskonSpg > 0 ? 1 : 0);
}

export function spgSaleNotaHtml(sale: SpgSaleDetail): string {
  const r = rincianNotaSpg(sale);
  // Pembeli membayar di kasir toko, bukan ke SPG — nota ini dibawa ke kasir.
  // Hanya penjualan lama yang benar-benar mencatat uang kembalian yang
  // masih mencetak baris tunai.
  const bayar =
    sale.changeGiven > 0
      ? `<div class="tot-row"><span>TUNAI</span><span class="amt">${rupiah(sale.cashReceived)}</span></div>
  <div class="tot-row"><span>KEMBALI</span><span class="amt">${rupiah(sale.changeGiven)}</span></div>`
      : `<div class="footer">Bayar di kasir toko</div>`;
  const lines = sale.lines
    .map((l, i) => {
      const b = r.baris[i];
      const name = `${esc(l.productName)}${l.variantSku ? ` (${esc(l.variantSku)})` : ""}`;
      const promo = b.promo
        ? `<div class="line-promo"><span>${esc(b.promo)}</span>${b.potongan !== null ? `<span class="amt">-${rupiah(b.potongan)}</span>` : ""}</div>`
        : b.potongan !== null
          ? `<div class="line-promo"><span>Potongan</span><span class="amt">-${rupiah(b.potongan)}</span></div>`
          : "";
      return `<div class="line">
        <div class="line-name">${name}</div>
        <div class="line-detail">
          <span>${l.qty} x ${rupiah(l.unitPrice)}</span>
          <span class="amt">${rupiah(b.kotor)}</span>
        </div>${promo}
      </div>`;
    })
    .join("");

  // Nota lama (sebelum promo konter) tanpa potongan dicetak seperti dulu: hanya TOTAL.
  // Saat TOTAL dibulatkan, rincian di atasnya dicetak sampai sen supaya tetap terjumlah ke TOTAL.
  const uang = r.pembulatan !== 0 ? rupiahExact : rupiah;
  const ringkasan =
    r.potonganTotal > 0
      ? `<div class="tot-row"><span>Subtotal</span><span class="amt">${uang(r.subtotal)}</span></div>
  ${r.promoBarang > 0 ? `<div class="tot-row"><span>Promo barang</span><span class="amt">-${uang(r.promoBarang)}</span></div>` : ""}
  ${r.diskonMember ? `<div class="tot-row"><span>Diskon member (${esc(r.diskonMember.tingkat)})</span><span class="amt">-${uang(r.diskonMember.potongan)}</span></div>` : ""}
  ${r.promoBelanja ? `<div class="tot-row"><span>${esc(r.promoBelanja.nama)}</span><span class="amt">-${uang(r.promoBelanja.potongan)}</span></div>` : ""}
  ${r.diskonSpg > 0 ? `<div class="tot-row"><span>Diskon SPG</span><span class="amt">-${uang(r.diskonSpg)}</span></div>` : ""}
  ${jenisPotongan(r) > 1 ? `<div class="tot-row"><span>Total potongan</span><span class="amt">-${uang(r.potonganTotal)}</span></div>` : ""}
  ${r.pembulatan !== 0 ? roundingRow(r.pembulatan) : ""}<div class="divider thin"></div>`
      : "";
  const hemat = r.potonganTotal > 0 ? `<div class="center hemat">Anda hemat ${rupiah(r.potonganTotal)}</div>` : "";
  const pembeli = sale.customer
    ? `<div class="buyer-label">Pembeli</div>
  <div class="buyer">${esc(sale.customer.name)}</div>`
    : "";

  return `<div class="spg-nota">
  <style>
    .spg-nota {
      width: 100%;
      max-width: 280px;
      box-sizing: border-box;
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
    .spg-nota .salesman { margin-top: 2px; word-break: break-word; }
    .spg-nota .docno { margin-top: 6px; font-weight: 700; word-break: break-all; }
    .spg-nota .date { color: #555; }
    .spg-nota .divider {
      border-top: 1px dashed #999;
      margin: 8px 0;
    }
    .spg-nota .divider.thin { margin: 4px 0; }
    .spg-nota .buyer-label {
      font-size: 10px;
      letter-spacing: 0.08em;
      color: #555;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .spg-nota .buyer { word-break: break-word; }
    .spg-nota .buyer + .buyer-label { margin-top: 6px; }
    .spg-nota .lines { margin: 2px 0; }
    .spg-nota .line { margin-bottom: 6px; }
    .spg-nota .line:last-child { margin-bottom: 0; }
    .spg-nota .line-name { word-break: break-word; }
    .spg-nota .line-detail,
    .spg-nota .line-promo,
    .spg-nota .tot-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      column-gap: 8px;
      font-variant-numeric: tabular-nums;
    }
    .spg-nota .line-detail { color: #333; }
    .spg-nota .line-promo { color: #333; font-size: 11px; padding-left: 8px; }
    .spg-nota .line-promo span:first-child,
    .spg-nota .tot-row span:first-child { min-width: 0; word-break: break-word; }
    .spg-nota .amt {
      margin-left: auto;
      text-align: right;
      white-space: nowrap;
    }
    .spg-nota .tot-row { margin-bottom: 2px; }
    .spg-nota .tot-row.grand {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .spg-nota .hemat { margin-top: 4px; }
    .spg-nota .footer {
      text-align: center;
      margin-top: 10px;
      font-weight: 700;
    }
    @media print {
      /* Kertas mengikuti printer (58 mm atau 80 mm); di kertas lebar nota tetap selebar 80 mm. */
      @page { margin: 0; }
      .spg-nota { width: 100%; max-width: 80mm; padding: 3mm 2mm; }
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
  ${pembeli}
  <div class="divider"></div>
  <div class="lines">${lines}</div>
  <div class="divider"></div>
  ${ringkasan}${r.potonganTotal > 0 ? "" : roundingRows(r.subtotal, r.pembulatan)}
  <div class="tot-row grand"><span>TOTAL</span><span class="amt">${rupiah(r.total)}</span></div>
  ${hemat}
  ${bayar}
  <div class="divider"></div>
  <div class="footer">Terima kasih</div>
</div>`;
}
