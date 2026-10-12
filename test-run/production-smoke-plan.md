# Production (Plan → PO → WO) smoke test

Date: 2026-08-18 (plan)  
Runtime target: local `apps/web` on `http://localhost:3000` against local MariaDB  
Related: field-sales smoke remains in `test-run/README.md` and `test-run/putus-smoke-plan.md` — **do not reuse SMOKE-PUTUS / SMOKE-KONSI fixtures**

## User story

As operations staff, we plan finished-goods production for the year, procure fabric against an approved supplier with lead-time ETA, receive it as numbered fabric rolls, generate a work order from the active plan, allocate those rolls on the WO, issue materials, and receive finished goods back into inventory — entirely on local ERP data, with no marketplace sync.

## Safety boundary

- Local DB mutations are allowed.
- **No operation may call or mutate production Jubelio.**
- Runtime starts **`apps/web` only**; do **not** start `apps/api`, BullMQ workers, or the Jubelio outbox processor.
- Do not use catalog sync, product push, stock adjustment against Jubelio-linked flows, marketplace fulfillment, or any Jubelio menu action.
- Before and after each mutating case, record `JubelioOutbox.count()` and assert **delta = 0** (compare delta, not absolute count).
- Finance journal posting (GRN / FG receipt) may run best-effort locally; mark **`NOT RUN (GL)`** when CoA mappings are absent — do not block the make-flow on journal success.

## Environment prerequisites

- App already running at `http://localhost:3000` (user-confirmed).
- Local seed catalog present (`pnpm -F @elorae/db seed` or equivalent historical seed). Key references:
  - FG **`FG-SHIRT-001`** (BOM → **`FAB-COT-001`** fabric + accessories)
  - Fabric supplier **`SUP0001`** (PT Kain Indah)
  - CMT vendor **`SUP0003`** (Penjahit Pak Budi)
- Lead time: use **existing** process library + supplier chains (run `pnpm -F @elorae/db exec tsx prisma/seed-lead-time-demo.ts` once if `SUP0001` / `SUP0003` have empty chains). Do not invent new SOP templates for this run.
- Run setup: `node test-run/setup-production-smoke.cjs` (see Fixture) before browser cases.
- Document git SHA in evidence.

## Actors (realistic split)

| Actor | Login | Password | PIN | Primary cases |
|---|---|---|---|---|
| **Planner / owner** | `admin@elorae.com` | `admin123` | `123456` | Plan Kerja create/activate, generate WO from plan |
| **Purchaser** | `purchaser@elorae.com` | `purchaser123` | `123456` | PO create, submit, view lead-time strip |
| **Warehouse** | `warehouse@elorae.com` | `warehouse123` | `123456` | GRN with fabric rolls |
| **Production** | `production@elorae.com` | `production123` | `123456` | WO edit (rolls), issue, material issue, FG receive |

Setup script grants `purchase_orders:approve` to PURCHASER (seed omits it but submit requires it) and sets `production@` PIN to `123456`.

## Fixture

Seed via `test-run/setup-production-smoke.cjs`:

| Entity | Value |
|---|---|
| Plan year | **2099** (`SMOKE-PROD` notes) — unlikely collision with real plans |
| Plan structure | Root category + leaf linked to **`FG-SHIRT-001`**, annual target **50**, **M1-only** monthly override (M1=50, M2–M12=0) |
| Color / CMT (M1) | variantSku `""` (variantless FG), qty **50**, CMT vendor **`SUP0003`** |
| Plan status after setup | **DRAFT** + unlocked — activation is case **M-03** |
| PO lines (browser) | **`FAB-COT-001`** qty **130** m @ seeded price; supplier **`SUP0001`** |
| GRN rolls (browser) | Two rolls, e.g. **`ROLL-A` 80 m** + **`ROLL-B` 50 m** (= 130 m PO line) |
| WO planned qty | **50** pcs (from plan CMT) |
| Fabric consumption | **`FAB-COT-001`** — BOM requires **2.5 m/pc + 5% waste** → **~131.25 m** planned; rolls (130 m) + existing stock cover issue |

Rules:

- Reuse seed SKUs/suppliers; do **not** create parallel `SMOKE-*` items unless seed rows are missing (then abort and document).
- Do **not** touch field-sales `SMOKE-PUTUS-*` / `SMOKE-KONSI-*` data.
- If `SUP0001` has no `SupplierProcess` chain, run lead-time demo seed first — PO ETA cases depend on it.

## Smoke cases

