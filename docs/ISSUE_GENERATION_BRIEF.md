# Elorae ERP — Packing Evidence & Returns Dispute Module
## Issue Generation Brief

**Purpose:** This document is the single input for generating GitHub Issues for this module. It is written for an automation agent, not for a human reader.
**Source of truth:** `Elorae_FR_PackingEvidence_Returns_v1.xlsx` (34 requirements, 60 md) and the signed quotation `#OKE-Q-2607-043` (53 md).
**Date:** 2026-07-28
**Status:** Approved for issue generation.

---

## 0. Agent Instructions

Read this entire document before creating anything.

1. **Create labels first** (Section 3.1). Skip any that already exist.
2. **Create milestones second** (Section 3.2).
3. **Create 30 issues**, one per specification in Section 6, in the order listed. Order matters — dependency links reference issue numbers assigned earlier in the run.
4. **Use the body template in Section 3.4 verbatim.** Every section is mandatory. Do not invent sections and do not omit sections.
5. **Record the issue number** returned for each FR code. Later issues reference earlier ones by `#N`.
6. **After all issues exist**, post the dependency comment described in Section 5.3 on each issue that has dependencies.

### Hard rules

- **Do not write application code.** This run creates issues only.
- **Do not invent acceptance criteria.** Use exactly what Section 6 specifies. If a criterion seems incomplete, create the issue as written and add the gap to the `Open Questions` section of that issue body.
- **Verify file paths before writing them into issues.** Section 4 proposes paths based on a prior read of the repository. Where a proposed path does not exist, write the proposed path anyway and prefix that line with `PROPOSED — verify:`. Never silently substitute a different path.
- **Do not create issues for anything in Section 7.** Those items are contractually excluded.
- **Estimates are fixed.** Copy the man-day figure exactly. Do not re-estimate.

### Command pattern

```bash
gh issue create \
  --repo "$REPO" \
  --title "<title>" \
  --body-file "<tmpfile>" \
  --label "<comma,separated,labels>" \
  --milestone "<milestone>"
```

Write each body to a temp file rather than passing inline — bodies contain backticks, pipes and multi-line blocks that will not survive shell interpolation.

---

## 1. Project Context

Elorae is an Indonesian garment brand selling on Shopee and TikTok Shop. Orders and returns reach the Elorae ERP through **Jubelio**, an omnichannel middleware. There is no direct marketplace API access.

**The problem.** Elorae cannot contest marketplace return claims. Two causes:

1. **No evidence.** When a buyer claims `barang kurang`, `salah kirim`, or `rusak`, Elorae has nothing to submit to the resolution centre.
2. **No process.** Production data shows **368 return records, every one of them `PENDING`, with zero decisions ever recorded.** Acceptance rate is undefined because nothing has ever been accepted or rejected. Some fraction of these are lost purely to dispute-window timeout.

Measured exposure is **Rp 103M** across those 368 records, and that is a lower bound — a pagination defect means 463 further return orders were never ingested (see `RT-001`).

**The solution.** Two halves, both inside the existing ERP:

- **Evidence capture** — cameras at the packing line record every pack, keyed to the resi, retrievable on demand.
- **Dispute lifecycle** — returns gain real outcomes, deadlines, reasons, linked evidence, and loss reporting.

---

## 2. Locked Architecture Decisions

These were settled during scoping. **Any issue that contradicts one of these is wrong.** Embed the relevant subset into each issue body under `Constraints`.

### 2.1 The camera is the scanner

The warehouse has one barcode scanner, operated by one person (Atta), feeding Jubelio. **The system never touches that scanner and never introduces a second scan.**

Resi is read optically off the shipping label by the POV cameras. A keyboard-wedge scan carries no line identity; a camera read is intrinsically bound to the stream that produced it, so it yields resi **and** station in a single event.

### 2.2 Physical topology

```
[Atta — POV cam 1]  scans resi into Jubelio, verifies/picks goods
        │
        ├──────────────▶ [Riyan — POV cam 2]  packs, then affixes resi label
        └──────────────▶ [Roi   — POV cam 3]  packs, then affixes resi label

[Wide cam 4] records the whole corridor continuously, local disk only
```

Riyan and Roi are symmetric — both pack and both affix. Assignment between them is ad hoc.

### 2.3 Two trigger points per parcel

| Event | Station | Meaning |
|---|---|---|
| T0 | Atta's camera reads resi | Opens the record. Establishes who verified and when. |
| T1 | Packer's camera reads the same resi at affix | Binds the pack clip **and** identifies which line did the work. |

Line identity is **derived from which camera produced the read**. It is never selected by an operator.

### 2.4 Ring buffer, cut retroactively

The label is affixed **after** goods are inserted, so the trigger fires at the end of the pack. Cameras therefore record continuously into a rolling buffer, and the clip is cut backwards from the trigger.

Buffer depth: **5 minutes.** At 143.8 orders/day average across two packers this is ~200 s/order; at the 500/day campaign peak it is ~115 s/order. Both fit comfortably.

### 2.5 Resi resolution is asynchronous

**Critical.** Elorae does not generate the resi. The AWB is issued by the courier, relayed by Jubelio, and lands on `SalesOrder.trackingNumber` via the `tracking_number` field on the sales-order webhook.

At pack time the ERP may not yet know that resi exists.

> Clips are stored keyed on the **raw decoded resi string**, unresolved. A reconciliation job joins clip to `SalesOrder` when Jubelio later delivers `tracking_number`.

Capture must never block on Jubelio availability, Jubelio latency, or the SO having synced. A synchronous design silently loses evidence on webhook delay.

### 2.6 Evidence integrity

- Timestamp burned into frames is **server-signed**, never the local machine clock. A timestamp from a machine the operator controls is arguable in a dispute.
- SHA-256 per clip, stored in an **append-only** log alongside station, packer, resi and server time.
- The person who created a clip must not be able to delete it.

### 2.7 Identity

Station identity + packer PIN — the KubikPOS pattern. **No individual ERP logins for warehouse staff.** They churn, shifts rotate, account admin becomes a tax.

Packer role scope, for UU PDP compliance: today's own clips only. **No buyer names, no addresses, no historical search.** Supervisor role holds search and export.

### 2.8 Storage split

| Stream | Destination | Retention |
|---|---|---|
| POV clips (order-linked) | Cloudflare R2 | **60 days** |
| Wide camera (continuous) | Local disk | 30 days |

Clips attached to an open dispute are exempt from purge.

> ⚠️ **Discrepancy to resolve.** The FR table specifies 90-day R2 retention; the signed quotation specifies 60 days. **The quotation wins — use 60.** Flag this in `PE-013` so the FR table gets corrected.

### 2.9 Hardware

