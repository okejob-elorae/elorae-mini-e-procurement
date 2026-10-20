# Agent context — Elorae

Quick orientation for any new coding-agent session in this repo. Read this first, then `docs/BOUNDARY.md` for the architectural contract.

This file is the single source of truth for repo context. The root `CLAUDE.md` is a **symlink to it**, not a copy — edit `AGENTS.md` and never replace that symlink with a real file. Claude Code discovers both names but a real `CLAUDE.md` WINS and suppresses `AGENTS.md` entirely (measured on 2.1.259), so a pointer stub there would silently stop this file from loading; the symlink resolves to this content and loads it exactly once. On Windows, git needs `core.symlinks=true` or the checkout becomes a text file holding the string `AGENTS.md`.

## What this is

pnpm + Turborepo monorepo for an ERP + Jubelio marketplace integration.

```
apps/web/        Next.js 16 App Router — the ERP UI + NextAuth + node-cron (VPS)
apps/api/        NestJS 11 — Jubelio integration service (token, webhooks, queue)
packages/db/     Prisma 7 schema + generated client + MariaDB adapter (shared)
docs/BOUNDARY.md Service-boundary contract — source of truth for who-writes-what
AGENTS.md        This file — repo context + landmine index. `CLAUDE.md` is a symlink to it.
reference/       Local-only planning artifacts (gitignored). EPIC todos now live on the GitHub board (epic issues).
```

Database: **MariaDB 11.4** self-hosted in the docker-compose stack on the Hostinger VPS. Migrated off TiDB Cloud Serverless 2026-06-28 after the free tier exhausted its monthly quota.

**Local dev does NOT point at prod.** The default `DATABASE_URL` in `apps/web/.env` is `127.0.0.1:3308` — the local `elorae-dev-db` container from `docker-compose.dev.yml`, an isolated test bed. Prod is reached only through a deliberate SSH tunnel on **3307**, and `DATABASE_URL_PROD` (which no code reads) is an inert bookmark for it. Migrations, seeds, backfills and the test suite all run against 3308 by default and are safe there. See `docs/local-db-testbed.md`.

## Authoritative docs (read these before changing architecture)

- `docs/BOUNDARY.md` — service responsibilities, data ownership (per-table write owners), communication patterns (sync HTTP vs outbox vs webhooks), auth model, failure modes, anti-patterns, decisions log.
- `docs/INTEGRATION-GUIDE.md` — how to use the Jubelio-touching surface (outbox enqueue, stock adjustments, signed channel).
- `docs/PICK-PACK-SHIP.md` — the marketplace fulfillment flow end to end: where stock is reserved vs consumed, the `PENDING → PICKED → PACKED → SHIPPED` state machine and its guards, the three Jubelio WMS pushes and their body shapes, and the forward-only `SHIPPED` sync back. Read it before touching anything on that path.
- `docs/landmines/` — the full landmine entries, one file per area, behind the one-line triggers in the landmine index below. Open the matching entry before touching that surface.
- `docs/ARCHITECTURE-NOTES.md` — the deeper detail behind the landmine entries. Read the entry for whatever surface you are about to touch, before writing code. A few entries also have detail in `docs/EPIC-STATUS.md` (what a slice shipped) or `docs/FOLLOWUPS.md` (the instance still unfixed); the entry says so where that is true.
- `docs/FOLLOWUPS.md` — follow-ups + known tech debt, grouped by area. Read the relevant section before starting work on that area; log every new follow-up there.
- `docs/EPIC-STATUS.md` — EPIC decomposition + status tables. Read it before building anything that might already exist, and tick the row when a slice merges.
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — per-feature design specs + implementation plans (local-only, gitignored). Each feature follows brainstorm → spec → plan → implement → PR.
- `apps/web/README.md` — ERP feature list.
- `README.md` (root) — local setup, env layout, dev/prod commands, VPS deploy, DB backups.

## Code conventions

