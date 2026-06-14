# Fulfillment Print Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two print views (pick list + packing slip) as sub-routes of the sales order detail page, with auto-`window.print()` on mount and `@media print` rules that filter to a single print-root subtree.

**Architecture:** Pure `apps/web` add. Two new server pages reuse sub-B's `getSalesOrderById` query. Each renders a thin client component that injects inline `<style>` CSS and calls `window.print()` from `useEffect`. Entry: two new buttons on the Fulfillment Card (sub-B) targeted to the print routes in a new tab. No schema, no api change, no new tests beyond what existing layers already cover.

**Tech Stack:** Next.js 16 App Router (RSC), `next-intl`, shadcn Button + Card.

**Spec:** `docs/superpowers/specs/2026-06-14-fulfillment-print-views-design.md`

---

## File Structure

**New files:**

```
apps/web/lib/sales-orders/print-styles.ts                            # CSS string + brand constants

apps/web/app/backoffice/sales-orders/[id]/pick-list/page.tsx         # server: pick list
apps/web/app/backoffice/sales-orders/[id]/pick-list/PickListPrint.tsx       # client

apps/web/app/backoffice/sales-orders/[id]/packing-slip/page.tsx      # server: packing slip
apps/web/app/backoffice/sales-orders/[id]/packing-slip/PackingSlipPrint.tsx # client
```

**Modified files:**

```
apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx        # + two print buttons
apps/web/lib/rbac.ts                                                 # + 2 ROUTE_PERMISSIONS entries
apps/web/lib/i18n/messages/en.json                                   # + salesOrdersPrint namespace
apps/web/lib/i18n/messages/id.json                                   # + same in Indonesian
```

**Reused (no modification):**

- `getSalesOrderById` from `@/lib/sales-orders/queries` — already returns everything needed (line items, buyer, shipping, tracking, courier).
- `formatDateTime` from `@/lib/sales-orders/format`.
- `@/lib/auth` + `@/lib/rbac`.
- shadcn Button + lucide Printer icon.

---

## Task 1: Print CSS + brand constants

Centralised print stylesheet string + the hardcoded brand block constants. Both print pages inject this via `dangerouslySetInnerHTML` on a `<style>` element — no global CSS file needed.

**Files:**
- Create: `apps/web/lib/sales-orders/print-styles.ts`

- [ ] **Step 1: Implement**

`apps/web/lib/sales-orders/print-styles.ts`:

```ts
export const PRINT_STYLES = `
@page { size: A4; margin: 12mm; }

@media print {
  body > :not(.print-root) { display: none !important; }
  nav, aside, .quick-action-fab, [data-sonner-toaster] { display: none !important; }
}

.print-root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 11pt;
  color: #000;
  background: #fff;
  max-width: 186mm;
  margin: 0 auto;
  padding: 12mm 0;
}

.print-root .print-header {
  font-size: 16pt;
  font-weight: 600;
  margin-bottom: 4mm;
}

.print-root .print-subheader {
  font-size: 10pt;
  color: #555;
  margin-bottom: 8mm;
}

.print-root .print-meta {
  margin-bottom: 8mm;
  font-size: 10pt;
}

.print-root .print-meta-row {
  display: flex;
  gap: 8mm;
  margin-bottom: 1mm;
}

.print-root .print-meta-label {
  font-weight: 600;
  min-width: 22mm;
}

.print-root .print-divider {
  border-top: 1px solid #000;
  margin: 4mm 0;
}

.print-root table {
  width: 100%;
  border-collapse: collapse;
  margin: 4mm 0;
}

.print-root th, .print-root td {
  padding: 3px 6px;
  text-align: left;
  vertical-align: top;
  font-size: 10pt;
}

.print-root th {
  border-bottom: 1px solid #000;
  font-weight: 600;
}

.print-root td.num, .print-root th.num {
  text-align: right;
  white-space: nowrap;
}

.print-root .print-signature {
  margin-top: 12mm;
  font-size: 10pt;
}

.print-root .print-signature-line {
  border-bottom: 1px solid #000;
  display: inline-block;
  min-width: 60mm;
  height: 1em;
  margin-left: 2mm;
}

.print-root .print-footer {
  margin-top: 8mm;
  text-align: center;
  font-size: 9pt;
  color: #555;
}

.print-root .print-address-block {
  white-space: pre-line;
  line-height: 1.4;
}
`;

export const BRAND = {
  name: "ELORAÉ",
  address: "Jl. Example No. 123\nJakarta Selatan 12345\nIndonesia",
  email: "support@elorae.example",
} as const;
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/sales-orders/print-styles.ts
git commit -m "feat(web): shared print stylesheet + brand constants"
```

---

## Task 2: Pick list page + client

Server page fetches the order, client renders pick list layout + auto-prints.