PoE IP cameras over RTSP, one gigabit switch, one PC. **USB webcams are excluded** — four UVC devices on one host hits bandwidth-reservation limits, and USB's 5 m cable limit does not reach along a packing bench. IP cameras also encode H.264 onboard, so the capture service writes with `-c copy` at near-zero CPU.

### 2.10 No marketplace API

No Shopee Open Platform or TikTok Shop Partner Center access. Buyer reason codes arrive by **CSV import of Seller Centre exports**. Jubelio remains the only programmatic channel and it does not carry reason codes, buyer evidence, dispute outcomes, or resolution deadlines.

### 2.11 SOP dependency

**One order, one packer, start to finish.** If packers split by function — one stuffing, one labelling — the affix camera sees a label going onto a bag it never watched being packed, and the clip proves nothing.

This is a client responsibility (excluded from scope), but the system depends on it. `PE-014` is the control that detects violations.

---

## 3. Repository Conventions

### 3.1 Labels to create

| Label | Colour | Description |
|---|---|---|
| `module:packing-evidence` | `1D76DB` | Camera capture and clip pipeline |
| `module:resi-linking` | `0E8A16` | Clip-to-order resolution |
| `module:returns-dispute` | `5319E7` | Returns lifecycle and dispute workflow |
| `module:deployment` | `B60205` | Packaging, install support, validation |
| `stream:capture-service` | `C5DEF5` | Standalone service on the packing PC |
| `stream:station-ui` | `C5DEF5` | Kiosk interface |
| `stream:erp-api` | `C5DEF5` | `apps/api` |
| `stream:erp-web` | `C5DEF5` | `apps/web` |
| `stream:db` | `C5DEF5` | `packages/db`, Prisma schema |
| `priority:must` | `D93F0B` | MoSCoW Must |
| `priority:should` | `FBCA04` | MoSCoW Should |
| `type:feature` | `A2EEEF` | New capability |
| `type:bugfix` | `D73A4A` | Existing defect |
| `type:spike` | `BFDADC` | Time-boxed investigation |
| `type:infra` | `BFDADC` | Packaging, deployment, ops |
| `gating` | `E99695` | Blocks the start of dependent work |
| `pdp` | `FEF2C0` | Touches personal data — UU PDP relevant |

### 3.2 Milestones to create

| Milestone | Man-days | Description |
|---|---|---|
| `M0 — Gating Validation` | 1.5 | Must complete before M2 begins. Outcomes can change the design. |
| `M1 — Returns Quick Wins` | 5.5 | No hardware dependency. Ships independently and immediately. |
| `M2 — Capture Core` | 18.0 | Capture service, clip pipeline, upload. |
| `M3 — Station & Linking` | 11.5 | Kiosk UI, identity, clip-to-order resolution. |
| `M4 — Dispute Workflow` | 16.5 | Reasons, evidence attachment, export, reporting. |
| **Total** | **53.0** | |

### 3.3 Title format

```
[<FR-CODE>] <Feature-first name>
```

Feature-first, not location-first. `[PE-003] Clip extraction from ring buffer`, never `[PE-003] Capture service — clip module`.

### 3.4 Issue body template

Every issue body uses exactly this structure:

````markdown
> **FR Code:** `<CODE>` · **Estimate:** `<N.N> md` · **Priority:** `<Must|Should>` · **Milestone:** `<milestone>`

## Context

<Why this exists. 2–4 sentences. Reference the business problem or the architecture decision that requires it. Written so a developer with no prior exposure to this module understands the point.>

## Scope

<What to build. Bulleted. Specific enough to implement, loose enough not to dictate internals.>

## Acceptance Criteria

- [ ] <Testable statement>
- [ ] <Testable statement>

## Constraints

<Relevant locked decisions from Section 2, quoted directly. Only the ones that apply.>

## Files Owned

<Paths this issue is permitted to create or modify. Enables parallel agent execution without collision.>

## Depends On

<`#N` references, or `None`.>

## Open Questions

<Anything unresolved. `None` if clean.>
````

**File ownership is the mechanism that makes parallel Cursor agents safe.** Two open issues must never list the same file under `Files Owned`. If Section 6 appears to create an overlap, create both issues as written and note the collision in `Open Questions` on both.

---

## 4. Workstreams & File Ownership

Repository is a monorepo. Structure confirmed by prior investigation:

```
apps/api/src/jubelio/          NestJS — handlers, services, HTTP client
apps/web/app/backoffice/       Next.js App Router
packages/db/prisma/            Prisma schema
packages/db/src/               Writers
docs/                          OpenAPI specs
```

### 4.1 Stream A — Capture Service `stream:capture-service`

A **new standalone service**, not part of `apps/api`. Runs unattended on the packing PC. Zero file collision with the ERP by construction.

```
PROPOSED — verify: apps/capture-service/
  src/streams/      RTSP ingest, ring buffer
  src/decode/       Barcode sampling and decode
  src/clip/         Extraction, watermark, hash
  src/upload/       R2 queue
  src/health/       Heartbeat, disk monitoring
  config/
```

Issues: `PE-001` `PE-002` `PE-003` `PE-004` `PE-005` `PE-006` `PE-007` `PE-012` `OPS-003`

### 4.2 Stream B — Station UI `stream:station-ui`

Kiosk interface. Separate route tree from the back office — different auth model, different data exposure.

```
PROPOSED — verify: apps/web/app/station/
```

Issues: `PE-008` `PE-009` `PE-010` `PE-011`

### 4.3 Stream C — ERP Returns `stream:erp-api` `stream:erp-web` `stream:db`

Existing code. Highest collision risk — sequence carefully.

```
packages/db/prisma/schema.prisma
packages/db/src/sales-return-writer.ts
apps/api/src/jubelio/returns/sales-return-ingest.service.ts
apps/api/src/jubelio/returns/returns-sweeper.service.ts
apps/web/app/backoffice/returns/
```

Issues: `RT-001` … `RT-010`

### 4.4 Stream D — Linking `stream:erp-api`

Bridges Stream A and Stream C.

```
PROPOSED — verify: apps/api/src/capture/
```

Issues: `RS-001` `RS-002` `RS-003` `RS-004` `PE-013` `PE-014`

### 4.5 Schema ownership rule

`packages/db/prisma/schema.prisma` is touched by `RT-002`, `RT-006`, `RT-008` and `RS-002`. **Only `RT-002` may create the migration.** The others extend the model created there and must be sequenced after it. State this explicitly in each of those issue bodies.

---

## 5. Dependency Graph

### 5.1 Critical path

```
OPS-004 (gating) ──▶ PE-002 ──▶ PE-003 ──▶ PE-004 ──▶ PE-006 ──▶ RS-002 ──▶ RT-008 ──▶ RT-009
```

`OPS-004` gates everything downstream of barcode decode. If it fails, the trigger design changes and `PE-002` and `RS-004` are re-estimated.

### 5.2 Independent chains

