# Sales Returns — Reason-Code & Evidence Investigation

**Dates:** 2026-07-27 (initial), 2026-07-28 (gap + channel follow-up)  
**Scope:** Can Elorae answer the reason-code breakdown of marketplace returns (and therefore the ROI of packing video evidence)?  
**Sources:** Jubelio OpenAPI (`docs/jubelio_api_docs.yaml`), Elorae returns ingest/UI code, prod MariaDB (tunnel `:3307`), live Jubelio API (`api2.jubelio.com`).

---

## 1. The business question

Elorae is a garment brand. The ERP currently shows **~368 pending marketplace returns** totaling **≈ Rp 103M** (full `SalesReturn` table as of 2026-07-28; was 358 / Rp 99.4M on 2026-07-27).

The ROI of packing **video evidence** hinges on *why* buyers return:

| If most returns are… | Video evidence impact |
|---|---|
| Size/fit or “tidak sesuai ekspektasi” | Low — video does little; ROI collapses |
| Missing item, wrong item, damaged, or not-returned | High — contestable value Elorae currently loses near 100% with nothing to submit |

**Target outcomes** (desired product model): decision + reason code + resolution deadline, with statuses such as Accepted / Rejected / Disputed-Won / Disputed-Lost / Not Received / Wrong Item Returned.

**Hypothesis checked:** “Jubelio already provides these.”

**Verdict:** **No.** Jubelio exposes return *existence* and Accept/Reject/Not-a-return actions, but **not** structured buyer reason codes, evidence media, dispute outcomes, or resolution deadlines — and live Elorae + Jubelio data confirms those fields are empty.

**Additional findings (2026-07-28):**

1. Elorae’s Rp ~103M is a **lower bound** — Jubelio still lists **~463 return orders** that Elorae never ingested (~516 lines). See §6.
2. `TT-` orders are **TikTok Shop**, labelled by Jubelio as `Shop | Tokopedia` and mapped by Elorae to channel `TOKOPEDIA`. Classic Tokopedia (`TP-`) is tiny. See §7.

---

## 2. Jubelio API capabilities (OpenAPI)

### 2.1 What exists

| Capability | Present? | Notes |
|---|---|---|
| List return lines | Yes | `GET /sales/returns/items/`, `/unprocessed/wms`, `/rejected/`, `/resolved/` |
| Accept return | Yes | `POST /inventory/items/to-return/` (also counts as goods received) |
| Reject return | Yes | `POST /inventory/items/reject-return/` — **requires** free-text `reject_return_reason` |
| Mark “not a return” | Yes | `POST /inventory/items/complete-return/` |
| Line field `reject_return_reason` | Yes | Free-text string; naming/examples are **seller reject** oriented |
| Line field `is_return_resolved` | Yes | Boolean |
| Order cancel fields | Yes | `mp_cancel_reason`, `cancel_reason`, `cancel_reason_detail` (cancel-oriented, not return taxonomy) |
| Sales-return webhook | Thin ping only | `{ action, return_id, return_no }` — no reason/evidence payload |

### 2.2 What does **not** exist (in docs)

- Structured buyer **reason codes** (size/fit, damaged, wrong item, missing, etc.)
- Buyer **video/photo evidence** URLs for returns
- Marketplace **dispute outcomes** (Disputed-Won / Disputed-Lost, …)
- Marketplace **resolution deadline / SLA** fields  
  (`due_date` on WMS sales-return docs is accounting credit-note due, not MP dispute SLA)

### 2.3 Jubelio decision model vs desired model

| Desired | Jubelio |
|---|---|
| Accepted | Accept (`to-return`) |
| Rejected | Reject (`reject-return` + free-text reason) |
| Not Received / Wrong Item / Disputed-Won / Disputed-Lost | **Not modeled** (closest: “not a return” via `complete-return`) |

---

## 3. Current Elorae implementation

### 3.1 Data model

Returns are ingested as **returned SalesOrders** (Jubelio has no separate return entity for marketplace flow). `SalesReturn.jubelioReturnId` stores the Jubelio `salesorder_id`.

| Model | Status / decision enum |
|---|---|
| `SalesReturn` | `PENDING \| ACCEPTED \| REJECTED \| PARTIAL` |
| `SalesReturnItem` | `PENDING \| ACCEPTED \| REJECTED` |

