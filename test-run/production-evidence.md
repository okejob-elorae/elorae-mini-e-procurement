# Production (Plan → PO → WO) smoke evidence

Tested: 2026-08-18 (local, after app rerun)  
Revision: `69e85fa85d399d67ec07f68611355ec070b9a734` (`fix/konsi-suggestions-perf-and-list-total`)  
Browser: Playwright MCP (Chromium)  
Runtime: local `http://localhost:3000` against shared MariaDB via tunnel; `apps/api` running but **no Jubelio menus used**  
Result: **PARTIAL** — make-flow completed via a **manual GENERIC WO** after plan generate failed; plan CMT remains unlinked

## Results

| Case | Result | Evidence |
|---|---|---|
| M-01 Lead time SUP0001 | PASS | SUP0001 chain visible (MATCHING WARNA → … → PENGIRIMAN SABLON, 55 hari). Screenshot of the card was not saved (navigated away). |
| M-02 Plan 2099 draft | PASS | Plan year `cmsy2wrcc0002287k11e0bx06`, leaf `SMOKE-FG-SHIRT` / FG-SHIRT-001, CMT SUP0003 qty 50. |
| M-03 Activate plan | PASS | Aktif + Terkunci. `test-run/screenshots/production/03-plan-active.png` |
| M-04 Generate WO from plan | **FAIL** | 0 created / 1 error. `PlanCmtAllocation.workOrderId` still null. Cause: generate always uses `outputMode: "SKU"` with `variantSku: ""`; `woSchema` requires `variantSku.min(1)` in SKU mode. Latest WOs before workaround were still July seed docs. |
| M-05 PO create + ETA | PASS | **PO/2026/0007** (`cmsy3xn180001mk7kiw74w51e`): SUP0001, FAB-COT-001 130 MTR @ 25.000 = Rp 3.250.000. ETA hint 55 hari → 11 Okt 2026 applied. `05-po-eta-hint.png` |
| M-06 PO submit | PASS | Status Submitted 18/8/2026 11.33.10. Chain still hari ke-1 / MATCHING WARNA. `06-po-submitted-chain.png` |
| M-07 GRN fabric rolls | PASS | **GRN/2026/08/0001**. Rolls `…-R01` 80 m + `…-R02` 50 m. PO CLOSED, received 130/130. `07-grn-two-rolls.png`, `07-grn-receipts-rolls.png` |
| M-08 PO chain after GRN | **PASS with finding** | PO Closed / Selesai / 130/130. Lead-time **strip disappears** on CLOSED — neither auto-advance through remaining steps nor manual confirm is available. MATERIAL_ARRIVED only notified (purchaser badge 9→11). `08-po-closed-after-grn.png` |
| M-09 WO roll allocation | PASS (workaround) | Manual GENERIC **WO/2026/0011** (`cmsy4dd3j000jmk7k7xnn5vyf`): vendor SUP0003, FG-SHIRT-001, consumption 131.25 MTR → planned 50. PO picker only lists SUBMITTED/PARTIAL so CLOSED PO/2026/0007 could not be linked (`poId` null). Rolls: R01 80 + R02 50 + July R01 100 (whole-roll over-alloc +98.75). `09-wo-rolls-allocated.png`, `09-wo-draft.png` |
| M-10 Issue WO | PASS | DRAFT → Diterbitkan. SUP0003 chain 45 hari (SAMPLE PRODUKSI / ACC SAMPLE / PROSES PRODUKSI / PENGIRIMAN BARANG JADI). `issuedAt` 03:45:35Z. `10-wo-issued-chain.png` |
| M-11 Issue fabric | PASS | ISS/2026/08/0001 FABRIC 131.25 MTR. Rolls used 80 + 50 + 1.25 (July remaining 98.75). WO **Dalam Produksi**. `11-issue-fabric.png`, `11-wo-after-fabric-issue.png` |
| M-12 Issue accessories | PASS with finding | Buttons 400 + thread 2.5 dikirim. Document **ISS/2026/08/0002** stored `issueType: FABRIC` because the Issue Type select did not switch to Accessories (UI still showed Fabric). Stock still deducted. |
| M-13 Receive FG | PASS | RCPT/2026/08/0001 qty 50/50. WO **Selesai**, actualQty 50, `completedAt` 03:48:21Z, actualLeadDays 0 vs estimate 45. FG `variantSku ""` 14380 → **14430** (+50). `13-wo-completed.png` |
| M-14 WO detail summary | **PARTIAL** | Header/progress/rolls/Details consumption plan are correct. **Material Issues / FG Receipts / Reconciliation tabs did not switch** after receive. Console: Prisma `Decimal` leaked to the client on `FGReceipt` (`qtyReceived`, `qtyRejected`, `qtyAccepted`, `materialCost`, `avgCostPerUnit`, `totalCostValue`). Next.js overlay showed 5+6 issues. |
| M-15 Plan WO link | **FAIL (expected)** | CMT row still Penjahit Pak Budi 50 with **no WO number**; `workOrderId` null. Grid Terpenuhi 0 / Selisih −50. Consequence of M-04. `15-plan-cmt-no-wo.png` |
| M-N1 / M-N2 | NOT RUN | Optional negatives skipped. |
| GL journals | NOT RUN (GL) | Unmapped CoA; not a pass/fail gate. |