`M1` (`RT-001`, `RT-002`, `RT-003`, `RT-006`) has **no dependency on hardware or on `OPS-004`**. It can start on day one and ship while cameras are still being procured.

### 5.3 Dependency comment

After all issues exist, post on each issue that has dependencies:

```markdown
**Dependency map**

Blocked by: #<a>, #<b>
Blocks: #<c>, #<d>

Do not start until blocking issues are closed. If a blocking issue changes scope, re-read this issue before continuing.
```

---

## 6. Issue Specifications

> 30 issues. Estimates total **53.0 md**, matching quotation `#OKE-Q-2607-043`.

---

### M0 — Gating Validation

---

#### `OPS-004` — Barcode decode validation at client site
**1.0 md · Must · `module:deployment` `type:spike` `gating`**

**Context.** The entire trigger design assumes a camera can reliably read the resi off a real Elorae shipping label. This is unvalidated. A negative result changes the architecture and the estimate, so this runs before any capture code is written and before the quotation is considered binding.

**Scope.**
- At the client's actual packing bench, with their actual lighting and their actual labels.
- Determine **which barcode on the label carries the AWB.** Shopee labels typically carry more than one. Reading the marketplace order barcode instead of the AWB produces a silently wrong join key.
- Confirm the decoded payload **equals `SalesOrder.trackingNumber` exactly**, character for character, or document the normalisation rule required.
- Test across every courier currently in use. Known sample: `JY1064321101` (J&T format).
- Record whether labels carry a QR alongside the Code128. QR decodes far more forgivingly at distance and off-angle; if present, prefer it.
- Measure decode rate at candidate mounting positions and heights.

**Acceptance Criteria.**
- [ ] Written finding identifying the AWB barcode symbology and its position on the label, per courier.
- [ ] Confirmation that decoded payload matches `trackingNumber`, or a documented normalisation rule.
- [ ] Decode success rate measured over ≥ 50 real labels at the chosen mounting position.
- [ ] Recommended camera position, height, angle and minimum resolution.
- [ ] Explicit go / no-go on the camera-as-scanner design.

**Files Owned.** `PROPOSED — verify: docs/packing-evidence/barcode-validation-findings.md`

**Depends On.** None.

**Open Questions.** If decode proves unreliable, the fallback is a native agent with a global keyboard hook observing the existing scanner. That route was rejected because it cannot identify which line a parcel went to, so it would require a separate line-identity mechanism. Do not implement without a scoping decision.

---

#### `RS-001` — `trackingNumber` coverage audit and index
**0.5 md · Must · `module:resi-linking` `type:spike` `gating`**

**Context.** Every clip is joined to its order through `SalesOrder.trackingNumber`. That column was never designed as a lookup key and its data quality is unmeasured. If a material share of shipped orders carry a null tracking number, those clips orphan permanently — the same failure class as the page-1 sweeper defect in `RT-001`.

**Scope.**
- Measure null rate of `trackingNumber` across shipped `SalesOrder` rows.
- Measure uniqueness. Identify any duplicates and their cause.
- Catalogue format variance by courier.
- Add a database index on `trackingNumber`.

**Acceptance Criteria.**
- [ ] Null rate reported, split by channel (`SP-`, `TT-`) and by courier.
- [ ] Duplicate count reported with root cause if any exist.
- [ ] Index created and migration committed.
- [ ] Recommendation on whether a fallback binding path is required.

**Constraints.**
> Clips are stored keyed on the raw decoded resi string, unresolved. A reconciliation job joins clip to `SalesOrder` when Jubelio later delivers `tracking_number`.

**Files Owned.** `packages/db/prisma/schema.prisma` (index only — no model changes), `PROPOSED — verify: docs/packing-evidence/tracking-number-audit.md`

**Depends On.** None.

**Open Questions.** None.

---

### M1 — Returns Quick Wins

> No hardware dependency. Start immediately.

---

#### `RT-001` — Sweeper pagination fix and historical backfill
**2.0 md · Must · `module:returns-dispute` `type:bugfix` `stream:erp-api`**

**Context.** `ReturnsSweeperService` fetches `page=1&pageSize=100` only and can never reach the historical backlog. Jubelio reports 992 unprocessed return lines across 782 orders; Elorae holds 413 lines across 368 headers. Set-diff shows **463 orders that were never ingested**, spanning 2026-03 to 2026-06 — pre-go-live, since the earliest Elorae `receivedAt` is 2026-06-30.

Consequence: the Rp 103M exposure figure is a lower bound, plausibly ~2× understated. Every ROI number for this module rests on it.

**Scope.**
- Paginate `GET /sales/orders/returned-list/` (or switch the sweeper source to `/sales/returns/items/`) to walk all pages.
- Backfill the 463 missing `salesorder_id` values into `SalesReturn`.
- Re-sum total exposure value after backfill.
- Add a guard so a truncated fetch is logged loudly rather than silently.

**Acceptance Criteria.**
- [ ] Sweeper walks all pages; verified against Jubelio `totalCount`.
- [ ] Backfill run; Elorae header count reconciles to Jubelio order count within a documented tolerance.
- [ ] Re-summed exposure value reported.
- [ ] A truncated or partial fetch produces an error-level log, not a silent success.
- [ ] Re-ingest does not overwrite existing admin decision fields.

**Files Owned.** `PROPOSED — verify: apps/api/src/jubelio/returns/returns-sweeper.service.ts`, `apps/api/src/jubelio/returns/sales-return-ingest.service.ts`

**Depends On.** None.

**Open Questions.** The 463 missing orders are bucketed by `transaction_date` while ingested records are bucketed by `receivedAt`. Returns lag orders by weeks. Report both clocks separately — do not conflate them into a single monthly run-rate.

---

#### `RT-002` — Return outcome model extension
**1.5 md · Must · `module:returns-dispute` `type:feature` `stream:db`**

**Context.** `SalesReturn.status` is `PENDING | ACCEPTED | REJECTED | PARTIAL`. That models an inventory movement, which is what Jubelio provides — goods coming back into stock. It does not model a **dispute**. Outcomes like Disputed-Won, Not Received, and Wrong Item Returned have no representation anywhere in the stack, which is why 368 records sit in `PENDING` with nothing else to say about them.

**Scope.**
- Extend the outcome enum: `ACCEPTED`, `REJECTED`, `DISPUTED_WON`, `DISPUTED_LOST`, `NOT_RECEIVED`, `WRONG_ITEM_RETURNED`.
- Add `resolutionDeadline`.
- Add buyer reason fields **separate from** the existing admin reject reason: `buyerReasonCode`, `buyerReasonText`.
- Migration only. UI is `RT-007`.

**Acceptance Criteria.**
- [ ] Migration applied; existing 368 records retain `PENDING` without data loss.
- [ ] Outbound Jubelio push maps only `ACCEPTED` and `REJECTED`. The other four outcomes are ERP-local and must never be pushed.
- [ ] `buyerReasonCode` and `buyerReasonText` are independently writable from admin decision fields.