Notable fields:

- `SalesReturnItem.itemReason` — mapped from Jubelio `reject_return_reason` on ingest
- `SalesReturnItem.evidenceUrls` / `r2Keys` — **schema only; never populated** (known tech debt)
- `SalesReturn.rawIngestPayload` — full SO detail JSON retained

### 3.2 Ingest path

Called when SO `internal_status === RETURNED` (webhook + sweeper):

- Upserts `SalesReturn` + items
- Sets `itemReason = apiItem.reject_return_reason ?? null`
- Does **not** overwrite admin decision fields on re-ingest

**Backstop sweeper limitation (root cause of the count gap):**  
`ReturnsSweeperService` only calls `GET /sales/orders/returned-list/?page=1&pageSize=100` every 30 minutes and skips IDs already present. Jubelio’s returned-list reports **totalCount ≈ 878**, so page 1 alone cannot backfill the backlog. See §6.

### 3.3 Channel detection

`detectChannel(source_name)` takes the **last** `|`-separated token (`apps/api/src/jubelio/handlers/_shared/channel-detect.ts`):

| Jubelio `source_name` | Mapped channel |
|---|---|
| `SHOPEE` | `SHOPEE` |
| `Shop \| Tokopedia` | `TOKOPEDIA` |
| `TOKOPEDIA` | `TOKOPEDIA` |
| `Shop \| TikTok` | `TIKTOK` (not observed on return rows) |

Unit tests explicitly expect `Shop | Tokopedia` → `TOKOPEDIA`. See §7 for what that means for seller dashboards.

### 3.4 UI / decisions

- List dashboard: no reason column — UI never renders `itemReason`
- Detail: Accept / Reject only, with hardcoded default reasons (“Customer return accepted/rejected”)
- Reject path **overwrites** `itemReason` with the admin reject string
- Outbound `salesreturn_decision_push` is **unwired** (`HANDLER_NOT_WIRED`)

---

## 4. Prod database sample

Tunnel: `ssh -NL 3307:127.0.0.1:3306` → shared VPS MariaDB.

### 4.1 Snapshot 2026-07-27

| Metric | Value |
|---|---|
| Total `SalesReturn` rows | **358** |
| Status | **358 PENDING** |
| Total value | **Rp 99.435.479** |
| Line items | **398** |
| `itemReason` filled | **0 / 398** |
| Raw `reject_return_reason` filled | **0 / 398** |
| `mp_cancel_reason` / `cancel_reason*` | **0 / 358** |
| `attachment` | **0 / 358** |
| Buyer `note` | **4 / 358** (shipping notes, not return reasons) |

`channel_status` mix (raw SO payloads): `TO_RETURN` 207 · `ORDER_RETURN` 147 · `DELIVERED` 4.

### 4.2 Snapshot 2026-07-28 (set-diff day)

| Metric | Value |
|---|---|
| Headers | **368** |
| Items | **413** |
| Total value | **Rp 103.023.739** |
| `receivedAt` range | **2026-06-30 → 2026-07-27** (ingest timestamps, not order dates) |
| By channel | SHOPEE 213 / Rp 61.3M · TOKOPEDIA 155 / Rp 41.8M |
| Prefix → channel | `SP→SHOPEE` 213 · `TT→TOKOPEDIA` 154 · `TP→TOKOPEDIA` 1 |

**Implication for reason codes:** Even mining free-text in Elorae cannot produce a size/fit vs contestable breakdown — those fields are empty on every ingested row.

---

## 5. Live Jubelio API probe (reason fields)

Authenticated against `https://api2.jubelio.com` (2026-07-27).

### 5.1 List endpoints

| Endpoint | HTTP | `totalCount` | Reason filled (scanned) |
|---|---|---|---|
| `GET /sales/returns/items/` | 200 | **978** (later **992**) | **0 / 300+** |
| `GET /sales/returns/items/unprocessed/wms` | 200 | same | **0 / 300** |
| `GET /sales/returns/items/rejected/` | 200 | **0** | — |
| `GET /sales/returns/items/resolved/` | 200 | **0** | — |

Response keys are logistics/identity only plus empty `reject_return_reason` / null `is_return_resolved`. **No evidence/media/reason-code fields.**

### 5.2 Per-order spot checks