- **Double quotes** for string literals in all TS/JS source (whole monorepo, including `apps/web`). No ESLint quote rule enforces single — safe.
- **No comments on Prisma schema models.** Field-level `//` comments forbidden; rationale lives in `docs/`. Migration SQL `--` comments are fine.
- **Adding a `DocType` enum member requires updating THREE exhaustive maps, not one — and TWO `ALTER TABLE … MODIFY docType ENUM(...)` statements on top of them (see the `DocType` entry in `docs/landmines/stock.md`, which carries the migration half and the locale labels).** `apps/web/lib/docNumber.ts` (the generator) AND `apps/web/app/actions/settings/doc-numbers.ts` (the Settings → Document Numbering seeder) each hold their own `DEFAULT_CONFIGS: Record<DocType, …>` with identical shape. The third is `DOC_TYPE_GROUP` in `apps/web/lib/doc-numbers/doc-type-groups.ts`, which places every type on the Settings → Document Numbering page. That file is import-free because a client component reads it, and therefore keys on its own hand-written `DocTypeValue` union rather than Prisma's: the member goes into the union AND the map, and a compile-time pin in `doc-numbers.ts` assigns the map to a `Record<DocType, …>`, so skipping this file entirely is a type error too. Missing any of the three is a **build-breaking** type error that `apps/web` type-check catches. Agents never run that check locally (it stays the owner's), but CI's `checks` job runs it on every PR to `master`, so a miss goes red on the PR before merge; the deploy's Docker build is the second net behind it. Before CI it was the only net: on the delivery branch (PR #229 → deploy `31293514640`) the error surfaced there, the schema advanced, and prod was left serving the old image against it. **That specific outcome is no longer reachable**: `604a877` (2026-08-13) gated the `migrate` job on the image builds, so a web type error now blocks the migration instead of racing it — nothing ships and no schema moves. CI is not a required check, so an error merged past a red run still costs a failed deploy.
- **Six TypeScript shapes have shipped as build-breaking errors here — they are inference bugs, and reviewers cannot settle inference from source; only `tsc` can.** They surface solely in `pnpm -F @elorae/web type-check`, which is the owner's to run locally, never a subagent's — **vitest transpiles without type-checking, so a green test run proves nothing about them**. CI's `checks` job now also runs `type-check` on every PR to `master`. That is an extra net, not a substitute for the owner's run before a push: it is not a required check, and an error merged past it still fails the web image build during deploy, which blocks the gated `migrate` job — nothing ships and no schema moves until someone fixes it.
  1. **Truthiness never eliminates a `string` member of a union.** `if (input.storeId)` does NOT narrow the `else` branch to the sibling member, because `string` includes `""`, which is falsy. Adding `storeId?: undefined` to the sibling is necessary but not sufficient — it fixes the TRUE branch only. Discriminate on `!== undefined`, or add a real runtime guard (`if (!input.stocktakeId) return …`) that narrows honestly instead of asserting the state away with a cast.
  2. **Spreading a value whose parameter carries an index signature contributes no concrete fields.** `serializeListItemForClient` in `apps/web/lib/items/queries.ts` takes `{ …; [k: string]: unknown }`, so `{ ...rest }` carries that index signature into the return type and `item.id` loses its concrete type (it resolves to `unknown`, not to a missing property) — a direct `as Array<{ id: string; … }>` is then rejected as insufficiently overlapping. Go through `unknown` (`as unknown as X`), which is the compiler's own suggestion; live examples at `apps/web/app/pwa/spg/stocktake/SpgStocktakeAddItemSheet.tsx` and `apps/web/app/backoffice/store-stocktakes/[id]/StocktakeDetailClient.tsx`.
  3. **Constructing a library class in a test needs its FULL required-param set.** `new Prisma.PrismaClientKnownRequestError(msg, { code })` is missing `clientVersion`; every other construction in the repo passes `clientVersion: "test"`. Grep for an existing one before writing a new one.
  4. **Narrowing a PROPERTY does not survive into a nested closure; narrowing a `const` variable does.** A correctly discriminated union still fails: under `{row.proof.status === "error" && <Button onClick={() => upload(row.proof.file)} />}`, `row.proof.file` inside the handler resolves to the whole union's `File | null`, not the `error` arm's `File`, because the compiler cannot prove `row.proof` is unchanged by the time the click fires. The JSX guard reads like it narrows and does not. Hoist it first — `const proof = row.proof;` at the top of the `.map` body, then guard and use `proof` — which is why `SettlementForm.tsx` declares one in each of its two deduction-row maps. This one is invisible to review: the union is right, the guard is right, and only `tsc` sees it.
  5. **Casting a next-intl key `as never` also kills its values parameter.** `t(key as never, { detail })` fails with `Argument of type '{ detail: string; }' is not assignable to parameter of type 'undefined'`: next-intl derives the values type from the key, and `never` resolves it to `undefined`. `apps/web` has no typed next-intl messages (no `AppConfig` `Messages` augmentation), so a dynamic string key needs NO cast at all — `SellThroughDetailClient.tsx` does ``t(`err.${reason}`, { detail })`` uncast. The existing `as never` casts (`AccountMappingClient`, `CoaPageClient`, `ManualJournalForm`) are safe only because those calls pass no values — drop the cast before adding values to one (PR #343).
  6. **A user-defined type guard narrows by SUBTYPE, so an optional field in its predicate that only some union members declare drops the rest.** `input is { …; clientSentAtMs?: number }` keeps the union members that are strict subtypes of the predicate type, and falls back to assignability only when NO member relates — which is why the predicate change alone compiled clean. Under subtype, an object type that does NOT declare an optional property is not a subtype of one that declares it, so once `clientSentAtMs?` was added to the `{ storeId }` member of `SaveCountsActionInput` alone, that member matched `isValidSaveCountsInput`'s predicate and the guard filtered out the `{ stocktakeId }` member, so `saveCountsAction`'s admin branch narrowed to `never` (`Property 'stocktakeId' does not exist on type 'never'`, PR #425). The guard reads as a widening and the union looks right; only `tsc` sees it. Declare the field on every member the guard must keep — the `{ stocktakeId }` member carries `clientSentAtMs?: undefined`, the same way it already carries `storeId?: undefined`, under a one-line comment marking it load-bearing; live example: `SaveCountsActionInput` in `apps/web/app/actions/store-stocktakes.ts`.
- **Branch names + commit messages + PR titles + spec docs are shared artifacts** — no EPIC-XX or L1-L9 labels in them. Use feature names. EPIC-XX labels live only on the GitHub board (epic issue titles) — never in shared code artifacts.
- **One-liner commit messages.** No body. No `Co-Authored-By` trailer. Conventional Commits format (`feat(api): ...`, `fix(db): ...`, etc.).
- **Subpath exports for `@elorae/db` pure helpers.** Client-component imports must use `@elorae/db/color` or `@elorae/db/pantone` (NOT the main barrel) to avoid dragging Prisma/mariadb into the client bundle.

## Workflow conventions

- **Match existing UI patterns before inventing new ones.** Before writing any new page/form/list, open a sibling module and copy the shape. Backoffice CRUD list reference = `apps/web/app/backoffice/purchase-orders/PurchaseOrdersPageClient.tsx` (header row + inline filter row + Card-wrapped table with CardHeader icon+title, empty state inside CardContent, no `p-6` on the server page — layout handles padding). Backoffice form reference = `apps/web/app/backoffice/suppliers/`. PWA reference = `apps/web/app/pwa/HomeShell.tsx` + `apps/web/app/pwa/stores/StoreList.tsx` (icon-prefixed rows, `bg-primary text-primary-foreground` icon circles for contrast on dark theme, `Card`/`Badge`/`Button` from `@/components/ui/*` — never native `<button>`/`<input>`/`<table>`). Grep + read one existing example before drafting.
- **Before opening a PR, run a CONSISTENCY SWEEP over what the change made stale — the review fleet does not do this for you.** Reviewers read the DIFF, so they are strong on whether new code is correct and blind to text that describes it from outside the diff. Every CI-bot finding across five consecutive PRs was audited and they fell into four classes, listed below. Not one was caught by a dedicated code reviewer, and every one of them was greppable. (Resist restating that audit as a tally — the first version of this rule carried counts that did not add up, which is its own small demonstration of why a number in a rule rots faster than a class does.) Sweep these four, by name:
  1. **Describing text for behaviour you changed.** Grep the changed identifiers and error codes across `apps/web/lib/i18n/messages/*.json`, `docs/`, `AGENTS.md` and nearby code comments. A locale string that still explains the old rule renders confidently wrong copy to an operator; a rule elsewhere in the SAME file that contradicts the one you just edited is worse, because the file reads as authoritative. Both have shipped here.
  2. **The sibling you did not touch.** When a fix names N sites, grep for the N+1th before calling it done — a stale-closure read was fixed in one add-row handler while TWO siblings beside it carried the identical bug, and on another branch four sites describing a permission mechanism were corrected while a fifth, in a different file, was not. A length guard was added inside a loop that `continue`s past one enum member, while the column it protected was written for every member. Also check the PR body itself: a test plan claiming behaviour the code does not have is a finding.
  3. **Every numeric bound against the column it protects.** A `String?` with no `@db.Text` is MySQL `VARCHAR(191)`; a validator capping at 300 lets a value pass and then die at insert as an untyped error. Check the DERIVED value too — a key capped at 191 still overflows once something prepends a URL prefix to it.
  4. **Paginated helpers called with defaults.** `listOffsettableReturns` and its kin take `page`/size and silently return the first page; a caller that means "all of them" gets 25 and no signal. If the caller means "all of them", it needs an unpaged variant — do not paper over it with a runtime `rows.length === total` assertion, which throws on the perfectly normal case of more than one page. Pin the completeness in a test instead.
  When you dispatch the whole-branch review fleet, give ONE reviewer this as its explicit lens — "for every behaviour this branch changed, find the text that describes it and say what is now false" — rather than assuming a correctness reviewer will wander into it. They reliably do not.
- **CI (`.github/workflows/ci.yml`) is a second net, not the verification step.** It runs on every PR to `master` and on every non-docs push to it, in two jobs: `checks`, with no database (api and web type-check, web lint, api jest; `apps/api` has no ESLint config, so it is not linted), and `db-specs`, which runs every `packages/db` and `apps/web` vitest spec against a fresh MariaDB 11.4, migrated through the deploy's own `mariadb` client and seeded from `packages/db/prisma/seed.ts`. It does not gate `deploy.yml`, and no check is required for merge, so a red run blocks nothing on its own — read it. It does not replace verification before a push: the scoped local runs in § What NOT to do still come first, and `@elorae/web` type-check stays the owner's. A spec that is green on `:3308` and red in `db-specs` is usually reading data cloned onto the dev bed: self-seed it, never add prod-shaped rows to `seed.ts`.
- **Plan before implementing** any non-trivial feature. Brainstorming → spec doc (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) → plan doc (`docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`) → implement → PR. The `superpowers:*` skills enforce this when invoked. `docs/superpowers/` is local-only (gitignored) — specs/plans never ship in PRs.
- **On merge, update the docs the change invalidates** — in the same session, not later. Tick the slice's row in `docs/EPIC-STATUS.md` (status → ✅, append PR # + merge date); flip any shipped item in `docs/FOLLOWUPS.md` to `- [x]` **and append the PR #** (that number is what makes a ticked item traceable later), and move every new follow-up there (never leave one in a PR body — they die on merge); and if the change created a new trap, add its entry to `docs/ARCHITECTURE-NOTES.md`, its full landmine entry to the matching `docs/landmines/` file, and a one-line trigger pointing at it in the landmine index below. Also tick the matching story on the GitHub board.
- **TDD for non-trivial logic.** Pure functions, handlers, routers, processors get failing tests first. Module-wiring and infra-glue files are exempt.
- **Never force-push master.** Past divergence with a teammate's monolith branch was resolved by *recreating* their content in the monorepo, not by force-merging. See `project_master_divergence` memory.
- **`git check-ignore -v` before staging any dotfile** to confirm it's actually ignored.
- **Never commit secrets.** Even when staging looks clean, double-check `git diff --cached` for `.env`-shaped content.

## Local services (more detail in `README.md`)

| Port | Service | Start | Stop |
|------|---------|-------|------|
| 3000 | apps/web dev (Next.js) | `pnpm -F @elorae/web dev` | `pkill -f "next dev"` |
| 3001 | apps/api (NestJS, prod-mode for queue work) | `pnpm prod:api` or `pnpm -F @elorae/api prod:start` | `pkill -f "node dist/main"` |
| 3308 | MariaDB dev test bed (the default `DATABASE_URL`) | `docker compose -f docker-compose.dev.yml up -d db` (first time) or `docker start elorae-dev-db` | `docker stop elorae-dev-db` |
| 6379 | Redis (BullMQ for apps/api) | `docker compose -f docker-compose.dev.yml up -d redis` (first time) or `docker start elorae-dev-redis` | `docker stop elorae-dev-redis` |

**Restart order:** db → Redis → api → web.

## Production hosts

| Host | Service | Notes |
|------|---------|-------|
| Hostinger VPS (`elorae.cloud`) | apps/web (Next.js, Docker Compose) | Deploy runs automatically on push to master: GitHub Actions builds the image → pushes to `ghcr.io/okejob-elorae/elorae-web` → the VPS **pulls** it (CI-image cutover, PR #106 — the VPS no longer builds). Manual/rollback: `ssh elorae@api.elorae.cloud && cd /srv/elorae && git pull && IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml pull web && docker compose -f docker-compose.prod.yml up -d --no-build web` (omit `IMAGE_TAG` → `:master`), or Actions → Deploy to VPS → Run workflow with an `image_tag`. Caddy auto-SSL. Vercel DECOMMISSIONED 2026-06-18. |
| Hostinger VPS (`api.elorae.cloud`) | apps/api + Redis + Caddy (Docker Compose) | Same CI-image flow (PR #106): GHA builds → `ghcr.io/okejob-elorae/elorae-api` → VPS pulls, no on-VPS build. Manual/rollback: `ssh elorae@api.elorae.cloud && cd /srv/elorae && git pull && IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml pull api && docker compose -f docker-compose.prod.yml up -d --no-build api`. Caddy handles auto-SSL. Webhook URL: `https://api.elorae.cloud/webhooks/jubelio/<event>`. See `README.md §Production deploy` for first-time setup + ops commands. |
| VPS MariaDB (docker `db` service) | MySQL-compatible DB | Port 3306 bound to 127.0.0.1 on the VPS. Reached from a laptop only through a deliberate tunnel on local port **3307** (`ssh -fNL 3307:127.0.0.1:3306 elorae@api.elorae.cloud`) — nothing points at it by default; local dev runs on the 3308 test bed. The prod `DATABASE_URL` lives in the VPS env store, not in this repo. |

The VPS is the only prod target. Client demos run against `https://elorae.cloud` directly — there is no laptop-plus-public-tunnel demo path any more, and Jubelio's webhooks point at `api.elorae.cloud`. One consequence to know before you touch webhook handling: **no documented way to receive a live Jubelio webhook on a laptop remains** — the tunnel was it. Inbound handler changes are covered by specs and by reading `JubelioWebhookEvent` rows on the VPS, not by a live local delivery. `scripts/replay-stuck-webhooks.mjs` is not a substitute: it re-enqueues rows already persisted on the VPS, it does not deliver a new one anywhere.

## Env layout

- `apps/web/.env` — Next.js env. Holds the shared `DATABASE_URL` — the single source of truth *for local dev*, and it points at the **3308 test bed**, not prod. It also holds `DATABASE_URL_PROD` (3307), which no code reads.
- `apps/api/.env` — api-only keys (`JUBELIO_*`, `SWAGGER_*`, `PORT`, `CORS_ORIGINS`, `REDIS_URL`). No `DATABASE_URL` — `apps/api/src/bootstrap-env.ts` cascades it from `apps/web/.env`.
- Cascade order in api: `apps/api/.env` → `<root>/.env` → `apps/web/.env`. Earlier wins per key (dotenv no-override).
- In prod (VPS): env is injected from the platform's own store; the cascade is irrelevant there.
- **Secrets that have appeared in any chat transcript are compromised.** Rotate `DATABASE_URL` password, `JUBELIO_WEBHOOK_SECRET`, `SWAGGER_PASS` if you accidentally paste them.

## Landmine index

One line per known trap, and each line is a TRIGGER: **the situation you are in — what bites — which file holds the full entry.** Every one of them was written after someone paid for it. A trigger is a compression, not the rule: when a line matches what you are about to do, open its full entry in the named `docs/landmines/` file BEFORE writing code — and follow that entry's onward pointers into `docs/ARCHITECTURE-NOTES.md` / `docs/EPIC-STATUS.md` / `docs/FOLLOWUPS.md` where it names them.

**Stock, inventory, reservations**

- Looking up an `InventoryValue` row? Variantless keys are `null` OR `""` — stay OR-tolerant; a strict lookup forks a phantom row. Never rewrite one spelling into the other. → `docs/landmines/stock.md`
- Matching variant SKUs in memory? The index is case-insensitive — match on `matchKey`; never write the folded key or loosen `isStockableVariantKey` with it. → `docs/landmines/stock.md`
- Editing `ItemForm`'s variant table? Rows + SKU/barcode are ONE state from pure `resolveGridRows`, never an effect; a code moves only with its own combination. → `docs/landmines/stock.md`
- Writing `InventoryValue`/`reservedQty`? Atomic `increment`/`decrement`, never read-modify-write; `qtyOnHand` only via a mover (bar `reservation-writer.ts`). → `docs/landmines/stock.md`
- Moving stock anywhere? Only through the `stock-balance.ts` movers, which append the ledger. `StockMovement` is a FROZEN ARCHIVE — never write to it. → `docs/landmines/stock.md`
- Touching `StockLedgerEntry.totalCost`/`balanceValue`? NULL = unreconstructible, `0` = worthless — never swap them (no `Rp 0`, no `?? 0`). → `docs/landmines/stock.md`
- Tidying `deleteItem`'s blockers? Keep BOTH the `StockMovement` and `StockLedgerEntry` counts; never add `ItemImage`/`ItemPriceChangeLog`/`SalesHistory`. → `docs/landmines/stock.md`
- "Simplifying" `getItemVariantOptions` onto one table? Its THREE sources cover each other's blind spots — drop one and a real variant is unselectable. → `docs/landmines/stock.md`
- Reading an `InventoryValue` row before writing it? Pin the write with `inventoryValueId`; in `apps/web` read via `findExistingInventoryValueRow` (locking and draw-down paths excepted), `packages/db` copies kept in step. → `docs/landmines/stock.md`
- Editing `moveMainStock`'s `createIfMissing`? Lock `Item` only on a miss, re-read with LOCKING `lockMainInventoryValueRow`, refuse a row found only then. → `docs/landmines/stock.md`
- Writing `reservedQty`? No ledger entry, ever. Never split a `qtyOnHand` write from its `reservedQty` decrement; consume/release via `resolveReservedInventory`. → `docs/landmines/stock.md`
- Wondering why a no-op wrote a ledger row? Delta movers never skip a zero; SET movers do. Deliberate — never harmonise them or filter `qty !== 0` on read. → `docs/landmines/stock.md`
- Trusting the balance-write guard? It is blind to raw SQL — a raw balance write appends the ledger by hand AND joins `ALLOWED`; never widen the regex. → `docs/landmines/stock.md`
- Creating a balance row at quantity 0? PROVISIONING, no ledger entry; the guard exempts it BY PATH, so keep quantity moves out of that file. → `docs/landmines/stock.md`
- Provisioning a variantless `InventoryValue` row? Check EITHER spelling first — a `""` beside a `null` doesn't collide, and strands legacy reservations. → `docs/landmines/stock.md`
- Supplying `balanceQty` to `appendStockLedger`? Take it from the balance write's own return value, never a follow-up read, which races the workers. → `docs/landmines/stock.md`
- Decrementing main stock? `moveMainStock` throws `MainStockNegativeError` below zero — never clamp or catch it, never copy the floor to store/van movers. → `docs/landmines/stock.md`
- Applying a physical COUNT? `setMainStock`/`setStoreStock` with the counted absolute — never a `counted − current` delta through `moveMainStock`. → `docs/landmines/stock.md`
- Folding `InventoryValue`/`VanStock` by variant (ledger backfill, query)? Group on `COALESCE(variantSku, '')` and AGGREGATE — `null` and `""` rows coexist. → `docs/landmines/stock.md`
- Reading `qtyOnHand` as "what we can sell"? `available = qtyOnHand − reservedQty`, derived, never stored — and NOT what Jubelio is pushed. → `docs/landmines/stock.md`
- Touching field-sales order lines, van stock or the PWA catalog? All PER-VARIANT (real `variantSku`); simple items stay item-level. → `docs/landmines/stock.md`
- Working on putus stock movement? Stock leaves at DELIVERY, not approve; never pattern-match `FieldSalesDelivery.docNo` on `DLV/`. → `docs/landmines/stock.md`
- Working on konsi stock movement? Approve only RESERVES; `StoreStock` moves only when a delivery shipment COMPLETES. Never add a writer without one. → `docs/landmines/stock.md`
- Touching `VanStock`, `StoreStock` or `KonsiTransferLine`? `VanStock.variantSku` is nullable (stay OR-tolerant), the others `""` (normalise `?? ""`). Never trust a count of `StoreStock` writers — grep the movers. → `docs/landmines/stock.md`
- Building on the store-to-store transfer? Stock moves at APPROVE only, at the source's `avgCost` re-read then (never `StoreTransferLine.unitCost`); no floor guard. → `docs/landmines/stock.md`
- Computing a stocktake line's `varianceQty`? `countedQty − expectedQty`, the OPPOSITE sign to `VanReconcileLine` — the van formula flips shortfall and surplus. → `docs/landmines/stock.md`
- Touching stocktake approval or `saveStocktakeCounts`? Re-baseline and book only via `sumMovementsSinceCountCents`/`bookedCountCents`, at each LINE's moment. → `docs/landmines/stock.md`
- Reading `StockLedgerEntry` or adding a `refType`? The column is free-form: render the raw string, give closed option sets an "other" class, never drop a row. → `docs/landmines/stock.md`
- Widening `StockLocationType`? Its hand-spelled `apps/web` sets and `resolveLocationKey` compile clean and mislabel; add locale strings and an `ALTER … ENUM`. → `docs/landmines/stock.md`
- Building a filter arm from an optional array (`arr.length > 0`)? `[]` is a selection (`in: []`); only `undefined` means "no filter". → `docs/landmines/stock.md`
- Asking "how much of this item exists"? Only `getStockAcrossLocations` may fold the three tables; never add `available` to it. → `docs/landmines/stock.md`
- Adding a `DocType` member? THREE maps (`DEFAULT_CONFIGS` ×2, `DOC_TYPE_GROUP`), labels in BOTH locales, two `ALTER … MODIFY docType`. → `docs/landmines/stock.md`
- Editing `generateDocNumber`'s reset `CASE` or prefix validation? Every period needs a `WHEN` arm; no two types may share a prefix; the period is WIB. → `docs/landmines/stock.md`
- Found an unmapped catalog item whose variants are mapped elsewhere? A superseded duplicate — retire it only via `retireSupersededItem`, never by hand. → `docs/landmines/stock.md`
- Accepting a marketplace return? The order's reservation decides, not the line's `itemId`; never accept a CONSUMED line without restoring stock. → `docs/landmines/stock.md`

**Konsi sell-through report**

- Touching a sell-through report's ledger window? Boundary = MAX `createdAt` of the closing stocktake's own rows, never `approvedAt`; each `STORE` row lands in exactly one report. → `docs/landmines/konsi-sell-through.md`
- Retiring a sell-through report (`cancelSellThrough`, `voidSellThrough`, any new path)? Null BOTH `stocktakeKey` and `chainKey` in the status CAS, or a key strands for good. → `docs/landmines/konsi-sell-through.md`
- Adding a `StoreStock` writer or `refType`? Add its `deriveSellThroughLines` case in the same change — it refuses unknown ones (`UNKNOWN_REF_TYPE`) with no compile error. → `docs/landmines/konsi-sell-through.md`
- Setting `Store.sellThroughMethod`? KONSI-only, refused at the write boundary, never cleared silently; a report reads its snapshot `KonsiSellThrough.method`, never the store's. → `docs/landmines/konsi-sell-through.md`
- Approving or previewing a sell-through report? Approve re-derives (`STALE` → cancel and recreate), moves NO stock and IS the only konsi invoice path — never add a mover or a second one. → `docs/landmines/konsi-sell-through.md`
- Voiding a sell-through report? `voidSellThrough` is the only way out of `APPROVED`; reversals MIRROR the posted original — never recompute one or route it through `generateAutoJournal`. → `docs/landmines/konsi-sell-through.md`
- Adding a `SellThroughErrorCode`? No exhaustive `Record`: a create-path code needs copy in BOTH locales under `konsiSellThrough.err` AND `storeStocktakes.detail.sellThrough.reason`. → `docs/landmines/konsi-sell-through.md`
- Adding a sell-through approve refusal? `konsiSellThrough.err.<CODE>` in BOTH locales (invoicing codes get NO `storeStocktakes…` key); a data `detail` needs an `errorMessage` branch. → `docs/landmines/konsi-sell-through.md`
- Pricing a sell-through line? Bill the CATALOG selling price via `priceSellThroughLines` — never `computeStorePrice` or `Store.markupPercent`, which the store keeps. → `docs/landmines/konsi-sell-through.md`
- Creating a sell-through report or changing KONSI returs? `RETUR_IN_FLIGHT` also refuses returs approved after the count — never narrow it or copy that arm to `TRANSFER_IN_FLIGHT`. → `docs/landmines/konsi-sell-through.md`

**Konsi count schedule**

- Deciding whether a store has counted this month? Use `countStatusFor`: WIB months (+7h, never `getMonth()`), credit by `countMomentOf` of an APPROVED full count, never `countedAt`. → `docs/landmines/konsi-count-schedule.md`
- Calling `runKonsiCountSweep` from a spec? Pass `storeIds` (omitted sweeps the shared bed; `[]` sweeps nothing — never collapse it to `undefined`) and inject `schedule`/`now`. → `docs/landmines/konsi-count-schedule.md`
- Adding a stocktake approve path, or touching `approveAction`? Call `autoCreateSellThroughAfterCount` AFTER the commit, best-effort — never inside `approveStoreStocktake`'s transaction. → `docs/landmines/konsi-count-schedule.md`
- Adding a konsi count or report notification? A new category needs a `CATEGORY_PERMISSION` entry (else it reaches nobody) AND a `getNotificationHref` case; keep metadata flat. → `docs/landmines/konsi-count-schedule.md`
- Reading `StoreStocktake.createdById`? It may be `KONSI_COUNT_SYSTEM_ACTOR`, no user — never a required `User` relation or `findUniqueOrThrow`; render via `createdByIsSystem`. → `docs/landmines/konsi-count-schedule.md`

**Field sales — retur, konsi, nota, faktur**

- Adding a `FieldReturnStatus` member? FOUR `Record<FieldReturnStatus, …>` backoffice maps must all get it — a miss is a web type error. → `docs/landmines/field-sales.md`
- Adding a `FieldReturnErrorCode`? BOTH `ERROR_CODE_MAP` and `RAISE_ADMIN_RETURN_ERROR_CODE_MAP` in `app/actions/field-returns.ts` must stay exhaustive. → `docs/landmines/field-sales.md`
- Raising an ADMIN-origin field retur? Its nullable `notaPhotoUrl`/`notaPhotoR2Key`/`transport` are a widened column — a FIELD-origin retur still requires all three, in the writer. → `docs/landmines/field-sales.md`
- Validating a retur receive count? ZERO is valid on every line, all-zero included — never add a positive-quantity check anywhere in that flow. → `docs/landmines/field-sales.md`
- Resolving a retur mismatch? Variance direction is enforced in the WRITER — a UI that withholds a control guarantees nothing. → `docs/landmines/field-sales.md`
- Choosing a retur line's variant, or changing its picker? Name the bucket the stock sits in; `isReturnableVariantKey` and `returVariantOptions` share one rule — never change one alone. → `docs/landmines/field-sales.md`
- Correcting a retur's warehouse count? `correctFieldReturnReceipt` APPENDS an `INVESTIGATE` to a changed, resolved line — never edit or delete a resolution. → `docs/landmines/field-sales.md`
- Cancelling a field retur? `cancelFieldReturn` is pre-receipt only and moves no stock; every in-flight check must ignore CANCELLED. → `docs/landmines/field-sales.md`
- Rendering a retur value? `unitPrice` is only a rounded reference — `lineValue`/`totalValue` are authoritative; a partly priced `totalValue` is `null`, never a partial sum. → `docs/landmines/field-sales.md`
- Editing `lib/field-sales/retur/variance.ts` or `pricing-rules.ts`? Keep both import-free — a client component imports `variance.ts`, so an import drags `@elorae/db` into the browser. → `docs/landmines/field-sales.md`
- Adding a doc-number sequence for a new register? Take your own `DocType` — field retur is `FIELDRET`, never the vendor-return `RET`; a shared counter interleaves them. → `docs/landmines/field-sales.md`
- Touching `recordFieldSalesDelivery`? It must create exactly one `TaxInvoice` per nota tagihan — a delivery without one is silently invisible to finance. → `docs/landmines/field-sales.md`
- Changing the konsi approve path? An already-APPROVED order must REFUSE a payload with admin-added lines, never return its idempotent `ok`. → `docs/landmines/field-sales.md`
- Approving a PUTUS order with appealed lines? `finalPrices` must name every appealed line exactly once (`InvalidFinalPriceError`) — never fall back to the store price. → `docs/landmines/field-sales.md`
- Pushing konsi stock, or adding a konsi approve path? Go through `approveKonsiOrderInTx`, never a copy; the caller must verify a `PENDING_APPROVAL` KONSI order first. → `docs/landmines/field-sales.md`
- Wondering why a store stops getting konsi suggestions for an item? `listKonsiSuggestions`'s never-sent exclusion is PERMANENT — the `StoreAssortmentLine` gap covers it. → `docs/landmines/field-sales.md`
- Writing an assortment-gap test? On-hand is `StoreStock` PLUS `openKonsiQtyByKey`, always via that helper; never fold the open qty into `AssortmentGapRow.onHandQty`. → `docs/landmines/field-sales.md`
- Touching `Store.priceDiscountPercent`/`markupPercent` or an SPG/van price? SPG prices by real `termsType` via `spgUnitPrice`; van hardcodes PUTUS, so KONSI holds no discount. → `docs/landmines/field-sales.md`
- Touching `VanSale`/`SpgSale` `total`/`subtotal`? Payment compares against `total`, whole rupiah via `roundToWholeRupiah`; shells preview through the same helper. → `docs/landmines/field-sales.md`
- Widening `PaymentMethod`? FOUR edits beyond the enum, incl. TWO `ALTER TABLE … MODIFY` (`Payment.method`, `CollectionSubmission.method`). → `docs/landmines/field-sales.md`
- Touching `voidPayment`? It re-projects the retur via `projectReturnOffset(fieldReturnId, tx)` — `tx` is load-bearing; early returns stay write-free. → `docs/landmines/field-sales.md`
- Pricing a `FieldReturn` approved with `valuationStatus: PENDING`? `priceApprovedReturnLine` prices it per line until `VALUED` — never reprice a valued retur. → `docs/landmines/field-sales.md`
- Adding a retur-offset-adjacent error code? It goes on `PaymentErrorCode`/`PaymentActionReason`, never on `FieldReturnErrorCode`. → `docs/landmines/field-sales.md`
- Wondering why retur credit doesn't reduce `computeStoreCreditExposure`? By design — no `Receivable` has changed and no journal exists yet. → `docs/landmines/field-sales.md`
- Reading a retur's spendable credit? It is `totalValue − appliedValue`; the ONE deliberate exception is `SettlementReturDetail.remaining` — don't fix or copy it. → `docs/landmines/field-sales.md`
- Never hand-increment or hand-decrement `FieldReturn.appliedValue` — it is a projection of POSTED payments, SET by `projectReturnOffset`. → `docs/landmines/field-sales.md`
- Calling `applyReturnOffset`? Keep `eventId` stable across retries of ONE draw — a fresh id draws AGAIN, a reused one silently draws nothing. → `docs/landmines/field-sales.md`
- Posting a `RETUR_OFFSET` payment from a NEW caller? Pass `fieldReturnId` into `recordPayment` — without it the over-draw ceiling is skipped. → `docs/landmines/field-sales.md`
- Gating a retur-offset control on a prior VOIDED draw? Don't — reinstating `hasVoidedOffsetAttempt` bricks the retur for good. → `docs/landmines/field-sales.md`

**Delivery shipments**

- Touching anything called a "delivery"? TWO tables: `DeliveryShipment` (logistics), `FieldSalesDelivery` (accounting, fed DELIVERED, never planned, qty). → `docs/landmines/delivery-shipments.md`
- Completing a KONSI shipment? It MOVES STOCK in ONE `runSerializable` — every failure must THROW, and a new `issueKonsiTransfer` refusal needs an `instanceof` mapping. → `docs/landmines/delivery-shipments.md`
- Copying the POD gate's shape onto another proof check? `MISSING_PROOF` alone hard-blocks; its siblings warn — don't harmonise either way. → `docs/landmines/delivery-shipments.md`
- Building a new caller on `completeDeliveryShipment`? It posts NO journals and throws TWO error classes with overlapping codes. → `docs/landmines/delivery-shipments.md`
- Editing `completeDeliveryShipment`'s PUTUS tail? Keep the deterministic `shipment-<id>` key and the `IN_TRANSIT` CAS `updateMany` — they make a crash retryable. → `docs/landmines/delivery-shipments.md`
- Retrying a field-sales delivery? A replayed key is COMPARE-AND-REFUSE (`REPLAY_MISMATCH`) — never rotate the key, never loosen the compare. → `docs/landmines/delivery-shipments.md`
- Changing carrier/resi handling? `updateShipmentTracking` is decoupled from `shipDeliveryShipment` on purpose — editable while `PACKED`, frozen after. → `docs/landmines/delivery-shipments.md`
- Gating a shipment control in the UI? Check the SAME permission the action enforces (`deliveries:ship` vs `deliveries:pod`), never the sibling. → `docs/landmines/delivery-shipments.md`
- Calling `completeDeliveryShipment`? Name EVERY shipment line EXACTLY once (`LINE_MISMATCH`) — a duplicate invoices the sum, an omission nulls `deliveredQty`. → `docs/landmines/delivery-shipments.md`
- Computing what is left to ship? Also subtract `plannedQty` on other PACKED/IN_TRANSIT shipments, or the second dies on `OVER_DELIVER`. → `docs/landmines/delivery-shipments.md`
- Closing an order's remainder? `closeFieldSalesOrderRemainder` refuses `SHIPMENT_IN_FLIGHT` — never net the planned qty out instead. → `docs/landmines/delivery-shipments.md`
- Adding a `DeliveryShipmentErrorCode`/`DeliveryErrorCode` member? No exhaustive `Record`: add `err.*` to BOTH locales and BOTH `mapError` copies. → `docs/landmines/delivery-shipments.md`
- Reading `completeDeliveryShipment`'s `invoiceDate`/`dueDate`? Caller input for `EXPEDITION`, shipment row for `SALESMAN_CARRY`; a new method needs its own branch. → `docs/landmines/delivery-shipments.md`
- Trusting a declared `number` from a `"use server"` export? Validate with `Number.isFinite` plus a range check, never the global `isFinite`. → `docs/landmines/delivery-shipments.md`
- Changing the delivery POD radius? It reuses `checkin.radiusMeters`/`Store.checkinRadiusMeters` — widening either widens store check-in too. → `docs/landmines/delivery-shipments.md`
- Reading `evaluateCheckinRadius`'s `distanceMeters: null`? Check-in passes it, the POD gate refuses — never gate on `outOfRadius` alone. → `docs/landmines/delivery-shipments.md`
- Hitting a shipment whose `Store` row is missing? That is `NOT_FOUND`, never `STORE_NOT_GEOCODED` — no FK backs `FieldSalesOrder.storeId`. → `docs/landmines/delivery-shipments.md`
- Setting `carriedById`? The writer does NOT verify it exists — add that check once anything but the admin combobox can set it. → `docs/landmines/delivery-shipments.md`
- Reassigning a shipment's carrier after it ships? Impossible — `carriedById` freezes at `IN_TRANSIT`; cancel and recreate. → `docs/landmines/delivery-shipments.md`
- Touching `SALESMAN_CARRY` completion, or a new `completeDeliveryShipment` caller? `carriedById` must EQUAL `deliveredById` (`NOT_CARRIER`); GPS is no substitute. → `docs/landmines/delivery-shipments.md`
- Gating a backoffice control on `canPod` + `IN_TRANSIT` alone? Also check `method` — `SALESMAN_CARRY` completes only from the PWA. → `docs/landmines/delivery-shipments.md`
- Adding a method-conditional guard to a shared handler? Check its NEIGHBOURS — an older unconditional guard still fires. → `docs/landmines/delivery-shipments.md`
- Relying on `deliveries:pod`/`deliveries:ship` in a test? A fresh database has neither `Permission` row — self-seed with `connectOrCreate`. → `docs/landmines/delivery-shipments.md`
- Rendering a shipment's proof photo? Never the stored `proofPhotoUrl`/`signatureUrl` — use `goodsPhoto`/`notaPhoto` or `deriveProofPhoto`. → `docs/landmines/delivery-shipments.md`
- Expecting a drawn signature in `signatureUrl`/`signatureR2Key`/`signedByName`? They hold a photo of the signed nota and a typed name. → `docs/landmines/delivery-shipments.md`
- Adding a second photo or upload? Bind each proof key to the shipment ID and method prefix and keep them distinct, or one photo satisfies all. → `docs/landmines/delivery-shipments.md`
- Writing a client-side mirror of the GPS/radius gate? Import `evaluateCheckinRadius` — never hand-roll the haversine. → `docs/landmines/delivery-shipments.md`
- Reordering `completeDeliveryShipment`'s checks? The fetch and same-actor replay guard run FIRST, before payload-shape checks, on purpose. → `docs/landmines/delivery-shipments.md`
- Retrying a completion whose response was lost? Only a SAME-actor replay of a delivered shipment returns `{ok:true}` — never widen it to any actor. → `docs/landmines/delivery-shipments.md`
- Building an offline queue, or touching the completion one? It RETRIES `FORBIDDEN`/`UNEXPECTED`, unlike every other queue, so it needs `MAX_RETRY_ATTEMPTS`. → `docs/landmines/delivery-shipments.md`

**Finance — AR, payments**

- Writing `Receivable.paidAmount`/`outstandingAmount`? Atomic `increment`/`decrement` inside the payment/void tx, never read-modify-write. → `docs/landmines/finance-ar.md`
- Reading what backs a `Receivable`/`TaxInvoice`? Use `resolveReceivableSource`/`resolveTaxInvoiceSource`, never `.delivery`; a `delivery:` `where` drops sell-through rows. → `docs/landmines/finance-ar.md`
- Creating a `Receivable`/`TaxInvoice` row, fixtures too? Exactly ONE of `deliveryId`/`sellThroughId` — a CHECK Prisma can't see kills neither/both at insert. → `docs/landmines/finance-ar.md`
- Voiding a payment? The receipt journal and allocations stay and a mirroring `PAYMENT_VOID` journal is added — read both, or cash looks overstated. → `docs/landmines/finance-ar.md`
- Retrying an AR journal? Gate on a `JOURNAL_PENDING` row, never a missing `Journal` — backfilled deliveries have none (konsi sell-through excepted). → `docs/landmines/finance-ar.md`
- Posting/voiding a payment receipt journal? Decide and post in ONE tx under `FOR UPDATE` on `Payment`; the void mirrors the receipt. `RECEIVABLE_OUTSIDE_LEDGER` is by design. → `docs/landmines/finance-ar.md`
- Touching the van journal sweep or `vanJournalSweepFloor`? A missing journal triggers only at/above the derived floor — never lower it, or key the manual retry on absence. → `docs/landmines/finance-ar.md`
- Retrying a supplier payment journal, or its PO banner? Need a real `supplier_payment` `JOURNAL_PENDING` row + paid + no journal — never "paid, no journal" alone. → `docs/landmines/finance-ar.md`
- Adding a code to `RECEIPT_BLOCKED_MARK_CODES`, or touching `setPOPaidAt`'s abort? Receipt-state codes only; THROW inside the tx after the CAS (a `return` commits `paidAt`); `poBookedPayable` checks receipts BEFORE resolving AP. → `docs/landmines/finance-ar.md`
- Correcting delivery dates (`updateDeliveryDatesAction`)? Refused once `paidAmount > 0`; `runSerializable` commits on return — throw, never `return`, after a write. → `docs/landmines/finance-ar.md`
- Checking a receivable is `PAID`? Needs `outstandingAmount === 0` exactly — sen totals can leave a sub-rupiah residue at `PARTIAL` forever. → `docs/landmines/finance-ar.md`
- Touching `lib/finance/ar/aging.ts`? `daysOverdue` floors WIB days via a hardcoded `+7h`; `getDate()`/`getFullYear()` use the HOST timezone and break on prod. → `docs/landmines/finance-ar.md`
- Calling an AR journal builder directly, `postPaymentVoidJournal`/`postSellThroughVoidJournal` included? They MAY THROW — only ever via `postArJournalSafely`. → `docs/landmines/finance-ar.md`
- Voiding a payment on a `WRITTEN_OFF`/`VOIDED` receivable? Refused `ALREADY_SETTLED`; `VOIDED` is terminal, so a status deny-list names it beside `WRITTEN_OFF`. → `docs/landmines/finance-ar.md`
- Voiding a store-settlement component? Refused `SETTLEMENT_COMPONENT` (docNo) only under an APPROVED owner, via `settlementComponentKeys`, before `voidPayment`'s own status flip; approval's flip re-checks voids. → `docs/landmines/finance-ar.md`
- Touching `Store.creditLimit` enforcement? The approve-time live check is authoritative; the create-time flag is advisory — never read it as an override reason. → `docs/landmines/finance-ar.md`
- Editing `approveFieldSalesOrder`'s PUTUS tail? Throw `CreditLimitExceededError`, never `return`; the finalPrices writes stay AFTER the gate. → `docs/landmines/finance-ar.md`
- Reading `computeStoreCreditExposure`? Receivables + approved-undelivered residual (floored per order); receivables alone wave undelivered orders through. → `docs/landmines/finance-ar.md`
- Konsi orders never trip the credit limit? By construction. Gating them is an open decision in `docs/FOLLOWUPS.md`, not a missing guard. → `docs/landmines/finance-ar.md`
- Adding any `AdminNotification` category (collection, overdue, other)? Add it to `admin-fanout.ts`'s `CATEGORY_PERMISSION` or it reaches nobody, silently. → `docs/landmines/finance-ar.md`
- Touching a `CollectionSubmission`? It moves no money — `outstandingAmount` waits for `verifyCollection`, and credit exposure ignores pending submissions. → `docs/landmines/finance-ar.md`
- Writing `submitCollection`? Net BOTH pending claim kinds via `sumPendingClaimsOnReceivable` inside the tx, never raw `outstandingAmount`. → `docs/landmines/finance-ar.md`
- Editing `verifyCollection`? Payment posts BEFORE the flip, keyed `collection-<submissionId>` — reorder or randomise and a `VERIFIED` submission strands unpaid. → `docs/landmines/finance-ar.md`
- `Receivable.collectorId` still stamped after settling elsewhere? A workflow column; the queue filters on `status` — nothing clears it, and nothing should. → `docs/landmines/finance-ar.md`
- Touching `runOverdueSweep`, `runKonsiCountSweep`, `runFulfillmentPushDivergenceSweep`, `runPaymentReminderSweep` or `runSalesReturnBellSweep`? Their awaited fan-out is cron-only — never copy the `await` into an interactive path. → `docs/landmines/finance-ar.md`
- Touching the overdue dedup query? It reads EVERY `AR_OVERDUE` row, no `take`, no `createdAt` floor — adding either re-announces old crossings forever. → `docs/landmines/finance-ar.md`
- Overdue receivable got one alert, not three? Only the highest crossed threshold fires per sweep pass, by design. → `docs/landmines/finance-ar.md`
- Touching `ar.overdueThresholdDays` parsing? `parseOverdueThresholds` fails OPEN to the defaults, unlike `readGlCutover` — on purpose. → `docs/landmines/finance-ar.md`
- Calling `sendNotificationToUsers`, or asserting what it writes in a spec? Its `VITEST` guard makes it write and push nothing under vitest — never weaken it. → `docs/landmines/finance-ar.md`
- Editing `runOverdueSweep`'s per-receivable body? The `AR_OVERDUE` marker goes LAST, after the push; `sendNotificationToUsers` must not swallow its queue insert failure. → `docs/landmines/finance-ar.md`
- Writing a `NotificationQueue` row or `AdminNotification.title`? `VARCHAR(191)` — overlong throws and reaches nobody; cap via `capNotificationText`. → `docs/landmines/finance-ar.md`
- Touching `TaxInvoice.buyerNpwp`/`taxableAmount`/`ppnAmount`? Snapshots taken at `markTaxInvoiceCreated`, never live lookups of `Store.npwp`/`PPN_RATE_PERCENT`. → `docs/landmines/finance-ar.md`
- Calling `markTaxInvoiceSentToStore`/`revertTaxInvoiceToCreated`? `data` is `{ reason }` only — another transition's block reassigns authorship or wipes filed values. → `docs/landmines/finance-ar.md`
- Where is the faktur NPWP requirement enforced? In the writer, `markTaxInvoiceCreated`, never only the dialog. → `docs/landmines/finance-ar.md`
- Adding a `TaxInvoiceStatus` member? Its hand-written spots aren't `Record`s — a miss fails silently; also two locale namespaces and an `ENUM` migration. → `docs/landmines/finance-ar.md`
- Touching `lib/tax-invoices/status-display.ts`? Import-free on purpose (client bundle); sync its `TaxInvoiceStatusValue` union with `queries.ts` by hand. → `docs/landmines/finance-ar.md`
- Which column is "the delivering salesman"? The resolver's `salesmanId`: `delivery.order.salesmanId`, NEVER `deliveredById`; a null report salesman owns nothing. → `docs/landmines/finance-ar.md`
- Relying on `collections:amplop` in a test? No `Permission` row until hand-seeded; self-seed with `connectOrCreate`, never assert it exists. → `docs/landmines/finance-ar.md`
- Verifying `/pwa/pelunasan` access on an ADMIN account? `pwaAccessGuard` sends wildcard holders to `/backoffice` first — verify on SALESMAN or COLLECTOR. → `docs/landmines/finance-ar.md`
- Retur credit on a multi-store screen? Use `getStoreAvailableCreditMap`, never `getStoreAvailableCredit` in a loop. → `docs/landmines/finance-ar.md`
- Merging `/pwa/pelunasan` into `/pwa/collections`? Don't — the queue is actionable and `collectorId`-scoped, the amplop read-only with a wider store set. → `docs/landmines/finance-ar.md`
- Grepping "settlement" in `apps/web`? TWO features: `lib/finance/settlement/` (MARKETPLACE) vs `lib/finance/ar-settlement/` (store). Never merge or mix them. → `docs/landmines/finance-ar.md`
- Calling marketplace `matchSettlement` unattended, or touching `postSettlementJournal`? Both decide status under `lockSettlementRow`, taken FIRST — never drop or precede it. → `docs/landmines/finance-ar.md`
- Posting a marketplace settlement journal? Gated whole on each line's `SALESORDER_REVENUE` journal, read under the lock; refuses EVERY settlement until GL cutover. → `docs/landmines/finance-ar.md`
- Writing `submitSettlement`? BOTH over-claim guards net other `PENDING` claims with the tx client in `runSerializable`; the screen shows that same netted headroom. → `docs/landmines/finance-ar.md`
- Building on the settlement APPROVAL writer? AR via `recordPayment` only, status flip LAST; an edit/resubmit path excludes its own `settlementId` from both claim sums. → `docs/landmines/finance-ar.md`
- Touching settlement `draftId`? Evidence prefix AND idempotency key — `useState(() => crypto.randomUUID())`, never `useMemo`; a foreign collision is `DRAFT_ID_CONFLICT`. → `docs/landmines/finance-ar.md`
- Changing the settlement admin fee or preview? Fee is on the NETTED base, never gross; `calc.ts` stays client-safe and screens preview through it, never recompute. → `docs/landmines/finance-ar.md`
- Gating anything settlement-shaped? Filing is `settlements:submit` (not `collections:collect`), approving `collections:manage`; gate on what the next screen enforces. → `docs/landmines/finance-ar.md`
- Enabling settlement approval in a fresh env? Map `TRADE_PROGRAM_EXPENSE` and `ADMIN_FEE_EXPENSE` to a `BEBAN` account, or journals degrade to `JOURNAL_PENDING`. → `docs/landmines/finance-ar.md`
- Adding a `SettlementErrorCode`? No exhaustive `Record` — add `REASON_KEY`, `financeStoreSettlements.err.<CODE>` (both locales), `SettlementCheckReason` if previewed. → `docs/landmines/finance-ar.md`
- Reading a `StoreSettlement` as money moved? Status first — `PENDING` posts nothing (but may hold payments); `APPROVED` moved AR, not necessarily journals. → `docs/landmines/finance-ar.md`
- Calling `approveSettlement`? RESUMABLE, not a tx — never nest its writers; the flip re-counts VOIDED components in-tx BEFORE its CAS; loop `postArJournalSafely` over EVERY `paymentIds` id. → `docs/landmines/finance-ar.md`
- Rejecting a settlement? `COMPONENTS_POSTED` while any component is POSTED — throw inside the tx before the CAS, keyed only by the shared key builders. → `docs/landmines/finance-ar.md`
- Resuming a half-posted approval? A retur component must RE-ENTER `applyReturnOffset` even if its payment exists, or `appliedValue` stays stale forever. → `docs/landmines/finance-ar.md`
- Re-validating in `approveSettlement`? Scope to what THIS settlement owes; exempt on `settlementAllocated > 0` OR `agreedRemaining <= 0`, before the headroom check. → `docs/landmines/finance-ar.md`
- Mapping `SettlementDeductionType` → `PaymentMethod`? `DEDUCTION_TYPE_TO_PAYMENT_METHOD`, never a cast — `PROGRAM` differs and dies at the `ENUM` mid-approval. → `docs/landmines/finance-ar.md`
- Hitting `OVER_TENDER`? No override can clear it — the remedy is reject-and-refile; never widen the override or suggest one in copy. → `docs/landmines/finance-ar.md`
- Touching `settlement.varianceToleranceRupiah`? Fails STRICTER (default 0); keep the `Number.isFinite` check after the regex. → `docs/landmines/finance-ar.md`
- Writing a settlement audit row? INSIDE the writer's tx, never the action; `SETTLEMENT_VARIANCE_OVERRIDE` is the only override-reason record; cap reasons at 191. → `docs/landmines/finance-ar.md`
- Rendering settlement expected/variance (screen or BKM)? `computeSettlementTotals`, never stored `expectedAmount`/`varianceAmount`; reuse `approve-writer.ts`'s exports. → `docs/landmines/finance-ar.md`
- Removing Print BKM from `/backoffice/finance/pelunasan/[id]`? Don't — it's finance's only BKM path (ADMIN can't open `/pwa/bkm`), and it shows on REJECTED too. → `docs/landmines/finance-ar.md`
- Bottom-anchored bar on a backoffice route? `QuickActionFAB` (`fixed bottom-6 right-6`) is on every route — clear it with `pr-28`. → `docs/landmines/finance-ar.md`

**Purchasing**

- Writing a PO's terms or its GRNs (receipt, decline, void)? With `paymentTermsDays` set the due date is DERIVED — `recomputePaymentDueDate` in the same tx, never client input. → `docs/landmines/purchasing.md`
- Touching the PO payment reminder sweep? Dedup reads EVERY `PO_PAYMENT_DUE` row, keyed on `poId` + `dueDate` (max `thresholdDays` announced) — never add a `take`/floor or drop `dueDate`; marker before the cron-only awaited fan-out. → `docs/landmines/purchasing.md`

**Production — BOM & variants**

- Reading an FG variant's colour or size? `resolveVariantAxes` (`Warna`/`Ukuran`, old spellings folded), never `v.size`/`v.color`; colour text resolves via the colour master's name/aliases, never rewritten. → `docs/landmines/production.md`
- Planning a WO's materials? `generateMaterialPlan` with the WO's `skuBreakdown` — scoped rules count only their variants; HPP and additional issues read the WO's `consumptionPlan`, not the current BOM. → `docs/landmines/production.md`
- Writing `ConsumptionRule` rows? `(finishedGoodId, materialId)` is not unique any more — refuse overlapping colour/size scopes (`findOverlappingRules`) in every writer. → `docs/landmines/production.md`
- Touching a WO's or an issue's `rollBreakdown`? Entries are per material (`itemId`); match with `rollsForItem`, legacy entries fall back to `consumptionMaterialId`. → `docs/landmines/production.md`

**Forecast**

- Changing which marketplace orders count as forecast demand? Settlement proof only: a settled WIB month (periods cover month end + payout delay), matched net > 0, unique match key; Jubelio status is never read. → `docs/landmines/forecast.md`
- Feeding marketplace sales from two places? Synced orders dedupe against Excel imports on the bare marketplace order number — keep `SalesHistory.orderId` bare in any import. → `docs/landmines/forecast.md`
- Adding a `SalesHistory` writer or a konsi sale path? Konsi demand is `billedQty − posSoldQty` because SPG POS already writes `SalesHistory`. → `docs/landmines/forecast.md`
- Bucketing forecast demand by month? `wibYearMonth`, and keep the month in the grouping key. → `docs/landmines/forecast.md`

**Data ownership + auth**

- Writing `Item` or `StockAdjustment` from apps/api? Dual-owner — go through the `@elorae/db` writer helpers, never a direct Prisma write. See also `docs/BOUNDARY.md §3`. → `docs/landmines/data-ownership-auth.md`
- Adding a relation under `relationMode = "prisma"`? Grep migrations for hand-authored FKs; if REQUIRED, verify the id in the writer's tx and make every `delete<Parent>` count the child. → `docs/landmines/data-ownership-auth.md`
- Adding a permission and assuming ADMIN is gated by it? The admin wildcard is granted in CODE (`isSystem` → `['*']`) — a seed only makes it grantable to non-admin roles. → `docs/landmines/data-ownership-auth.md`
- Building an R2 key from request input? `buildR2Key` after a 400 on `isSafeR2KeySegment`, never a hand-templated key; never tighten a `newLocalId()` id to UUID-only. → `docs/landmines/data-ownership-auth.md`
- Calling apps/api via `apiFetch`? Inputs in the PATH or a POST body, never a query string — `InternalSignGuard` verifies `req.path`, so it 401s every time. → `docs/landmines/data-ownership-auth.md`
- Adding an `apiFetch` timeout or default? Opt-in on purpose — catalog sync and the reconciliation snapshot outrun short limits, and a timed-out sync keeps writing. → `docs/landmines/data-ownership-auth.md`
- Gating a function inside a `lib/` module? Never value-import `@/lib/auth` there — every DB spec on its import chain dies at import. Gate in the `app/actions/*` wrapper. → `docs/landmines/data-ownership-auth.md`
- Taking the acting user's id in a `"use server"` export, or gating a write on a PIN? `assertActor(session.user.id, userId)` first; verify the PIN INSIDE the write action via `verifyPin`. → `docs/landmines/data-ownership-auth.md`

**Database, migrations, prod ops**

- Running a migration or destructive query locally? Check `DATABASE_URL` is not the 3307 prod tunnel (default is the 3308 bed); `migrate:deploy` only, never `migrate dev`. → `docs/landmines/database-ops.md`
- Shipping a migration alongside app code? The `migrate` job's `always()` is load-bearing — a legitimately SKIPPED image build must not cascade-skip it. → `docs/landmines/database-ops.md`
- Assuming a green deploy run means your code is live? Check the `Deploy api`/`Deploy web` jobs and the image tag — they can skip or fail under a green run. → `docs/landmines/database-ops.md`
- Expecting the deploy to seed RBAC rows? It migrates but NEVER seeds — permission rows are hand-run SQL, post-merge. → `docs/landmines/database-ops.md`
- Running `mariadb`/`mariadb-dump` against prod? SSL off (`--skip-ssl`, or `--ssl-mode=DISABLED` on MySQL 8); a failure is silent in `| gzip` — check the `Dump completed on` trailer. → `docs/landmines/database-ops.md`
- Writing migration SQL with `COLLATE utf8mb4_*` on a string literal? The prod `mariadb` CLI connects as utf8mb3 — ERROR 1253 blocks every deploy; use `BINARY col` or `_utf8mb4'…'`. → `docs/landmines/database-ops.md`
- Writing raw SQL apps/web can reach? Never interpolate a `Prisma.sql`/`join`/`empty`/`raw` fragment into a tagged `$queryRaw` — it binds as a string and silently matches nothing. → `docs/landmines/database-ops.md`

**Jubelio integration**

- Verifying a Jubelio webhook signature? HMAC-SHA256 in header `Sign` — trust their code example, not their docs text. → `docs/landmines/jubelio.md`
- Reaching for any Jubelio endpoint? Grep `reference/jubelio-openAPI.yaml` FIRST, then confirm the shape LIVE — the spec both lags and misdescribes. → `docs/landmines/jubelio.md`
- Adding an outbound push to Jubelio? Through the `JubelioOutbox` table, never a direct call — handler + payload builder + spec + router case. → `docs/landmines/jubelio.md`
- Debugging a stuck inbound event? `JubelioWebhookEvent.status` is authoritative; a sweeper rescues stuck rows every 10 min. → `docs/landmines/jubelio.md`
- Touching `outbox-poller.service.ts` or the processor's catch block? A retained `jobId` or a row left `PROCESSING` wedges failures at `PENDING` forever; queues go through `clearFinishedJob`. → `docs/landmines/jubelio.md`
- Detecting an "already in that state" Jubelio reply? An HTTP 500 with Indonesian free text at `err.cause.code`, never `err.code` — use `already-in-state.ts`. → `docs/landmines/jubelio.md`
- Building a WMS pick push? `POST /wms/sales/picklists/` takes the create-and-autocomplete body (`picklist_id: 0`, `picklist_no: "[auto]"`), never a bare `{ids}`. → `docs/landmines/jubelio.md`
- Adding a Jubelio call whose response carries contact data? Pass `redactResponseBody: true` — `JubelioApiCall.responseBody` keeps the RAW body unpruned, and `logger.error` is a second sink. → `docs/landmines/jubelio.md`
- Sending a `location_id` to a Jubelio WMS endpoint? It is `-1`, the only real location — never "correct" it to `1`. → `docs/landmines/jubelio.md`
- Extending `ALREADY_IN_STATE_MARKERS` because a skip did not fire? Never add SQLSTATEs (Jubelio's `code` is unstable); a repeated class-23 error goes `DEAD` via the constraint fingerprint. → `docs/landmines/jubelio.md`
- Reading `SalesOrder.fulfillmentStatus`/`pickedAt`/`packedAt` as proof Jubelio agrees? It is not — a failed push never rolls them back, and the divergence sweep only alerts. → `docs/landmines/jubelio.md`
- Adding an outbox push that must land after another, or editing pack/ship handlers? `assertPredecessorSettled` first; hold only on PENDING/PROCESSING, never on `DEAD` or `fulfillmentStatus`. → `docs/landmines/jubelio.md`
- Deciding an order's marketplace (`detectChannel`, a channel backfill)? Key on the `TT-`/`TP-`/`SP-` prefix first, never `source_name` alone — TikTok orders arrive as Tokopedia. → `docs/landmines/jubelio.md`
- Editing `upsertSalesOrder`'s item recreate? Read `{ salesorderDetailId, cogs }` BEFORE the `deleteMany` and carry it over — only `consumeOrder` writes `cogs`, once. → `docs/landmines/jubelio.md`
- Editing `upsertSalesOrder`'s order fields? Keep `trackingNumber`, `courier` and `lastModifiedJubelio` out of the shared fields — the update arm skips blanks so a payload never wipes them. → `docs/landmines/jubelio.md`
- Deciding if a Jubelio order is cancelled or returned? Never `is_canceled` alone — `isCanceledOrder`/`isReturnedOrder` in apps/api; in apps/web filter `status` too. → `docs/landmines/jubelio.md`
- Deciding if Jubelio shipped an order? Never `wms_status: "SHIPPED"` alone — `isShippedOrder` in apps/api (`READY_TO_SHIP` is no ship); apps/web reads `status`, never raw columns. → `docs/landmines/jubelio.md`
- Pushing, applying or comparing a Jubelio stock qty? `end_qty` is ON-HAND; use `jubelio-stock-contract.ts` — never push `available`, subtract `reservedQty`, or read a missing figure as 0. → `docs/landmines/jubelio.md`
- Adding or changing a reconciliation resolve path (Match Jubelio)? Go through `resolveOneResult` — the result's resolved mark must commit INSIDE the stock transaction. → `docs/landmines/jubelio.md`
- Pushing stock to Jubelio, or touching the cutover switch? Only via a `stock_push` outbox row gated by `JUBELIO_STOCK_PUSH_ENABLED` (fail-closed); enabling it needs an immediate bulk push. → `docs/landmines/jubelio.md`
- Adding a path that pushes a PRODUCT to Jubelio? Only deliberate acts create one; edit paths push only items with a `JubelioProductMapping` — never widen them to unmapped items. → `docs/landmines/jubelio.md`
- Removing a Jubelio variant, or probing if a Jubelio item exists? The variant DELETE answers 200 for missing ids (retry-safe, no tx around it); a missing item GETs 500 `E000001`, never 404. → `docs/landmines/jubelio.md`
- Notifying staff about a marketplace return? Only the web `runSalesReturnBellSweep` (PENDING, `createdAt >= salesReturns.bellFloor`, dedup on every `SALES_RETURN_RECEIVED` row) — never from apps/api ingest, which can't tell create from update. → `docs/landmines/jubelio.md`

**Print documents**

- Injecting a `lib/print/*-html.ts` builder via `dangerouslySetInnerHTML`? Only `<thing>NotaHtml` fragments may be; a `build<Thing>Html` is a full document — iframe it. → `docs/landmines/print-documents.md`
- New printable document? Not `PrintLayout` + `print.css` (the REPORT pattern) — a pure `lib/print/<doc>-html.ts` builder over `print-theme.ts`, whatever the scope says. → `docs/landmines/print-documents.md`
- Auto-sizing an iframe to its content? Measure `contentDocument.body`, NEVER `documentElement` (floored at the viewport); poll `readyState`, capped. → `docs/landmines/print-documents.md`
- "Harmonising" the BKM onto whole-rupiah `idr`? Don't — `settlement-bkm-html.ts` is 2dp because its figures carry sen; change all of a document's money or none. → `docs/landmines/print-documents.md`
- Adding a backoffice print trigger? Use `print-html-in-iframe.ts`, never hand-roll; audit via `logPrintQuietly`, never `await` before `window.open`. → `docs/landmines/print-documents.md`

**Pick-pack-ship**

- Showing, sorting or filtering a `PackingVideo` by recording time or recorder? `recordedAt` stays on the first take — display via `currentClipRecording`, query `replacedAt ?? recordedAt`. → `docs/landmines/pick-pack-ship.md`

**PWA**

- Editing `apps/web/proxy.ts`? It IS the Next 16 middleware (ex-`middleware.ts`), gating `/pwa/*` on every request — not dead code. → `docs/landmines/pwa.md`
- Testing PWA offline, or a service-worker 404? The Serwist SW exists only in a prod build; never commit generated `sw.js`/`workbox-*.js` — it kills SW install. → `docs/landmines/pwa.md`
- Touching PWA push? It lands on the Serwist SW, not Firebase's: `registerFcmToken({ serviceWorkerScope: "/pwa/" })`; every `push` must show a notification. → `docs/landmines/pwa.md`

**TypeScript inference**

- Writing TS a subagent cannot compile? The § Code conventions inference shapes show only in `type-check` (owner's, CI `checks`), never vitest; merged red, the web build breaks. → `docs/landmines/typescript-inference.md`

## What NOT to do

- Don't put EPIC-XX refs in commits, PRs, branch names, or shared specs.
- Don't bundle multiple sub-projects into one PR. Each sub-project is its own slice.
- Don't write to web-owned tables from apps/api (and vice versa) without going through a `@elorae/db` helper — see `docs/BOUNDARY.md §3`.
- Don't add Prisma model comments. Don't add `Co-Authored-By` trailers to commits.
- Don't run `prisma migrate dev` — not against the 3308 test bed, not against the VPS MariaDB. It creates throwaway migrations, resets state, and needs a CREATE DATABASE grant for its shadow database that neither host gives it (P3014). Hand-author the migration SQL and use `migrate:deploy` only.
- Don't deploy apps/api or apps/web to Vercel. Both need persistent processes; Vercel functions don't fit (node-cron, BullMQ workers). Production target is the Hostinger VPS.
- **Don't run the whole test suite** (no filter, or repo-wide). It's slow + wasteful. Scope to the specs you changed. The full-suite run is CI's: `db-specs` runs every `packages/db` and `apps/web` spec on a throwaway database, and `checks` runs the api jest suite — so locally stay scoped. **Every form below follows from one mechanism: pnpm forwards a `--` to the package script literally, and the two runners read what follows it oppositely — vitest's CLI DROPS it, so a filter placed after `--` silently runs the full suite, while jest turns every argument after it into a testPathPattern, flags included.** **api (jest):** `pnpm -F @elorae/api test -- <pattern> [<pattern>...]` works because bare patterns are exactly what jest makes of those arguments (each a testPathPattern, OR-ed). A FLAG after that `--` is not a flag: `test -- <pattern> --maxWorkers=4` runs with the flag silently ignored (it became one more pattern), and `test -- --maxWorkers=4` alone exits 1 with "No tests found". To pass a flag, drop the `--`: `pnpm -F @elorae/api exec jest --maxWorkers=4 <pattern>` (CI's form) or `pnpm -F @elorae/api test --maxWorkers=4 <pattern>`. **web (vitest):** `pnpm -F @elorae/web exec vitest run <pattern> [<pattern>...]` — positional args are file-path filters. **DO NOT use `pnpm -F @elorae/web test -- <pattern>`** — vitest drops the pattern after `--`, so it silently runs the FULL ~450-test suite against `:3308` (confirmed 2026-07-26). **db (vitest):** `pnpm -F @elorae/db exec vitest run <pattern>`, adding `--no-file-parallelism` whenever the pattern matches more than one file — the db vitest config leaves file parallelism on and its specs share one database, so parallel files collide on fixtures and trip hook timeouts that read as real failures (CI's `db-specs` passes the same flag for the same reason). The same `--` trap applies: `pnpm -F @elorae/db test -- <pattern>` runs every db spec, in parallel, against `:3308` (2026-09-29). Only widen if a change plausibly affects unrelated specs. **api jest is capped at `maxWorkers: "50%"` and transpiles without type-checking** (`isolatedModules` in `apps/api/tsconfig.json`) — before that it built one TypeScript language service per worker, and jest's default of `cores - 1` workers (15 on a 16-vCPU box) saturated a WSL box with 7.6GB into swap. Pass `--maxWorkers=4` on top if the machine is already loaded — through one of the no-`--` forms above, never after a `--` — and keep patterns narrow: three directory-shaped patterns matched 16 spec files where 7 were wanted.
- **A web test outside vitest's include globs never runs — and the globs cover only `lib/`, `app/` and `components/`.** `apps/web/vitest.config.ts` collects `*.{test,spec}.{ts,tsx}` under those three; its fourth glob, `../../scripts/legacy-master/**/*.test.ts`, matches nothing today because that directory does not exist. They were widened from a strict `lib/` `*.test.ts` + `app/` `*.spec.ts` pair after the Master Produk import's whole action spec shipped outside it and had never executed until review caught it (PR #343). A misnamed spec in those trees now runs, and a `.tsx` component spec fails loudly under the `node` environment instead of being skipped. Keep the naming anyway, as style: `lib/` tests are `*.test.ts`, `app/` specs are `*.spec.ts`. Anything else is still silently skipped — a test under `hooks/`, `scripts/` or `types/`, one beside a top-level file such as `proxy.ts`, or a `.js`/`.mjs` test: a run filtered to it prints "No test files found", and one filtered alongside other patterns just goes green without it, because a positional filter narrows the include set and never widens it. Put a new test inside the globs, or widen them in the same change.
- **`pnpm -F @elorae/api type-check` runs against `tsconfig.spec.json`, not the build tsconfig — do NOT "simplify" it back to `tsc --noEmit`.** The build config excludes `src/**/*.spec.ts` (so specs stay out of `dist`), which means bare `tsc --noEmit` never checked a single api spec file; ts-jest's per-file language service was the only thing doing it, and turning that off would have left api specs unchecked by anything. `tsconfig.spec.json` extends the build config and re-includes specs, so one tsc run now covers what 15 jest workers used to. It also widens `rootDir` to the repo root, which is load-bearing: six specs under `src/db-shared/` and `src/web-shared/` import across package boundaries by relative path (`packages/db/src/*`, `apps/web/lib/redis/*`) to test the SOURCE rather than the built `@elorae/db` barrel, and the inherited `rootDir: ./src` made every one a TS6059 "not under rootDir" error. Nothing is emitted, so `rootDir` is decorative there — do not "tidy" it back. Note `isolatedModules` sits in the BUILD tsconfig because that is the only file ts-jest reads (it resolves the literal name `tsconfig.json` upward from jest's rootDir), so it constrains `nest build` too — clean today (no enums, no `export =`, no re-exports anywhere in `apps/api/src`), but its TS1272 rule for types referenced in a decorated signature is dormant only because `module` is `commonjs`; flipping that to an ES target arms it across every Nest constructor.
- **Never write an id filter as identifier shorthand in a spec teardown.** `deleteMany({ where: { itemId } })` collapses to `deleteMany({})` — deleting the WHOLE TABLE on the shared `:3308` bed — whenever the fixture hook threw before assigning that id, because **Prisma drops an `undefined` filter term** (measured: `item.count({ where: { id: undefined } })` returns every row). Declare fixture ids `= ""`, reset them at the top of the hook, and pass every one through `seededId()` from `@elorae/db`'s `src/spec-teardown.ts` so the filter is explicit. Prefer `delete` over `deleteMany` for a single row where you can — `delete` REJECTS an undefined id instead of widening, which is fail-closed. Same rule for `in: [...]` lists: declare them `= []` and filter on `ids.map(seededId)` written INLINE at the filter (`{ itemId: { in: ids.map(seededId) } }`) — a hoisted `const guarded = ids.map(seededId)` followed by `in: guarded` still fails the lint rule below, because the filter value is again a bare identifier. Never filter a teardown on a prefix, a category or a date range alone: those over-match real rows without any variable being undefined. `no-restricted-syntax` in `apps/web/eslint.config.mjs` enforces the bare-identifier half as an ERROR in every `apps/web` spec and test file, and CI's `checks` job runs it: any plain identifier as a filter value inside a `deleteMany`/`updateMany` `where` fails lint. SCREAMING_CASE constants are exempt, since a module constant cannot be left unassigned by a failed hook. A non-id value that provably cannot be undefined takes an inline `/* eslint-disable-next-line no-restricted-syntax -- <why> */` directly above it, never a file-wide disable. The rule does not cover `packages/db`, member expressions (`fixture.itemId` throws rather than widening) or over-matching filters — those stay review's job.
- **In a teardown, delete the child of a 1:1 relation BEFORE its parents — `KonsiTransfer` before `DeliveryShipment`, and a `Receivable`/`TaxInvoice` before the `KonsiSellThrough` or `FieldSalesDelivery` it hangs off.** Under `relationMode = "prisma"` Prisma emulates the optional 1:1's delete behaviour, and a parent `deleteMany` that matches several parents each holding a child dies with `Expected zero or one element, got 2` — the emulation expects at most one child across the whole batch. It passes with one parent, so it only surfaces once a spec builds a second shipment with a transfer, and the aborted teardown then leaks every later row (the next `beforeEach` collides on its own fixture's unique codes). The receivable/faktur pair joined this rule when both of their source relations became optional 1:1s; `lib/konsi-sell-through/test-fixtures.ts` deletes every report of its store in one `deleteMany`, so it has to delete their receivables and fakturs first the moment a spec on it creates one. For the receivable/faktur pair it does not even take a second parent: the emulated default for an optional relation is `SetNull`, so deleting a report or delivery that still has one tries to null the child's source column, and the one-source CHECK refuses it. No production path deletes shipments, deliveries or sell-through reports; this bites specs.
- **A test-bed spec that calls a DB-WIDE function must scope it to the spec's own seeded rows.** The tests share `:3308` with real dev data. A function that sweeps/batches over ALL matching rows (e.g. `postPendingSalesJournals`, any future reconcile/backfill sweep) will mutate REAL rows when a spec invokes it — e.g. the sales-journal sweep test journaled real orders to the test's chart accounts, then teardown FK-failed and leaked. Give such functions an optional scope param (`orderIds`/filter) and pass it from the spec; a single-seeded-row test masks the global reach in review. Learned 2026-07-26.
- **Never undo a spy on a Prisma model delegate with `mockRestore()` or `mockReset()` — pin it back to a bound original instead.** `prisma` from `@elorae/db` is a hand-written `Proxy` (`packages/db/src/index.ts`) whose `get` trap forwards to a `globalThis` singleton client, and a model delegate serves `findMany`/`findUnique`/… through Prisma's own proxy rather than as own properties. `vi.spyOn(prisma.<model>, "<method>")` still works, but there is no own property for `mockRestore()` to put back, so it leaves the method UNDEFINED for the rest of the spec file (`… is not a function`), while `mockReset()` leaves it returning `undefined`, which reads as a missing row. Capture `const original = prisma.<model>.<method>.bind(prisma.<model>)` BEFORE spying, then pin it back in a `finally` with `spy.mockImplementation(original as unknown as typeof prisma.<model>.<method>)`. It keeps recurring because `mockRestore()` is the textbook vitest idiom and the break only surfaces when something LATER IN THE SAME FILE calls the same method — it has already shipped as a red test, and two more sites passed only by accident of test order. `mockRestore()` stays correct for a spy on an ordinary object: the `console.error` spy beside the delegate spy in `app/actions/konsi-sell-through.spec.ts` is one. Worked example of the pin-back, with the explanation: `apps/web/lib/delivery/konsi-completion.test.ts`; `app/actions/konsi-sell-through.spec.ts`, `lib/finance/ar/journal-pending.test.ts` and `app/actions/field-returns-pricing-race.spec.ts` carry the same pin-back. The same missing original bites WHILE the spy is live: a spy's default pass-through has no real method to reach, so it is a no-op returning `undefined`, and a `mockImplementationOnce`/`mockRejectedValueOnce`/`mockResolvedValueOnce` falls back to that no-op once consumed — a later call in the same test silently writes nothing, which reads as success while the row never moved. So make the bound original the spy's default first (`vi.spyOn(…).mockImplementation(original as unknown as typeof …)`) and queue the one-off on top; the `finally` pin-back still applies. The pass-through gap shipped as its own red test (PR #432) and `apps/web/lib/finance/journals/mapping-test-fixture.test.ts` is the worked example; `lib/delivery/konsi-completion.test.ts` and `app/actions/konsi-sell-through.spec.ts` queue a Once with no default and are green only because nothing after the one-off needs the real call.
- **Don't type-check the whole repo** (turbo/all-package). Scope to the one package you changed: `pnpm -F @elorae/api type-check` only. (`@elorae/web` type-check stays the user's — it saturates disk; never run it.) tsc can't do single-file, so package-scope is the finest partial available.

## When you need more context

- **Architecture/data ownership:** `docs/BOUNDARY.md`.
- **Why the code looks like that / what already bit us:** `docs/landmines/` and `docs/ARCHITECTURE-NOTES.md` (start from the landmine index above).
- **Known debt, deferred work, open decisions:** `docs/FOLLOWUPS.md`.
- **What shipped in which slice, and which PR:** `docs/EPIC-STATUS.md`.
- **EPIC story details + status:** the GitHub project board — each EPIC has a tracking issue, but **do not compute the issue number**. `EPIC-NN` → issue #`NN+4` holds only up to EPIC-21 (EPIC-13 → #17, EPIC-15 → #19, EPIC-21 → #25); the last three epics were filed out of order and break the formula — **EPIC-22 → #27, EPIC-23 → #28, EPIC-24 → #26**. Resolve any epic by listing them instead of trusting the arithmetic:
  ```
  gh api "repos/okejob-elorae/elorae-mini-e-procurement/issues?state=all&per_page=100&labels=epic" --jq '.[] | "#\(.number)\t\(.state)\t\(.title)"'
  ```
  Read one with `gh api repos/okejob-elorae/elorae-mini-e-procurement/issues/<n>`. **`gh issue view` does not work in this repo** — it dies on a classic-Projects GraphQL deprecation error (`repository.issue.projectCards`) before printing anything, the same root cause that breaks `gh pr edit` (patch a PR body with `gh api ... -X PATCH -F body=@file`). Update the issue's progress checklist on merge (the maintenance rule now applies to the board, not a local file).
- **Past designs/plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/` (local-only, gitignored).
- **What changed and why:** `git log --oneline` (commit messages are descriptive; bodies are rare by convention).