**Constraints.**
> Outcomes beyond Accept/Reject are ERP-local. Jubelio does not model disputes.

**Files Owned.** `packages/db/prisma/schema.prisma`, `packages/db/src/sales-return-writer.ts`

**Depends On.** None.

**Open Questions.** `salesreturn_decision_push` is currently unwired (`HANDLER_NOT_WIRED`). Decide whether this issue wires it or whether it remains deferred. Do not wire it silently.

> **Schema ownership:** this issue owns the migration. `RT-006`, `RT-008` and `RS-002` extend the model created here and must be sequenced after it.

---

#### `RT-003` — Resolution deadline tracking
**1.5 md · Must · `module:returns-dispute` `type:feature` `stream:erp-api`**

**Context.** Marketplace dispute windows are short. A claim that misses the window is lost regardless of evidence quality. With 368 records in `PENDING` and no countdown anywhere, some fraction is being conceded purely to timeout — this is the "cannot process fast enough" half of the client's problem, and it is fixable without a single camera.

**Scope.**
- Per-marketplace dispute window configuration (Shopee, TikTok Shop/TTS), configurable not hardcoded.
- Compute `resolutionDeadline` on ingest from received date + window.
- Expose remaining time and an ageing state (`healthy` / `warning` / `critical` / `expired`).

**Acceptance Criteria.**
- [ ] Window durations configurable per channel without a deploy.
- [ ] Deadline computed on ingest for new returns and backfilled for existing.
- [ ] Ageing state derived, not stored, so it stays correct without a cron.
- [ ] Expired returns are visibly distinct from open ones.

**Files Owned.** `PROPOSED — verify: apps/api/src/jubelio/returns/return-deadline.service.ts`

**Depends On.** `RT-002`

**Open Questions.** Actual dispute window durations per marketplace are unconfirmed. Confirm with client CS before setting defaults. Do not guess — an over-long default is worse than no countdown.

---

#### `RT-006` — Preserve buyer reason on admin decision
**0.5 md · Must · `module:returns-dispute` `type:bugfix` `stream:erp-api`**

**Context.** The reject path overwrites `itemReason` with the admin's reject string. This is harmless today because `itemReason` is empty across all 398 line items — Jubelio's `reject_return_reason` is a *seller rejection* field and Elorae has never rejected through Jubelio. But the moment `RT-005` imports real buyer reasons, the first admin who clicks Reject silently destroys the one datum the entire ROI case depends on.

**Scope.**
- Separate admin decision reason from buyer reason at the write layer.
- Admin decisions write to their own field and must never touch `buyerReasonCode` / `buyerReasonText`.
- Remove the hardcoded default reason strings (`"Customer return accepted/rejected"`).

**Acceptance Criteria.**
- [ ] Accept and Reject leave buyer reason fields untouched. Covered by a regression test.
- [ ] Re-ingest does not overwrite either field.
- [ ] No hardcoded reason strings remain in the decision path.

**Files Owned.** `packages/db/src/sales-return-writer.ts`, `PROPOSED — verify: apps/api/src/jubelio/returns/sales-return-decision.service.ts`

**Depends On.** `RT-002`

**Open Questions.** None. **This must land before `RT-005`.**

---

### M2 — Capture Core

---

#### `PE-001` — Camera stream ingest service
**4.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** Foundation of the capture system. A headless service on the packing PC ingests four RTSP streams and maintains a rolling buffer for each, so that a clip can be cut *backwards* from a trigger that fires after the pack has already happened.

**Scope.**
- Ingest 4 RTSP streams: 3 POV (Atta, Riyan, Roi) + 1 wide.
- Per-stream rolling ring buffer on local disk via segment muxer, 5-minute depth.
- Stream copy (`-c copy`) — cameras encode H.264 onboard, so no re-encode.
- Automatic reconnection on stream loss, with logging.
- Configuration-driven: streams, buffer depth, paths.

**Acceptance Criteria.**
- [ ] 4 concurrent streams ingest without frame loss over a sustained 8-hour run.
- [ ] Ring buffer holds ≥ 5 minutes per stream and prunes older segments automatically.
- [ ] CPU stays low — verify `-c copy` is actually in effect, not silently re-encoding.
- [ ] Stream loss triggers reconnect and an error-level log; other streams are unaffected.
- [ ] Adding a stream requires config change only, no code change.

**Constraints.**
> PoE IP cameras over RTSP, one gigabit switch, one PC. USB webcams are excluded.
> Buffer depth: 5 minutes. ~200 s/order at average volume, ~115 s/order at peak.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/streams/`, `apps/capture-service/config/`

**Depends On.** None.

**Open Questions.** PC specification is unverified against decode load and local retention. Flag if the target machine proves inadequate.

---

#### `PE-002` — Resi barcode decode from POV frames
**3.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** This replaces the barcode scanner entirely. Rather than integrating with Atta's scanner — which carries no line identity and would violate the no-second-scan constraint — the POV cameras read the resi optically. A read is intrinsically bound to the camera that produced it, so one event yields both the resi and the station.

**Scope.**
- Sampling loop decodes barcodes from POV camera frames.
- Emit a trigger event: `{ stationId, resi, serverTimestamp }`.
- Debounce so the same resi at the same station does not fire twice within a configurable window.
- Handle multi-barcode labels per the `OPS-004` findings.

**Acceptance Criteria.**
- [ ] Decode rate meets or exceeds the threshold established in `OPS-004`.
- [ ] Trigger event carries station identity derived from the source stream, never from operator input.
- [ ] Debounce prevents duplicate triggers; window is configurable.
- [ ] Sampling rate is tunable and does not starve stream ingest.
- [ ] Failed decodes are counted and exposed for health monitoring.

**Constraints.**
> The system never touches the barcode scanner and never introduces a second scan.
> Line identity is derived from which camera produced the read. It is never selected by an operator.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/decode/`

**Depends On.** `OPS-004`

**Open Questions.** None — but if `OPS-004` returns no-go, this issue is re-scoped before any work starts.

---

#### `PE-003` — Clip extraction from ring buffer
**2.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** The label goes on after the goods are in, so the trigger fires at the *end* of the pack. The clip must therefore be reconstructed backwards from the buffer, covering work already completed.

**Scope.**
- On trigger, cut a clip spanning configurable pre-roll and post-roll around the trigger timestamp.
- Concatenate from buffer segments cleanly across boundaries.
- Handle the case where pre-roll extends beyond available buffer — cut what exists, flag the clip as truncated.

**Acceptance Criteria.**
- [ ] Clip covers the full configured window, concatenated without visible seams.
- [ ] Pre-roll and post-roll independently configurable.
- [ ] Truncated clips are flagged, not silently shortened.
- [ ] Extraction does not interrupt ongoing ingest.