**Files:**
- Create: `apps/web/app/backoffice/sales-orders/[id]/pick-list/page.tsx`
- Create: `apps/web/app/backoffice/sales-orders/[id]/pick-list/PickListPrint.tsx`

- [ ] **Step 1: Implement server page**

`apps/web/app/backoffice/sales-orders/[id]/pick-list/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { PickListPrint } from "./PickListPrint";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PickListPrintPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await getSalesOrderById(id);
  if (!data) notFound();

  return <PickListPrint order={data.order} items={data.items} />;
}
```

- [ ] **Step 2: Implement client component**

`apps/web/app/backoffice/sales-orders/[id]/pick-list/PickListPrint.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/sales-orders/format";
import { PRINT_STYLES, BRAND } from "@/lib/sales-orders/print-styles";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";

type Props = { order: SalesOrderDetail; items: SalesOrderItemRow[] };

export function PickListPrint({ order, items }: Props) {
  const t = useTranslations("salesOrdersPrint.pickList");
  const locale = useLocale();

  useEffect(() => {
    window.print();
  }, []);

  const liveItems = items.filter((it) => !it.isCanceledItem);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print-root">
        <div className="print-header">{BRAND.name} — {t("title")}</div>
        <div className="print-divider" />

        <div className="print-meta">
          <div className="print-meta-row">
            <span className="print-meta-label">{t("orderLabel")}</span>
            <span>{order.salesorderNo}</span>
          </div>
          <div className="print-meta-row">
            <span className="print-meta-label">{t("channelLabel")}</span>
            <span>{order.sourceName}</span>
          </div>
          <div className="print-meta-row">
            <span className="print-meta-label">{t("dateLabel")}</span>
            <span>{formatDateTime(order.transactionDate, locale)}</span>
          </div>
        </div>

        <div className="print-divider" />

        <table>
          <thead>
            <tr>
              <th>{t("colSku")}</th>
              <th>{t("colProduct")}</th>
              <th className="num">{t("colQty")}</th>
            </tr>
          </thead>
          <tbody>
            {liveItems.map((it) => (
              <tr key={it.id}>
                <td>{it.jubelioItemCode}</td>
                <td>{it.productName}</td>
                <td className="num">{it.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-signature">
          <div>{t("pickedBy")} <span className="print-signature-line" /></div>
          <div style={{ marginTop: "4mm" }}>
            {t("dateSigned")} <span className="print-signature-line" />
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS. (i18n keys land in Task 5 — but `next-intl` is permissive at compile time; the missing-key warning fires at runtime.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/[id]/pick-list
git commit -m "feat(web): pick list print view"
```

---

## Task 3: Packing slip page + client

Same shape as Task 2, different content. Customer-facing — brand block on top, buyer/shipping block, tracking, items.

**Files:**
- Create: `apps/web/app/backoffice/sales-orders/[id]/packing-slip/page.tsx`
- Create: `apps/web/app/backoffice/sales-orders/[id]/packing-slip/PackingSlipPrint.tsx`

- [ ] **Step 1: Implement server page**

`apps/web/app/backoffice/sales-orders/[id]/packing-slip/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getSalesOrderById } from "@/lib/sales-orders/queries";
import { PackingSlipPrint } from "./PackingSlipPrint";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PackingSlipPrintPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const data = await getSalesOrderById(id);
  if (!data) notFound();

  return <PackingSlipPrint order={data.order} items={data.items} />;
}
```

- [ ] **Step 2: Implement client component**