## Database evidence

Outbox count stayed **1** for the whole session (delta 0).

```json
{
  "outbox": 1,
  "wo": {
    "id": "cmsy4dd3j000jmk7k7xnn5vyf",
    "docNumber": "WO/2026/0011",
    "status": "COMPLETED",
    "plannedQty": 50,
    "actualQty": 50,
    "issuedAt": "2026-08-18T03:45:35.122Z",
    "completedAt": "2026-08-18T03:48:21.538Z",
    "chainTotalDays": 45,
    "actualLeadDays": 0,
    "poId": null,
    "rollBreakdown": "R01 80 + R02 50 + GRN/2026/07/0001-R01 100"
  },
  "issues": [
    { "docNumber": "ISS/2026/08/0001", "issueType": "FABRIC", "totalCost": "3307020.94" },
    { "docNumber": "ISS/2026/08/0002", "issueType": "FABRIC", "totalCost": "280000" }
  ],
  "receipts": [
    { "docNumber": "RCPT/2026/08/0001", "qtyReceived": 50, "qtyAccepted": 50, "qtyRejected": 0, "totalCostValue": 3587020.94 }
  ],
  "po": { "docNumber": "PO/2026/0007", "status": "CLOSED", "receivedQty": 130, "chainTotalDays": 55 },
  "grn": "GRN/2026/08/0001",
  "cmtWorkOrderId": null
}
```

Inventory (dual `InventoryValue` rows):

| SKU | variantSku | Before GRN (approx) | After GRN | After fabric issue | After FG receive |
|---|---|---|---|---|---|
| FAB-COT-001 | `null` | 12501.88 | 12501.88 | **12370.63** (−131.25) | 12370.63 |
| FAB-COT-001 | `""` | 100 | **230** (+130) | 230 | 230 |
| FG-SHIRT-001 | `null` | 120 | 120 | 120 | 120 |
| FG-SHIRT-001 | `""` | 14380 | 14380 | 14380 | **14430** (+50) |

GRN credited the `""` fabric row; issue deducted the `null` pooled row. FG receipt credited `""`.

## Outbox

| Checkpoint | Count | Delta |
|---|---|---|
| Session start | 1 | — |
| After PO/GRN/WO/issue/receive | 1 | 0 |

## Findings

1. **Plan generate cannot create a WO for a variantless FG.** `generateWorkOrderFromCmtAllocation` always builds SKU mode with `variantSku` from the color allocation (`""` here). `woSchema` rejects empty `variantSku` when `outputMode === "SKU"`. Error is swallowed per-allocation (`0 created, 0 skipped, 1 errors`). Workaround: manual GENERIC WO.

2. **CLOSED PO hides the lead-time chain.** After a full GRN, the purchaser cannot confirm remaining steps. Arrival is a notification only.

3. **WO PO picker excludes CLOSED POs** (`statusIn: ['SUBMITTED', 'PARTIAL']`), so a fabric PO that already arrived cannot be linked to the CMT WO.

4. **Dual-row inventory on FAB-COT-001 / FG-SHIRT-001.** GRN and FG receipt write `variantSku ""`; fabric issue prefers the `null` row. On-hand totals still add up in the inventory UI; the buckets diverge.

5. **ISS/2026/08/0002 (accessories) stamped `issueType: FABRIC`.** The Radix Issue Type select did not change; lines were still accessories and stock moved.

6. **`FGReceipt` Decimal leak** to the client after receive. WO Issues/Receipts/Reconciliation tabs did not switch; Next overlay listed the Decimal serialization errors. Receipt row exists in DB (`RCPT/2026/08/0001`).

7. **Plan CMT does not pick up a manual WO.** `workOrderId` stays null; grid Terpenuhi stays 0. Expected given M-04.

8. **Issue Materials UI has no roll picker**; it consumes `WorkOrder.rollBreakdown` server-side. That path worked (80+50+1.25).

9. **Production 403** on `/api/suppliers?sync=true` (no `suppliers:view`). WO vendor list still loaded via the server action. Non-blocking.

10. Playwright MCP `locator.click()` often does not open Radix `SearchableCombobox` / `Select` (needs PointerEvents). Not a product defect.

## Screenshots

All under `test-run/screenshots/production/`.