**Constraints.**
> The label is affixed after goods are inserted, so the trigger fires at the end of the pack.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/clip/extract.ts`

**Depends On.** `PE-001`, `PE-002`

**Open Questions.** If `OPS-004` finds labels are affixed to the empty mailer *before* goods insertion, pre-roll requirements shrink substantially and this issue simplifies.

---

#### `PE-004` — Watermark burn-in
**2.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** A clip is only evidence if it is self-describing and hard to repudiate. Burning identifiers into the pixels means the claim survives the file being copied, renamed, or re-uploaded.

**Scope.**
- Burn resi, timestamp, station ID and packer ID into every frame of the extracted clip.
- **Timestamp must be server-signed.** Never the local machine clock.
- Legible at the resolution the marketplace resolution centre will display.

**Acceptance Criteria.**
- [ ] All four identifiers present and legible in every frame.
- [ ] Timestamp originates from the server; verified by testing against a deliberately skewed local clock.
- [ ] Watermark survives the transcode in `RT-009` without becoming illegible.
- [ ] Packer ID renders as `UNASSIGNED` until `PE-009` ships, rather than blocking on it.

**Constraints.**
> Timestamp burned into frames is server-signed, never the local machine clock. A timestamp from a machine the operator controls is arguable in a dispute.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/clip/watermark.ts`

**Depends On.** `PE-003`

**Open Questions.** None.

---

#### `PE-005` — Wide camera continuous recording
**1.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** The wide overhead camera covers the corridor from Atta's bench to the packers' benches. Its purpose is the hand-off gap: the interval where goods travel between stations, unrecorded by either POV camera. Internal shrinkage and mis-handling live in that gap.

**Scope.**
- Continuous segmented recording to local disk, timestamp-indexed.
- Retrievable by time range.
- **Never uploaded to cloud** — retrieval is always on-site during an investigation.

**Acceptance Criteria.**
- [ ] Continuous recording across a full shift with no gaps.
- [ ] Retrieval by arbitrary time range returns correct footage.
- [ ] No upload path exists for this stream.
- [ ] Disk consumption stays within the configured budget.

**Constraints.**
> Wide camera → local disk, 30-day retention.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/streams/wide-recorder.ts`

**Depends On.** `PE-001`

**Open Questions.** None.

---

#### `PE-006` — Upload pipeline to Cloudflare R2
**2.5 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** Clips must be retrievable from the ERP by anyone handling a dispute, so they go to R2. The warehouse uplink is unverified and Indonesian SME fibre is heavily asymmetric — the pipeline must treat network loss as normal, not exceptional.

**Scope.**
- Durable local queue; survives network loss, service restart and machine reboot.
- Retry with backoff.
- Upload keyed on the raw decoded resi — **not** on an order ID, which may not exist yet.

**Acceptance Criteria.**
- [ ] No clip is lost across a simulated 1-hour network outage.
- [ ] No clip is lost across an abrupt service kill mid-upload.
- [ ] Queue depth is exposed for health monitoring.
- [ ] Sustained upload stays within measured uplink capacity at peak volume.
- [ ] Object key uses the raw resi string.

**Constraints.**
> Clips are stored keyed on the raw decoded resi string, unresolved.
> Estimated ~1.2 Mbps sustained at 144 orders/day, ~4.2 Mbps at 500/day peak.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/upload/`

**Depends On.** `PE-004`

**Open Questions.** Warehouse uplink capacity unverified. If inadequate, fall back to local-first storage with scheduled off-hours sync — raise before implementing.

---

#### `PE-007` — Clip integrity and append-only capture log
**1.0 md · Must · `module:packing-evidence` `type:feature` `stream:capture-service`**

**Context.** Underpins the tamper-evidence claim. A watermark proves the clip describes a specific parcel; a hash proves the file has not been altered since capture.

**Scope.**
- SHA-256 computed at clip creation.
- Append-only log recording hash, resi, station, packer, server timestamp.
- The person who created a clip must not be able to delete or alter it.

**Acceptance Criteria.**
- [ ] Hash computed and persisted for every clip.
- [ ] Log is genuinely append-only — no update or delete path exists.
- [ ] Hash is retrievable for inclusion in the `RT-009` export cover sheet.
- [ ] Packer-level credentials cannot mutate the log.

**Constraints.**
> SHA-256 per clip, stored in an append-only log. The person who created a clip must not be able to delete it.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/clip/integrity.ts`

**Depends On.** `PE-004`

**Open Questions.** None.

---

#### `PE-012` — Local retention and purge
**0.5 md · Must · `module:packing-evidence` `type:infra` `stream:capture-service`**

**Context.** Four continuous streams fill a disk quickly. Unmanaged, the service dies mid-shift with no capture and no warning.

**Scope.**
- Scheduled purge of wide-camera footage (default 30 days) and consumed ring-buffer segments.
- Disk headroom monitoring with alerting threshold.

**Acceptance Criteria.**
- [ ] Purge runs on schedule and honours configured retention.
- [ ] Disk headroom exposed to health monitoring.
- [ ] Low-headroom condition raises an alert before capture is affected.
- [ ] Clips pending upload are never purged.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/health/retention.ts`

**Depends On.** `PE-005`

**Open Questions.** None.

---

#### `OPS-003` — Capture service packaging
**2.0 md · Must · `module:deployment` `type:infra` `stream:capture-service`**

**Context.** The service runs unattended on a warehouse PC that nobody administers. It must start on boot, survive crashes, and leave a diagnosable trail when something goes wrong — because the first sign of failure will otherwise be a missing clip during a dispute weeks later.

**Scope.**
- Package to run as a Windows service with autostart.
- Crash recovery / auto-restart.
- Config file, log rotation.
- Repeatable installer.

**Acceptance Criteria.**
- [ ] Starts automatically on boot with no console session.
- [ ] Restarts automatically after forced termination.
- [ ] Logs rotate and do not fill the disk.
- [ ] Installer deploys to a clean machine without manual steps.
- [ ] Config changes take effect on restart without reinstall.

**Files Owned.** `PROPOSED — verify: apps/capture-service/installer/`, `apps/capture-service/service/`

**Depends On.** `PE-001`

**Open Questions.** Client supplies the PC. Confirm OS version before packaging.

---

### M3 — Station & Linking

---

#### `PE-008` — Station enrolment and line identity
**1.0 md · Must · `module:packing-evidence` `type:feature` `stream:station-ui`**

**Context.** Each camera must map to a known line so that a resi read resolves to a station without any operator action. Enrolment happens once at install.

**Scope.**
- Register each camera/station and bind it to a line identity.
- Line identity is derived from the producing camera, never from operator selection.
- Re-enrolment path for camera replacement.

**Acceptance Criteria.**
- [ ] Each stream maps to exactly one line identity.
- [ ] No UI path allows an operator to change which line they are on.
- [ ] Replacing a camera preserves the line's historical clips.