`apps/web/app/backoffice/sales-orders/[id]/packing-slip/PackingSlipPrint.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/sales-orders/format";
import { PRINT_STYLES, BRAND } from "@/lib/sales-orders/print-styles";
import type { SalesOrderDetail, SalesOrderItemRow } from "@/lib/sales-orders/queries";

type Props = { order: SalesOrderDetail; items: SalesOrderItemRow[] };

export function PackingSlipPrint({ order, items }: Props) {
  const t = useTranslations("salesOrdersPrint.packingSlip");
  const locale = useLocale();

  useEffect(() => {
    window.print();
  }, []);

  const liveItems = items.filter((it) => !it.isCanceledItem);
  const shippingAddressLines = buildShippingLines(order);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print-root">
        <div className="print-header">{BRAND.name}</div>
        <div className="print-address-block">{BRAND.address}</div>
        <div className="print-divider" />

        <div className="print-header" style={{ fontSize: "14pt" }}>
          {t("title")} — {order.salesorderNo}
        </div>
        <div className="print-subheader">
          {formatDateTime(order.transactionDate, locale)}
        </div>

        <div className="print-meta">
          <div style={{ fontWeight: 600, marginBottom: "2mm" }}>{t("shipToLabel")}</div>
          <div className="print-address-block">
            {shippingAddressLines.join("\n")}
          </div>
        </div>

        {(order.courierName || order.trackingNumber) && (
          <div className="print-meta">
            {order.courierName && (
              <div className="print-meta-row">
                <span className="print-meta-label">{t("courierLabel")}</span>
                <span>{order.courierName}</span>
              </div>
            )}
            {order.trackingNumber && (
              <div className="print-meta-row">
                <span className="print-meta-label">{t("trackingLabel")}</span>
                <span style={{ fontFamily: "monospace" }}>{order.trackingNumber}</span>
              </div>
            )}
          </div>
        )}

        <div className="print-divider" />

        <table>
          <thead>
            <tr>
              <th>{t("colSku")}</th>
              <th>{t("colProduct")}</th>
              <th className="num">{t("colQty")}</th>
            </tr>
          </thead>
          <tbody>
            {liveItems.map((it) => (
              <tr key={it.id}>
                <td>{it.jubelioItemCode}</td>
                <td>{it.productName}</td>
                <td className="num">{it.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-footer">
          {t("thankYou")}
          <br />
          {t("questionsContact", { email: BRAND.email })}
        </div>
      </div>
    </>
  );
}

function buildShippingLines(order: SalesOrderDetail): string[] {
  const addr = order.shippingAddress ?? {};
  const lines: string[] = [];
  const name = (addr.full_name as string | undefined) ?? order.customerName;
  if (name) lines.push(name);
  const phone = (addr.phone as string | undefined) ?? order.customerPhone;
  if (phone) lines.push(phone);
  const street = addr.address as string | undefined;
  if (street) lines.push(street);
  const cityProvince = [
    (addr.city as string | undefined) ?? order.shippingCity,
    (addr.province as string | undefined) ?? order.shippingProvince,
  ]
    .filter(Boolean)
    .join(", ");
  if (cityProvince) lines.push(cityProvince);
  const postCode = addr.post_code as string | undefined;
  if (postCode) lines.push(postCode);
  const country = addr.country as string | undefined;
  if (country) lines.push(country);
  return lines;
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/[id]/packing-slip
git commit -m "feat(web): packing slip print view"
```

---

## Task 4: Print buttons on the Fulfillment Card

Add two `<Link target="_blank">`-wrapped buttons in the Fulfillment Card.

**Files:**
- Modify: `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx`

- [ ] **Step 1: Add the imports**

Open `apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx`. Add to the existing imports near the top:

```tsx
import Link from "next/link";
import { Printer } from "lucide-react";
```

(`Link` may already be imported if the file uses it elsewhere — verify and skip if present.)

- [ ] **Step 2: Add print buttons section**

Find the closing `</Card>` of the FulfillmentCard. Directly above it (so it sits as the last block inside the card), insert:

```tsx
        <div className="pt-2 border-t">
          <div className="text-xs text-muted-foreground mb-2">{t("printSection")}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/backoffice/sales-orders/${props.orderId}/pick-list`} target="_blank">
                <Printer className="h-4 w-4 mr-2" />
                {t("printPickList")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/backoffice/sales-orders/${props.orderId}/packing-slip`} target="_blank">
                <Printer className="h-4 w-4 mr-2" />
                {t("printPackingSlip")}
              </Link>
            </Button>
          </div>
        </div>
```

These buttons render regardless of `canFulfill` — view-only users can still print.

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check
```

Expected: PASS.

- [ ] **Step 4: Run web tests**

```bash
pnpm -F @elorae/web test
```

Expected: all green (no new test files; behavior is presentational).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/backoffice/sales-orders/[id]/FulfillmentCard.tsx
git commit -m "feat(web): print buttons on Fulfillment Card"
```

---

## Task 5: RBAC route entries + i18n keys

Both bookkeeping pieces in one commit.

**Files:**
- Modify: `apps/web/lib/rbac.ts`
- Modify: `apps/web/lib/i18n/messages/en.json`
- Modify: `apps/web/lib/i18n/messages/id.json`

- [ ] **Step 1: Add ROUTE_PERMISSIONS entries**

Open `apps/web/lib/rbac.ts`. Locate `ROUTE_PERMISSIONS`. Find the `'/backoffice/sales-orders'` entry. Add these two entries directly below (single quotes — file is pre-flip):

```ts
  '/backoffice/sales-orders/[id]/pick-list': 'sales_orders:view',
  '/backoffice/sales-orders/[id]/packing-slip': 'sales_orders:view',
```

DO NOT touch `BACKOFFICE_ROUTES_ORDER` — print routes aren't nav targets.

Note: the existing `getRequiredPermission` does prefix-match — `/backoffice/sales-orders/<anything>` already resolves to `sales_orders:view` via the parent entry. These dedicated entries are belt-and-suspenders against future prefix-match changes.

- [ ] **Step 2: Add the salesOrdersPrint namespace + Fulfillment Card print keys to en.json**

The Fulfillment Card print buttons use `t("printSection")`, `t("printPickList")`, `t("printPackingSlip")` from the existing `salesOrders.fulfillment` namespace.

Locate `"fulfillment"` block in en.json. Inside it, find the `"action": { ... }` block. After its closing `}`, add a comma and insert:

```json
      "printSection": "Print",
      "printPickList": "Print pick list",
      "printPackingSlip": "Print packing slip",
```

(Place these as siblings of `"action"`, not inside it.)

Then append the new top-level `salesOrdersPrint` namespace at the end of the root object (with leading comma on the previous entry):

```json
  "salesOrdersPrint": {
    "pickList": {
      "title": "Pick List",
      "orderLabel": "Order:",
      "channelLabel": "Channel:",
      "dateLabel": "Date:",
      "colSku": "SKU",
      "colProduct": "Product",
      "colQty": "Qty",
      "pickedBy": "Picked by:",
      "dateSigned": "Date:"
    },
    "packingSlip": {
      "title": "PACKING SLIP",
      "shipToLabel": "Ship to:",
      "courierLabel": "Courier:",
      "trackingLabel": "Tracking:",
      "colSku": "SKU",
      "colProduct": "Product",
      "colQty": "Qty",
      "thankYou": "Thank you for shopping with ELORAÉ!",
      "questionsContact": "For questions: {email}"
    }
  }
```

- [ ] **Step 3: Add the same blocks to id.json with Indonesian strings**

In `apps/web/lib/i18n/messages/id.json`, find the parallel `"fulfillment"` block, add inside it:

```json
      "printSection": "Cetak",
      "printPickList": "Cetak daftar pick",
      "printPackingSlip": "Cetak surat jalan",
```

Then append the `salesOrdersPrint` namespace at the root:

```json
  "salesOrdersPrint": {
    "pickList": {
      "title": "Daftar Pick",
      "orderLabel": "Pesanan:",
      "channelLabel": "Channel:",
      "dateLabel": "Tanggal:",
      "colSku": "SKU",
      "colProduct": "Produk",
      "colQty": "Jml",
      "pickedBy": "Diambil oleh:",
      "dateSigned": "Tanggal:"
    },
    "packingSlip": {
      "title": "SURAT JALAN",
      "shipToLabel": "Kirim ke:",
      "courierLabel": "Kurir:",
      "trackingLabel": "No. Resi:",
      "colSku": "SKU",
      "colProduct": "Produk",
      "colQty": "Jml",
      "thankYou": "Terima kasih telah berbelanja di ELORAÉ!",
      "questionsContact": "Pertanyaan: {email}"
    }
  }
```

- [ ] **Step 4: Verify both JSON files parse + key parity**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/en.json'));"
node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/messages/id.json'));"
pnpm -F @elorae/web type-check
```

All must exit 0.

- [ ] **Step 5: Manual smoke**

User starts the dev server (per `feedback_service_control`):

```bash
pnpm -F @elorae/web dev
```

Then:
- Open `/backoffice/sales-orders/<some-id>`.
- Verify the Fulfillment Card now shows a Print section with two buttons.
- Click "Print pick list" — new tab opens, print dialog auto-appears, preview shows SKU/product/qty + signature footer. No backoffice nav bleeds into the printed pages.
- Click "Print packing slip" — same flow, sees brand block + buyer + shipping address + tracking + items + thank-you footer.
- Switch locale to Indonesian — re-print, labels in Indonesian.
- Test against a cancelled order — print loads, item table is empty (all items filtered out).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/rbac.ts apps/web/lib/i18n/messages/en.json apps/web/lib/i18n/messages/id.json
git commit -m "feat(web): RBAC entries + i18n for print views"
```

---

## Smoke test path (post-merge, not a task)

After merge: no schema, no api restart, no migrations. Vercel auto-deploys.

1. Open any real order detail page.
2. Click "Print pick list" → new tab → auto-print dialog. Cancel + Ctrl+P to retry if needed.
3. Click "Print packing slip" → same flow.
4. Verify both pages render correctly in print preview without nav chrome.
5. Verify Indonesian locale renders Indonesian labels.

## Out-of-scope follow-ups

- Bulk print from Fulfillment Queue: select N rows → print N pick lists / packing slips as one job. UX-wise, the simplest implementation would iterate over `window.open` calls — but browsers throttle popups. A proper solution stitches multiple orders into a single print page with `page-break-after: always` between them. Defer until real demand.
- Editable brand address via a settings UI. Currently the strings live in `print-styles.ts`'s `BRAND` constant. Externalize when the business changes address.
- Order barcode / QR on the pick list — useful for scanner-based warehouse workflows.
- Thermal-label format (3" × 4") for shipping labels — different paper size, different layout. Separate effort.
