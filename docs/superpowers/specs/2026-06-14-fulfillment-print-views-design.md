# Fulfillment Print Views — Design

**Status:** Draft → review
**Date:** 2026-06-14
**Scope:** Sub-D of EPIC-04. Two print routes — Pick list + Packing slip — accessible from the order detail page. Single-order only. Browser print (no PDF generation).

## Goal

Warehouse staff prints a pick list to walk the floor and pull items. The same order's packing slip drops inside the package as a buyer-facing receipt.

## Non-goals

- Multi-order batch print from the Fulfillment Queue. Deferred to a sub-D-followup if real demand surfaces.
- PDF generation, headless-browser PDF, server-rendered PDF. Browser print only.
- Thermal-printer label layouts. Standard A4/Letter assumed.
- Custom paper sizes per template. Single CSS layout per page.
- Email / share / download. Print is the only output.

## 1. Routes

| Path | Auth | Purpose |
|------|------|---------|
| `/backoffice/sales-orders/[id]/pick-list` | `sales_orders:view` | Pick list for warehouse staff |
| `/backoffice/sales-orders/[id]/packing-slip` | `sales_orders:view` | Packing slip for inside the package |

Both pages inherit the backoffice layout for on-screen rendering but use `@media print` CSS to hide nav chrome and reset margins when printing. No new layout file required.

## 2. Entry point

Two buttons live in the Fulfillment Card on the order detail page (`/backoffice/sales-orders/[id]`). Placed below the action area (or in the locked banner footer when status blocks the action):

```
┌─ Fulfillment ──────────────────────────────────────────┐
│ Status: PICKED                                          │
│ Timeline: ...                                           │
│ Tracking: ...                                           │
│ [ Finish Pack ]                                         │
│                                                          │
│ ── Print ──                                              │
│ [ Print pick list ]  [ Print packing slip ]              │
└──────────────────────────────────────────────────────────┘
```

Both buttons render as `<Link target="_blank">` so the user keeps the detail page context. Visible whenever the order is viewable (no extra RBAC gate beyond `sales_orders:view`).

## 3. Auto-print on mount

When the print route loads, the client component calls `window.print()` from a `useEffect(() => { window.print(); }, [])`. User sees the rendered page briefly, then the browser print dialog. Cancel → page stays on screen for review; re-trigger via Ctrl+P.

Edge case: if the user navigates back to the print route (e.g. refreshes), `window.print()` fires again. Acceptable — the dialog is a no-op cancel away.

## 4. Pick list layout

A4-sized page (CSS `@page { size: A4; margin: 12mm; }`). Single column.

```
ELORAÉ — Pick List
─────────────────────────────────────────
Order:    TT-583291012717971150-128001
Channel:  Tokopedia
Date:     11 Jun 2026, 10:30
─────────────────────────────────────────

  SKU                  Product                                  Qty
  27000073P-BLK-XL     ELORAÉ Sofia Vol 2 Cargo Pants, Black, XL  1
  28000009K-BLK-XL     ELORAÉ Bella Barrel Pants, Black, XL       2

─────────────────────────────────────────
Picked by: ________________________
Date:      ________________________
```

Lines:

- Header: brand name + "Pick List" title.
- Order meta block: order number, channel name, transaction date.
- Line items table: SKU (`jubelioItemCode`), product name (`productName`), qty. Cancelled items (`isCanceledItem === true`) are excluded entirely — they wouldn't be picked.
- Footer signature block for hand-sign confirmation (printed only).

No bin location, no buyer info, no marketplace fees — internal warehouse document only.

## 5. Packing slip layout

A4-sized page, same CSS approach. Single column.

```
ELORAÉ
Jl. Example No. 123
Jakarta Selatan 12345
─────────────────────────────────────────

PACKING SLIP — TT-583291012717971150-128001
Date: 11 Jun 2026

Ship to:
  Buyer Name
  +62 81234567890
  Jl. Buyer Address, Kelurahan
  Jakarta Selatan, DKI Jakarta 12345
  Indonesia

Courier:  SiCepat
Tracking: ABC123456789XYZ
─────────────────────────────────────────

  SKU                  Product                                Qty
  27000073P-BLK-XL     ELORAÉ Sofia Vol 2 Cargo Pants          1
  28000009K-BLK-XL     ELORAÉ Bella Barrel Pants               2

─────────────────────────────────────────
Thank you for shopping with ELORAÉ!
For questions: support@elorae.example
```

Lines:

- Brand block top-left with hardcoded company address. Pulled from a small i18n constant (no need to fetch from DB).
- Order number + date.
- Buyer info: name, phone, full shipping address (one line per field from `shippingAddress` JSON — `full_name`, `phone`, `address`, `city + ", " + province`, `post_code`, `country`).
- Courier + tracking ONLY when present (sub-A webhook writes these once Jubelio relays the AWB).
- Line items: SKU, product name, qty. Cancelled items excluded.
- Thank-you footer.