Examples: `SP-260724FCSYUED1`, `SP-260725JRJ4VSP7`, `SP-260722ADN59YW6`, `TT-585195834647218058-128001` — found on returns lists with `reject_return_reason: ""`; matching SO detail likewise null on reason/cancel/attachment.

### 5.3 Interpretation of `reject_return_reason`

Field is for **seller rejection text** when calling reject, not a populated buyer marketplace reason. Elorae has never rejected/resolved via Jubelio (`rejected`/`resolved` lists empty), so the field stays blank everywhere.

---

## 6. Count gap: Jubelio 992 lines vs Elorae ~413 items (closed 2026-07-28)

Colleague concern: if Jubelio sees ~978–992 unprocessed lines and Elorae holds ~398–413, Rp 99–103M understates exposure and ROI sits on sand.

### 6.1 Apples-to-apples (full Jubelio `/sales/returns/items/` census)

| | Jubelio (2026-07-28) | Elorae (2026-07-28) |
|---|---|---|
| Lines / items | **992** | **413** |
| Unique orders / headers | **782** | **368** |
| Avg lines per order | **1.27** | **~1.12** |

**Line-vs-header counting only explains ~1.3×, not ~2.5×.** The gap is mostly **missing orders**.

### 6.2 Set-diff (Jubelio order IDs ∩ Elorae `jubelioReturnId`)

| Set | Orders | Lines (Jubelio) |
|---|---|---|
| In both | **319** | — |
| Only in Jubelio (not ingested) | **463** | **516** |
| Only in Elorae (not on current Jubelio unprocessed list) | **49** | — |

The 49 “only in Elorae” rows are expected noise (resolved/removed from Jubelio’s unprocessed list after ingest, or timing).

### 6.3 Why the missing 463 were never ingested

1. **Ingest start date.** Earliest Elorae `receivedAt` is **2026-06-30**. Missing Jubelio orders’ transaction months:

   | Month (order `transaction_date`) | Missing orders |
   |---|---|
   | 2026-03 | 41 |
   | 2026-04 | 155 |
   | 2026-05 | 172 |
   | 2026-06 | 95 |
   | 2026-07 | 0 among “only Jubelio” |

   So the backlog is **pre–feature-go-live / pre-reliable-webhook**, not “status filtering on the ERP list UI.”

2. **Sweeper only reads page 1.** `GET /sales/orders/returned-list/` reports **totalCount ≈ 878**, but `ReturnsSweeperService` fetches **`page=1&pageSize=100`** only. It can never walk the historical backlog.

3. **Missing mix by marketplace prefix:** SP 348 · TT 111 · TP 4 (same Shopee / TikTok Shop skew as the overall list).

### 6.4 Value understatement

| | Value |
|---|---|
| Elorae ingested total | **Rp 103.0M** |
| Avg value per Elorae return | **≈ Rp 280k** |
| Rough estimate for 463 missing × same avg | **≈ Rp 130M** |

Exact Rp for missing orders needs per-order SO detail (list endpoint has no amount). Directionally: **treat Rp 103M as a lower bound; full unprocessed exposure is likely ~2×.**

### 6.5 Closing action (before ROI modeling)

Paginate Jubelio `returned-list` **or** `/sales/returns/items/` and backfill missing `salesorder_id`s into `SalesReturn`, then re-sum value. Fix the sweeper to walk all pages (or switch the sweeper source to the returns-items list).

---

## 7. TT- channel mapping (closed 2026-07-28)

Colleague concern: client pain is **Shopee + TikTok Shop**, but Elorae shows a large `TOKOPEDIA` share — is that real Tokopedia volume, or Jubelio mislabelling TikTok Shop?

### 7.1 Jubelio live crosstab (all 992 return lines)

| Order prefix | Jubelio `source_name` | Jubelio store | Lines | Orders | `detectChannel` → |
|---|---|---|---|---|---|
| **SP-** | `SHOPEE` | `SHOPEE - elorae.official` | 672 | 531 | **SHOPEE** |
| **TT-** | `Shop \| Tokopedia` | `Shop \| Tokopedia - Elorae` | 311 | 246 | **TOKOPEDIA** |
| **TP-** | `TOKOPEDIA` | `TOKOPEDIA - Elorae (TTS)` | 9 | 5 | **TOKOPEDIA** |