**Constraints.**
> Line identity is derived from which camera produced the read. It is never selected by an operator.

**Files Owned.** `PROPOSED — verify: apps/web/app/station/enrolment/`

**Depends On.** `PE-002`

**Open Questions.** None.

---

#### `PE-009` — Packer PIN and shift session
**1.5 md · Must · `module:packing-evidence` `type:feature` `stream:station-ui` `pdp`**

**Context.** Warehouse staff churn and shifts rotate, so individual ERP logins become an administrative tax. The KubikPOS pattern applies: the device is enrolled once and authenticated persistently; the person punches a PIN at shift start.

**Scope.**
- Station-level persistent session, established at enrolment.
- Packer PIN entry at shift start.
- Active packer identity stamps every clip captured at that station.
- Shift end / handover flow.

**Acceptance Criteria.**
- [ ] Packers have no individual ERP login.
- [ ] PIN entry takes under 5 seconds.
- [ ] Every clip carries the packer identity active at capture time.
- [ ] Handover mid-shift correctly attributes subsequent clips.
- [ ] Station session survives PC restart without re-enrolment.

**Constraints.**
> Station identity + packer PIN. No individual ERP logins for warehouse staff.

**Files Owned.** `PROPOSED — verify: apps/web/app/station/auth/`

**Depends On.** `PE-008`

**Open Questions.** None.

---

#### `PE-010` — Kiosk capture status display
**2.0 md · Must · `module:packing-evidence` `type:feature` `stream:station-ui` `pdp`**

**Context.** The packer needs one thing from this screen: confidence the clip was captured. It is a status light, not an application. Its data exposure is deliberately minimal for UU PDP reasons — the shipping label in frame already contains buyer name and address, and the packer role must not add to that surface.

**Scope.**
- Full-screen kiosk display.
- Shows last captured resi, capture confirmation, current packer, camera health.
- **Read-only. No buyer names, no addresses, no historical search.**
- Two modes surfaced: Outbound Pack and Return Unboxing (`PE-011`).

**Acceptance Criteria.**
- [ ] Capture confirmation appears within 2 seconds of trigger.
- [ ] Camera health is visible at a glance; a dead camera is unmissable.
- [ ] No buyer personal data is rendered anywhere in this UI.
- [ ] No path to search or view clips other than the current shift's own captures.
- [ ] Usable at a glance from arm's length while packing.

**Constraints.**
> Packer role scope: today's own clips only. No buyer names, no addresses, no historical search. Supervisor role holds search and export.

**Files Owned.** `PROPOSED — verify: apps/web/app/station/kiosk/`

**Depends On.** `PE-009`

**Open Questions.** None.

---

#### `PE-013` — Cloud retention and purge
**0.5 md · Must · `module:packing-evidence` `type:infra` `stream:erp-api`**

**Context.** Storage cost scales with retention. At average volume, 60-day retention is roughly 350 GB in R2 — under Rp 80.000/month with zero egress fees. Clips tied to an open dispute must outlive the window.

**Scope.**
- R2 lifecycle policy, default **60 days**.
- Clips attached to an open dispute are exempt from purge.

**Acceptance Criteria.**
- [ ] Lifecycle policy applied and verified against R2.
- [ ] A clip attached to an open dispute survives past the retention window.
- [ ] Retention period is configurable without a deploy.

**Constraints.**
> POV clips → Cloudflare R2, 60 days. Clips attached to an open dispute are exempt from purge.

**Files Owned.** `PROPOSED — verify: apps/api/src/capture/retention.service.ts`

**Depends On.** `PE-006`, `RT-008`

**Open Questions.** ⚠️ **The FR table specifies 90-day retention; the signed quotation specifies 60 days. Implement 60 and raise a correction against the FR table.**

---

#### `PE-014` — Capture health and reconciliation report
**2.0 md · Should · `module:packing-evidence` `type:feature` `stream:erp-api`**

**Context.** Every system of this kind dies the same way: a packer forgets, a camera is unplugged, a service silently stops. The failure is invisible until a dispute arrives and the clip is not there. This report is the control that keeps the system alive after month three, and it is also how SOP violations surface.

**Scope.**
- Daily report: orders shipped vs clips captured, per station and per packer.
- Surface missed captures, camera downtime, decode failure rate, upload queue depth.
- Highlight probable SOP violations — for example, a pack clip with no corresponding Atta-station read.

**Acceptance Criteria.**
- [ ] Report generated daily and viewable in the back office.
- [ ] Capture rate computed per station and per packer.
- [ ] Missed captures individually listed, not just counted.
- [ ] Camera downtime intervals reported.
- [ ] Report is derivable for any historical date, not just today.

**Constraints.**
> One order, one packer, start to finish. This issue is the control that detects violations.

**Files Owned.** `PROPOSED — verify: apps/api/src/capture/reconciliation.service.ts`, `apps/web/app/backoffice/packing-health/`

**Depends On.** `PE-002`, `RS-002`

**Open Questions.** None.

---

#### `RS-002` — Async clip-to-order reconciliation
**1.5 md · Must · `module:resi-linking` `type:feature` `stream:erp-api`**

**Context.** At pack time the ERP may not yet know the resi exists — the AWB is issued by the courier and relayed by Jubelio, sometimes well after packing. Making capture wait for that would mean a webhook delay silently costs evidence. Inverting the dependency removes the race entirely.

**Scope.**
- Clips are persisted keyed on the raw decoded resi, unresolved.
- A reconciliation job joins clip to `SalesOrder` when Jubelio delivers `tracking_number`.
- Reconciliation is idempotent and re-runnable.
- Reuse the existing `evidenceUrls` / `r2Keys` fields on `SalesReturnItem` — currently schema-only and never populated.

**Acceptance Criteria.**
- [ ] Capture succeeds and persists with Jubelio entirely unavailable.
- [ ] Clip resolves automatically once `tracking_number` arrives.
- [ ] Job is idempotent — repeated runs produce no duplicates.
- [ ] Resolution latency is measured and exposed.
- [ ] Buyer-submitted evidence is stored in a **separate field** from seller evidence.

**Constraints.**
> Clips are stored keyed on the raw decoded resi string, unresolved. A reconciliation job joins clip to `SalesOrder` when Jubelio later delivers `tracking_number`. Capture must never block on Jubelio availability.

**Files Owned.** `PROPOSED — verify: apps/api/src/capture/reconciliation.service.ts` (shared with `PE-014` — see Open Questions), `packages/db/prisma/schema.prisma` (extension only)

**Depends On.** `RS-001`, `PE-006`, `RT-002`

**Open Questions.** Potential file collision with `PE-014` on `reconciliation.service.ts`. Split into `clip-reconciliation.service.ts` and `capture-health.service.ts` if both are worked in parallel.