Excludes: marketplace fees, payment method, totals (customer doesn't need to re-see what they paid the marketplace).

## 6. Print CSS strategy

A small `lib/sales-orders/print-styles.ts` exports a string constant of the CSS the print pages inject via a `<style dangerouslySetInnerHTML>` tag (avoids a global CSS file just for two routes). Pattern:

```css
@page { size: A4; margin: 12mm; }

@media print {
  /* hide everything outside the print container */
  body > :not(.print-root) { display: none !important; }
  /* clear backoffice layout chrome that bled through */
  nav, aside, header[data-backoffice-header], .quick-action-fab { display: none !important; }
}

.print-root {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11pt;
  color: #000;
  background: #fff;
}
.print-root .print-header { font-size: 16pt; font-weight: 600; }
.print-root table { width: 100%; border-collapse: collapse; }
.print-root th, .print-root td { padding: 4px 6px; text-align: left; }
.print-root th { border-bottom: 1px solid #000; }
```

The print component wraps its content in `<div className="print-root">`. The page renders normally for on-screen review (backoffice chrome visible) but the print preview filters to the print-root subtree.

## 7. Data layer

No new query needed — `getSalesOrderById` (sub-B / sub-A) already returns everything required: order header, items, buyer fields, shipping address, tracking, courier name. The print pages call the same function their detail-page sibling uses.

Cancelled line items (`isCanceledItem === true`) are filtered out in each print component before rendering.

## 8. i18n

New top-level namespace `salesOrdersPrint.*` in en + id, ~25 keys covering pick list + packing slip labels.

Brand block in the packing slip uses three constants — `brand.name`, `brand.address`, `brand.email` — under `salesOrdersPrint.brand`. Single source for both languages. If the address ever needs editing, one file change.

## 9. RBAC

`sales_orders:view` covers both routes — added to `ROUTE_PERMISSIONS`:

```ts
'/backoffice/sales-orders/[id]/pick-list': 'sales_orders:view',
'/backoffice/sales-orders/[id]/packing-slip': 'sales_orders:view',
```

The route prefix-match in `getRequiredPermission` (lib/rbac.ts) already covers nested `/[id]/anything` against `/backoffice/sales-orders` — so the dedicated entries are belt-and-suspenders. Adding them explicitly avoids surprises if route-matching behavior ever changes.

`BACKOFFICE_ROUTES_ORDER` doesn't need new entries (sub-routes don't appear in nav directly).

## 10. Architecture summary

```
[Order detail page Fulfillment Card]
        │
        │ "Print pick list" / "Print packing slip" buttons
        │ target="_blank"
        ▼
[Print server page /backoffice/sales-orders/[id]/<print-type>]
        │
        │ auth + getSalesOrderById
        ▼
[Print client component]
        │ useEffect → window.print() on mount
        │ renders <div class="print-root"> wrapping content
        │ injects <style> with @media print rules
        ▼
[Browser print dialog]
```

No changes to apps/api. No new schema. No new database queries.

## 11. Testing

Minimal — these are presentational components reading sub-A data already covered by sub-B's query tests. No new vitest specs.

Manual smoke:
1. Open `/backoffice/sales-orders/<some-id>` for a real order.
2. Click "Print pick list" → new tab → print dialog opens automatically → preview shows SKUs + qtys without backoffice chrome.
3. Cancel dialog → on-screen page still renders, backoffice nav visible.
4. Same for packing slip — verify buyer + shipping address + courier + tracking populated when present, hidden when null.
5. Locale switch: id-ID renders Indonesian labels + "PACKING SLIP" → "SURAT JALAN", etc.
6. Test against a CANCELLED order — print loads, items list is empty (all cancelled items filtered out). Acceptable edge case.

## 12. Open questions

None blocking.

## 13. Decisions log

| Decision | Resolution |
|----------|------------|
| Routes | Sub-routes of detail page `/backoffice/sales-orders/[id]/pick-list` + `/packing-slip`. |
| Entry point | Two buttons on Fulfillment Card, `target="_blank"`. |
| Auto-print | `window.print()` on mount via `useEffect`. Cancel re-triggerable via Ctrl+P. |
| Print CSS scope | Inline `<style>` tag per page with `@media print` rules. No global CSS file. |
| Layout escape | None needed — `@media print { body > :not(.print-root) { display: none } }` filters to the print subtree. |
| Pick list content | SKU + product name + qty. Signature footer. No bin (Jubelio doesn't expose). |
| Packing slip content | Brand block + order# + buyer + shipping address + courier + tracking + items. No totals/fees. |
| Cancelled items | Filtered out in both views. |
| Bulk print | Out of scope (sub-D-followup if needed). |
| Data layer | Reuses `getSalesOrderById`. No new queries. |
| RBAC | `sales_orders:view` — same as detail page. |

## 14. Out-of-scope follow-ups

- Bulk print from Fulfillment Queue (select N rows → one print job with N pick lists or N packing slips concatenated).
- Editable brand address (settings UI). Currently hardcoded in i18n; one-line code change to externalize.
- Thermal-printer label format (label-sized vs A4).
- PDF download (currently impossible without headless browser; user can "Save as PDF" via print dialog).
- Order barcode / QR on the pick list for scanner workflows.