| ID | Actor | Scenario | Expected result |
|---|---|---|---|
| M-01 | admin | Open **Lead Time → Papan** for **`SUP0001`** | Process chain visible (from existing/demo seed); no edit required |
| M-02 | admin | Open **Plan Kerja 2099** (setup-created) | Draft year visible; leaf **`FG-SHIRT-001`**; M1 target 50; color/CMT rows present; not yet Active |
| M-03 | admin | **Activate** plan year 2099 | Status **ACTIVE** + locked; validation passes (color/CMT sums match M1) |
| M-04 | admin | **CMT tab → Generate work orders** (M1 / leaf filter) | WO created (e.g. `WO/2099/…`); plan stage/CMT row links `workOrderId`; status **DRAFT** |
| M-05 | purchaser | Create PO: **`SUP0001`**, line **`FAB-COT-001`** qty **130** | PO **DRAFT**; **ETA hint** shows lead-time days/date from supplier chain; `chainSnapshot` persisted on save |
| M-06 | purchaser | **Submit** PO | Status **SUBMITTED**; PO detail shows **ChainPositionStrip** at step 0 |
| M-07 | warehouse | **GRN** against submitted PO; fabric line with **two roll lengths** | GRN posted; **`FabricRoll`** rows created; PO **`receivedQty`** updated; inventory **`FAB-COT-001`** increased; PO status **CLOSED** (full receive) |
| M-08 | purchaser | Re-open PO detail after GRN | Chain strip advanced (auto **MATERIAL_ARRIVED** signal or manual confirm — either is evidence); ETA context still readable |
| M-09 | production | Open plan-generated WO; **Edit** → set **consumption material `FAB-COT-001`**, consumption qty for 50 pcs, **link PO**, **roll breakdown** (Suggest best-fit or manual pick GRN rolls covering ~131 m) | WO saves **DRAFT**; roll sum ≥ planned fabric meters; linked PO id set |
| M-10 | production | **Issue** WO (DRAFT → ISSUED) | Status **ISSUED**; `issuedAt` set; WO **`chainSnapshot`** from **`SUP0003`** if chain exists |
| M-11 | production | **Issue Materials → FABRIC** for **`FAB-COT-001`** (full planned qty) | Material issue doc; **`FabricRoll.remainingLength`** decremented per `rollBreakdown`; WO **IN_PRODUCTION** |
| M-12 | production | **Issue Materials → ACCESSORIES** (BOM lines, e.g. buttons/thread) | Second issue doc; accessory inventory down; consumption plan `issuedQty` updated |
| M-13 | production | **Receive FG** qty **50** accepted | FG receipt doc; WO **COMPLETED**; **`FG-SHIRT-001`** `qtyOnHand` +50; `actualLeadDays` stamped if chain present |
| M-14 | production | WO detail → receipts / reconciliation tab | Receipt listed; material issues listed; progress 50/50 |
| M-15 | admin | Plan dashboard / CMT tab | Generated WO badge/link still shown against M1 CMT row |

### Negative / edge (optional)

| ID | Actor | Scenario | Expected result |
|---|---|---|---|
| M-N1 | production | Issue fabric **without** roll breakdown on a fresh WO (if time) | Issue still succeeds from aggregate stock OR clear error — document actual behavior |
| M-N2 | purchaser | Edit submitted PO without PIN | Blocked / PIN modal — unlock with **123456** |

## Explicit non-goals (defer)

- Forecast → plan bridge tab
- Plan Excel import/export
- Vendor returns, nota CMT register, WO reconciliation deep-dive
- Offline PO/GRN Dexie sync
- Supplier payment toggle / payment journals
- SPG / field-sales / canvassing
- Creating new lead-time templates (read-only use of existing chains)
- Jubelio catalog sync, stock push, marketplace orders

## DB assertions (per mutating case)

After **M-04** (WO generated):

- `WorkOrder.status = DRAFT`, `plannedQty = 50`, `finishedGoodId` → `FG-SHIRT-001`
- `PlanCmtAllocation.workOrderId` set; `PlanStage.workOrderId` set
- Outbox delta = 0

After **M-06** (PO submitted):

- `PurchaseOrder.status = SUBMITTED`
- `chainSnapshot` not null (when `SUP0001` has chain)
- `chainTotalDays > 0`
- Outbox delta = 0

After **M-07** (GRN):

- `FabricRoll` count += 2 for `FAB-COT-001`; `remainingLength` = initial
- `InventoryValue` for fabric increased by 130
- `POItem.receivedQty = 130`; PO status **CLOSED**
- Outbox delta = 0

After **M-11** (fabric issue):

- Roll `remainingLength` decreased; closed rolls if exhausted
- WO status **IN_PRODUCTION**
- Outbox delta = 0

After **M-13** (FG receive):

- WO status **COMPLETED**; `actualQty = 50`
- FG inventory +50; FG receipt row exists
- Outbox delta = 0

## Evidence policy

- Screenshots under `test-run/screenshots/production/`.
- Suggested names: `01-leadtime-sup0001.png`, `02-plan-draft.png`, `03-plan-active.png`, `04-wo-from-plan.png`, `05-po-eta-hint.png`, `06-po-submitted-chain.png`, `07-grn-fabric-rolls.png`, `08-po-chain-after-grn.png`, `09-wo-roll-allocation.png`, `10-wo-issued.png`, `11-material-issue-fabric.png`, `12-material-issue-accessories.png`, `13-fg-receipt-complete.png`, `14-wo-detail-summary.png`, `15-plan-wo-link.png`.
- Write results to `test-run/production-evidence.md` (new file).
- GL journal cases: **`NOT RUN (GL)`** when unmapped — note in evidence, not a failure.
- Jubelio-blocked actions: **`NOT RUN (SAFETY)`**.

## Execution order

1. Baseline: outbox count, confirm port 3000, run `setup-production-smoke.cjs`.
2. Verify lead-time chains on `SUP0001` / `SUP0003` (M-01); run demo seed if empty.
3. Browser: M-02 → M-15 in order (log out/in per actor).
4. After each mutating step: DB snapshot + screenshot.
5. Final outbox delta for session = 0.
6. Fill `production-evidence.md`.

## Pass / fail criteria

- **Pass:** M-01…M-15 meet expected results; fabric rolls created on GRN and consumed on WO fabric issue; plan-generated WO completes through FG receipt; outbox delta 0; no api/Jubelio process started.
- **Fail:** PO submit without chain/ETA when chain exists; GRN without rolls; fabric issue does not decrement allocated rolls; plan WO not linkable; FG receipt leaves WO not COMPLETED; any outbox growth.