> **Schema ownership:** `RT-002` owns the migration. This issue extends only.

---

#### `RS-003` — Unmatched clips queue
**2.0 md · Must · `module:resi-linking` `type:feature` `stream:erp-web`**

**Context.** Clips that never resolve are the system's smoke alarm. A growing queue means either the cameras are misreading or the Jubelio sync is dropping orders — both of which are silent failures otherwise.

**Scope.**
- Clips unresolved beyond a configurable window surface in a review queue.
- Manual bind to an order.
- Queue depth trend exposed as a health signal.

**Acceptance Criteria.**
- [ ] Unresolved clips appear after the configured window.
- [ ] Manual bind attaches the clip correctly and is audited.
- [ ] Queue depth and trend are visible.
- [ ] A clip can be dismissed as genuinely unmatchable, with a reason.

**Files Owned.** `PROPOSED — verify: apps/web/app/backoffice/capture/unmatched/`

**Depends On.** `RS-002`

**Open Questions.** None.

---

#### `RS-004` — Barcode payload normalisation
**1.0 md · Must · `module:resi-linking` `type:feature` `stream:capture-service`**

**Context.** Shopee labels typically carry more than one barcode, and AWB formats differ by courier — `JY1064321101` is J&T. If the camera reads the marketplace order barcode instead of the AWB, the join key is wrong and everything downstream mismatches silently.

**Scope.**
- Rules to select the correct barcode where several are present.
- Normalise the decoded payload so it matches `SalesOrder.trackingNumber` exactly.
- Per-courier rules, driven by the `OPS-004` findings.

**Acceptance Criteria.**
- [ ] Correct barcode selected across every courier in use.
- [ ] Normalised payload matches `trackingNumber` exactly for a test set of ≥ 50 real labels.
- [ ] An unrecognised format is logged and queued rather than silently mismatched.
- [ ] Adding a courier rule requires config change only.

**Files Owned.** `PROPOSED — verify: apps/capture-service/src/decode/normalise.ts`

**Depends On.** `PE-002`, `OPS-004`

**Open Questions.** Scope depends entirely on `OPS-004` findings. Estimate may move — flag before starting if findings suggest greater complexity.

---

### M4 — Dispute Workflow

---

#### `PE-011` — Return unboxing capture mode
**2.0 md · Should · `module:packing-evidence` `type:feature` `stream:station-ui`**

**Context.** The outbound clip proves what was sent. This proves what came back. Together they settle the most contestable disputes: a returned parcel containing a different item, a damaged item, or nothing at all.

**Scope.**
- Second capture mode on the kiosk.
- Operator selects the return record, then records the unboxing.
- Clip links to the same return record, alongside the original packing clip.

**Acceptance Criteria.**
- [ ] Unboxing clip attaches to the correct return record.
- [ ] Both packing and unboxing clips are visible together on the return detail view.
- [ ] Mode switch is obvious and cannot be entered accidentally mid-pack.
- [ ] Watermark and integrity handling match the outbound path.

**Files Owned.** `PROPOSED — verify: apps/web/app/station/unboxing/`

**Depends On.** `PE-010`, `RT-008`

**Open Questions.** None.

---

#### `RT-004` — Daily digest and escalation
**1.5 md · Should · `module:returns-dispute` `type:feature` `stream:erp-api`**

**Context.** A countdown nobody looks at changes nothing. The digest is what converts deadline tracking into action.

**Scope.**
- Daily digest of returns approaching deadline, to the responsible PIC.
- Escalation when a return crosses a threshold without a decision.
- Configurable thresholds and recipients.

**Acceptance Criteria.**
- [ ] Digest sent daily, containing only returns needing attention.
- [ ] Escalation fires at the configured threshold.
- [ ] Thresholds and recipients configurable without a deploy.
- [ ] Digest is suppressed when there is nothing to report.

**Files Owned.** `PROPOSED — verify: apps/api/src/jubelio/returns/return-digest.service.ts`

**Depends On.** `RT-003`

**Open Questions.** Confirm delivery channel — email, WhatsApp, or in-app.

---

#### `RT-005` — Buyer reason code CSV import
**3.0 md · Should · `module:returns-dispute` `type:feature` `stream:erp-api`**

**Context.** Jubelio does not carry buyer reason codes. Live probing confirmed `reject_return_reason` is empty across 500 scanned lines — it is a *seller rejection* field, and Elorae has never rejected through Jubelio. With no official marketplace API, Seller Centre CSV exports are the only source.

This data decides whether the whole module pays for itself: if most returns are size/fit, video evidence does little; if they are missing-item, wrong-item, damaged or not-returned, the contestable value is large.

**Scope.**
- Import Shopee Seller Centre and TikTok Shop / TTS return exports.
- Match on order number. Handle both `SP-` and `TT-` prefixes.
- Populate `buyerReasonCode` and `buyerReasonText`.
- Idempotent re-import.

**Acceptance Criteria.**
- [ ] Both export formats parse correctly.
- [ ] Matching succeeds on order number; unmatched rows are reported, not dropped.
- [ ] Re-importing the same file produces no duplicates and no data loss.
- [ ] Import never overwrites admin decision fields.
- [ ] Import summary reports matched, unmatched and skipped counts.

**Constraints.**
> `TT-` = TikTok Shop (Tokopedia Shop post-merger). Jubelio surfaces it as `Shop | Tokopedia`. Classic Tokopedia is the negligible `TP-` bucket — 9 lines. Pull `SP-` from Shopee Seller Centre and `TT-` from TikTok Shop / TTS. Do **not** treat ERP `channel=TOKOPEDIA` as classic Tokopedia without checking the order prefix.

**Files Owned.** `PROPOSED — verify: apps/api/src/jubelio/returns/reason-import/`

**Depends On.** `RT-002`, `RT-006`

**Open Questions.** This requires a recurring manual export SOP — weekly is likely right. An import module nobody runs reproduces exactly the empty column that exists today. Confirm ownership with the client.

---

#### `RT-007` — Returns dashboard rework
**3.0 md · Should · `module:returns-dispute` `type:feature` `stream:erp-web`**

**Context.** The current list has no reason column, no outcome, no deadline, and no evidence indicator — it renders 358 identical `Pending` rows. It cannot support triage, which is the daily job this module exists to enable.

**Scope.**
- Add reason, outcome, deadline and evidence-present columns.
- Filters by outcome and by ageing state.
- Detail view exposes the full decision set from `RT-002`.

**Acceptance Criteria.**
- [ ] All four columns render, with sane empty states where data is absent.
- [ ] Filtering by outcome and ageing works and is URL-addressable.
- [ ] Detail view offers all six outcomes.
- [ ] Deadline column makes expired returns immediately obvious.
- [ ] List remains performant at 1,000+ records.

**Files Owned.** `apps/web/app/backoffice/returns/`