### 7.2 Elorae ingested (368 headers)

| Prefix → channel | Count |
|---|---|
| `SP→SHOPEE` | 213 |
| `TT→TOKOPEDIA` | 154 |
| `TP→TOKOPEDIA` | 1 |

### 7.3 Conclusion

- **TT- = TikTok Shop (Tokopedia Shop post-merger).** Jubelio surfaces it as `Shop | Tokopedia`; Elorae correctly applies its token rule → `TOKOPEDIA`. There is essentially **no `TIKTOK` label** on these return rows.
- **Classic Tokopedia is the tiny `TP-` bucket** (9 lines / 5 orders in Jubelio; 1 header in Elorae) — not the ~150 `TOKOPEDIA`-channel returns in ERP.
- Client pain on Shopee + TikTok Shop matches the data: **SP- + TT- ≈ 99%** of return lines.

**For reason-code / evidence exports:** pull **Shopee** for `SP-`, and **TikTok Shop / Tokopedia Shop (TTS)** for `TT-`. Do **not** treat Elorae `channel=TOKOPEDIA` as “open classic Tokopedia seller center” without checking the order-number prefix.

---

## 8. Conclusions

1. **Jubelio does not provide the reason-code breakdown** needed for the video-evidence ROI question.
2. **Elorae cannot answer it from current data** — `itemReason` and raw payloads are empty on all ingested returns.
3. **Rp ~103M understates unprocessed return exposure** — ~463 Jubelio return orders (~516 lines) were never ingested; rough missing value ~Rp 130M at current averages. Close the backfill before ROI.
4. **`TT-` → `TOKOPEDIA` is Jubelio’s TikTok Shop labelling**, not classic Tokopedia volume. Use prefix (`SP` / `TT` / `TP`) when choosing seller dashboards/APIs.
5. Jubelio *does* support operational Accept / Reject / Not-a-return for WMS; richer outcomes (Disputed-Won/Lost, etc.) would be ERP-local or marketplace-native.
6. Showing a “Reason” column in the ERP UI today would not help until a marketplace data source is wired.

---

## 9. Recommended next steps

1. **Backfill missing returns from Jubelio** (paginate `returned-list` or `/sales/returns/items/`); fix sweeper pagination. Re-sum value → new ROI baseline.
2. **Pull reason (+ media) from marketplace APIs / seller exports**
   - **Shopee** for `SP-` orders
   - **TikTok Shop / Tokopedia Shop (TTS)** for `TT-` orders  
   - Ignore classic Tokopedia unless working the tiny `TP-` set
3. **One-off export** for the last 30–90 days → classify size/fit vs contestable → decide video-evidence investment.
4. **If building in ERP later**
   - Store buyer `reasonCode` / `reasonText` / `evidenceUrls` separately from admin `rejectReason`
   - Do not overwrite buyer reason on Accept/Reject
   - Prefer order-prefix (or a dedicated `marketplace` field) over Jubelio’s `TOKOPEDIA` label for TTS vs classic Tokopedia
   - Map marketplace statuses into the desired outcome enum; treat Jubelio push as Accept/Reject only (and finish wiring `salesreturn_decision_push` if still required for WMS)

---

## 10. Appendix — key code / schema pointers

| Area | Location |
|---|---|
| Schema | `packages/db/prisma/schema.prisma` — `SalesReturn`, `SalesReturnItem` |
| Ingest | `apps/api/src/jubelio/returns/sales-return-ingest.service.ts` |
| Sweeper (page-1 limit) | `apps/api/src/jubelio/returns/returns-sweeper.service.ts` |
| Channel detect | `apps/api/src/jubelio/handlers/_shared/channel-detect.ts` |
| Jubelio SO types | `apps/api/src/jubelio/jubelio-http.client.ts` (`reject_return_reason`, `listReturnedOrders`) |
| Decision writer | `packages/db/src/sales-return-writer.ts` |
| UI list / detail | `apps/web/app/backoffice/returns/` |
| OpenAPI | `docs/jubelio_api_docs.yaml` — `/sales/returns/items*`, `/inventory/items/*-return*` |
| Known debt | `evidenceUrls` never mirrored; `salesreturn_decision_push` unwired; sweeper not paginated (see `CLAUDE.md` follow-ups) |