**Depends On.** `RT-002`, `RT-003`

**Open Questions.** None.

---

#### `RT-008` — Evidence attachment to return case
**1.5 md · Must · `module:returns-dispute` `type:feature` `stream:erp-api` `pdp`**

**Context.** The join that makes the whole module useful: return case → order → resi → clip. This is what a standalone third-party tool structurally cannot do, because the return record and the video live in different systems.

**Scope.**
- Return case surfaces the linked outbound packing clip via the resi join.
- Return case surfaces any inbound unboxing clip.
- Buyer-submitted evidence stored in a field **separate** from seller evidence.

**Acceptance Criteria.**
- [ ] Packing clip appears automatically on the return detail view where one exists.
- [ ] Unboxing clip appears alongside it.
- [ ] Absence of a clip is explicit, not an empty space.
- [ ] Buyer and seller evidence are independently addressable and independently retained.

**Constraints.**
> Buyer evidence and seller evidence are different provenance and will need different retention and access rules under UU PDP.

**Files Owned.** `packages/db/prisma/schema.prisma` (extension only), `PROPOSED — verify: apps/api/src/jubelio/returns/return-evidence.service.ts`

**Depends On.** `RS-002`, `RT-002`

**Open Questions.** None.

> **Schema ownership:** `RT-002` owns the migration. This issue extends only.

---

#### `RT-009` — Dispute evidence export package
**3.0 md · Must · `module:returns-dispute` `type:feature` `stream:erp-api`**

**Context.** The output of the entire system. A clip that cannot be uploaded to the resolution centre is worthless, and resolution centres enforce format, size and duration limits.

**Scope.**
- Export a submission-ready package: transcoded and trimmed MP4/H.264 within marketplace limits.
- Cover sheet carrying order number, resi, packer, timestamps and file hash.
- Single action from the return detail view.

**Acceptance Criteria.**
- [ ] Export produces MP4/H.264 within the confirmed size and duration caps.
- [ ] Watermark remains legible after transcode.
- [ ] Cover sheet includes the SHA-256 from `PE-007`.
- [ ] Export completes in under 30 seconds for a typical clip.
- [ ] A file exceeding limits is trimmed per a documented rule, not silently truncated.

**Files Owned.** `PROPOSED — verify: apps/api/src/jubelio/returns/evidence-export/`

**Depends On.** `RT-008`, `PE-007`

**Open Questions.** ⚠️ **Shopee and TikTok Shop upload limits — format, file size, duration — are unconfirmed.** These dictate the transcode spec. Confirm before implementing; do not guess.

---

#### `RT-010` — Loss and recovery reporting
**2.5 md · Should · `module:returns-dispute` `type:feature` `stream:erp-web`**

**Context.** Today Elorae cannot state its loss rate, because no return has ever been decided. This report produces the baseline and then measures whether the module worked. It is also the artefact that justifies the investment after the fact.

**Scope.**
- Contested vs conceded counts.
- Dispute win rate.
- Recovered value.
- Loss broken down by reason code and by channel.

**Acceptance Criteria.**
- [ ] Win rate computed from real outcomes, excluding undecided returns from the denominator.
- [ ] Recovered value reported in rupiah.
- [ ] Breakdown available by reason code and by channel.
- [ ] Arbitrary date-range selection.
- [ ] Export to Excel.

**Files Owned.** `PROPOSED — verify: apps/web/app/backoffice/returns/reports/`

**Depends On.** `RT-002`, `RT-005`

**Open Questions.** Distinguish *loss* from *return value*. Legitimate returns where sellable goods come back and are restocked are margin drag, not loss. Real loss concentrates in: goods never returned, goods returned damaged or substituted, refunds on false claims, plus shipping and refurb labour. **Do not report gross return value as loss.**

---

## 7. Out of Scope

**Do not create issues for any of these.** They are contractually excluded from `#OKE-Q-2607-043`.

| Item | Reason |
|---|---|
| Official Shopee / TikTok Shop returns API integration | No developer access. CSV import (`RT-005`) instead. |
| On-site camera installation, mounting, cabling | Client responsibility. Okejob provides specification and placement guidance only. |
| SOP authoring and warehouse staff training | Client responsibility. |
| Site acceptance testing | Not in the signed scope. |
| Hardware procurement coordination | Commercial task, not a development issue. |
| OMS features — order management, label printing outside Seller Centre | Duplicates existing Elorae and Jubelio function. |
| Multi-tenant SaaS productisation | Built client-first. Separate product decision. |
| Facial recognition / automated packer identification | PIN identity is sufficient and simpler under UU PDP. |
| Automated vision analysis of clips (item counting, SKU verification) | Speculative. Human review of a 90-second clip is adequate. |
| Courier claim or chargeback handling | Different counterparty, different evidence format. |
| Cancelled-order analysis (1,810 of 9,921 orders, 18%) | Separate problem — likely stock accuracy or fulfilment SLA. Flagged for future scoping. |

---

## 8. Open Items Carried Into Delivery

Track these; they are not issues but they can change issues.

| # | Item | Affects | Impact |
|---|---|---|---|
| 1 | `OPS-004` barcode validation not yet run | `PE-002`, `RS-004` | **Gating.** A negative result changes the trigger design and both estimates. |
| 2 | Shopee / TTS evidence upload limits unconfirmed | `RT-009` | Dictates transcode spec. Could move the estimate by 1–2 md. |
| 3 | `trackingNumber` null rate unmeasured | `RS-002` | A material null rate means clips orphan permanently; a fallback binding path would be needed. |
| 4 | Dispute window durations unconfirmed | `RT-003` | Configuration only, not structural. |
| 5 | Reason-code split not yet classified | `RT-005`, `RT-010` | Does not affect build size. Affects whether the module was worth building. |
| 6 | Warehouse uplink capacity unverified | `PE-006` | Inadequate uplink forces local-first storage with off-hours sync. |
| 7 | R2 retention: FR says 90 days, quotation says 60 | `PE-013` | **Use 60.** Correct the FR table. |
| 8 | `salesreturn_decision_push` unwired | `RT-002` | Decide explicitly whether to wire it now or defer. |
| 9 | Client PC specification unverified | `OPS-003`, `PE-001` | May not sustain 4-stream ingest plus decode. |

---

## 9. Verification

After the run, confirm:

- [ ] 30 issues created.
- [ ] Estimates sum to **53.0 md**.
- [ ] Milestone totals: M0 = 1.5, M1 = 5.5, M2 = 18.0, M3 = 11.5, M4 = 16.5.
- [ ] Every issue body contains all eight template sections.
- [ ] No two open issues claim the same file under `Files Owned`, except where flagged in `Open Questions`.
- [ ] Every `Depends On` reference resolves to a real issue number.
- [ ] Dependency comments posted per Section 5.3.
- [ ] No issue exists for anything in Section 7.
