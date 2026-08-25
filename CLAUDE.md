# Claude context — Elorae

Quick orientation for any new Claude Code session in this repo. Read this first, then `docs/BOUNDARY.md` for the architectural contract.

## What this is

pnpm + Turborepo monorepo for an ERP + Jubelio marketplace integration.

```
apps/web/        Next.js 16 App Router — the ERP UI + NextAuth + node-cron (VPS)
apps/api/        NestJS 11 — Jubelio integration service (token, webhooks, queue)
packages/db/     Prisma 7 schema + generated client + MariaDB adapter (shared)
docs/BOUNDARY.md Service-boundary contract — source of truth for who-writes-what
reference/       Local-only planning artifacts (gitignored). EPIC todos now live on the GitHub board (epic issues).
```

Database: **MariaDB 11.4** self-hosted in the docker-compose stack on the Hostinger VPS. Local dev reaches it through an SSH tunnel — same DB, same data, both environments. Migrated off TiDB Cloud Serverless 2026-06-28 after the free tier exhausted its monthly quota.

## Authoritative docs (read these before changing architecture)

- `docs/BOUNDARY.md` — service responsibilities, data ownership (per-table write owners), communication patterns (sync HTTP vs outbox vs webhooks), auth model, failure modes, anti-patterns, decisions log.
- `docs/INTEGRATION-GUIDE.md` — how to use the Jubelio-touching surface (outbox enqueue, stock adjustments, signed channel).
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — per-feature design specs + implementation plans (local-only, gitignored). Each feature follows brainstorm → spec → plan → implement → PR.
- `apps/web/README.md` — ERP feature list.
- `README.md` (root) — local setup, env layout, dev/prod commands, ngrok demo.

## Code conventions

- **Double quotes** for string literals in all TS/JS source (whole monorepo, including `apps/web`). No ESLint quote rule enforces single — safe.
- **No comments on Prisma schema models.** Field-level `//` comments forbidden; rationale lives in `docs/`. Migration SQL `--` comments are fine.
- **Adding a `DocType` enum member requires updating TWO `Record<DocType, …>` maps, not one.** `apps/web/lib/docNumber.ts` (the generator) AND `apps/web/app/actions/settings/doc-numbers.ts` (the Settings → Document Numbers seeder) each hold their own `DEFAULT_CONFIGS` with identical shape. Missing either is a **build-breaking** type error that `apps/web` type-check would catch — but that check never runs locally here, so it surfaces only in the Docker build inside the deploy workflow, *after* the api image and the database migrations have already succeeded. That is the dangerous shape: prod schema moves forward while the web app silently stays on the old image. It happened on the delivery branch (PR #229 → deploy `31293514640`). A third map, `DOC_TYPE_LABELS` in `apps/web/app/backoffice/settings/documents/page.tsx`, is keyed on the **local 8-member** `DocType` from `@/lib/constants/enums`, not Prisma's — leave it alone unless you deliberately widen that union too.
- **Branch names + commit messages + PR titles + spec docs are shared artifacts** — no EPIC-XX or L1-L9 labels in them. Use feature names. EPIC-XX labels live only on the GitHub board (epic issue titles) — never in shared code artifacts.
- **One-liner commit messages.** No body. No `Co-Authored-By` trailer. Conventional Commits format (`feat(api): ...`, `fix(db): ...`, etc.).
- **Subpath exports for `@elorae/db` pure helpers.** Client-component imports must use `@elorae/db/color` or `@elorae/db/pantone` (NOT the main barrel) to avoid dragging Prisma/mariadb into the client bundle.

## Workflow conventions

- **Match existing UI patterns before inventing new ones.** Before writing any new page/form/list, open a sibling module and copy the shape. Backoffice CRUD list reference = `apps/web/app/backoffice/purchase-orders/PurchaseOrdersPageClient.tsx` (header row + inline filter row + Card-wrapped table with CardHeader icon+title, empty state inside CardContent, no `p-6` on the server page — layout handles padding). Backoffice form reference = `apps/web/app/backoffice/suppliers/`. PWA reference = `apps/web/app/pwa/HomeShell.tsx` + `apps/web/app/pwa/stores/StoreList.tsx` (icon-prefixed rows, `bg-primary text-primary-foreground` icon circles for contrast on dark theme, `Card`/`Badge`/`Button` from `@/components/ui/*` — never native `<button>`/`<input>`/`<table>`). Grep + read one existing example before drafting.
- **Plan before implementing** any non-trivial feature. Brainstorming → spec doc (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) → plan doc (`docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`) → implement → PR. The `superpowers:*` skills enforce this when invoked. `docs/superpowers/` is local-only (gitignored) — specs/plans never ship in PRs.
- **TDD for non-trivial logic.** Pure functions, handlers, routers, processors get failing tests first. Module-wiring and infra-glue files are exempt.
- **Never force-push master.** Past divergence with a teammate's monolith branch was resolved by *recreating* their content in the monorepo, not by force-merging. See `project_master_divergence` memory.
- **`git check-ignore -v` before staging any dotfile** to confirm it's actually ignored.
- **Never commit secrets.** Even when staging looks clean, double-check `git diff --cached` for `.env`-shaped content.

## Local services (more detail in `README.md`)

| Port | Service | Start | Stop |
|------|---------|-------|------|
| 3000 | apps/web dev (Next.js) | `pnpm -F @elorae/web dev` | `pkill -f "next dev"` |
| 3001 | apps/api (NestJS, prod-mode for queue work) | `pnpm prod:api` or `pnpm -F @elorae/api prod:start` | `pkill -f "node dist/main"` |
| 6379 | Redis (BullMQ for apps/api) | `docker compose -f docker-compose.dev.yml up -d redis` (first time) or `docker start elorae-dev-redis` | `docker stop elorae-dev-redis` |
| ngrok | Public tunnel to apps/api for Jubelio | `ngrok http --url unclean-noncalumniating-cory.ngrok-free.dev 3001` | `pkill -f "ngrok http"` |

**Restart order:** Redis → api → web. Static ngrok domain is account-bound; Jubelio webhook config keeps working across restarts.

## Production hosts

| Host | Service | Notes |
|------|---------|-------|
| Hostinger VPS (`elorae.cloud`) | apps/web (Next.js, Docker Compose) | Deploy runs automatically on push to master: GitHub Actions builds the image → pushes to `ghcr.io/okejob-elorae/elorae-web` → the VPS **pulls** it (CI-image cutover, PR #106 — the VPS no longer builds). Manual/rollback: `ssh elorae@api.elorae.cloud && cd /srv/elorae && git pull && IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml pull web && docker compose -f docker-compose.prod.yml up -d --no-build web` (omit `IMAGE_TAG` → `:master`), or Actions → Deploy to VPS → Run workflow with an `image_tag`. Caddy auto-SSL. Vercel DECOMMISSIONED 2026-06-18. |
| Hostinger VPS (`api.elorae.cloud`) | apps/api + Redis + Caddy (Docker Compose) | Same CI-image flow (PR #106): GHA builds → `ghcr.io/okejob-elorae/elorae-api` → VPS pulls, no on-VPS build. Manual/rollback: `ssh elorae@api.elorae.cloud && cd /srv/elorae && git pull && IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml pull api && docker compose -f docker-compose.prod.yml up -d --no-build api`. Caddy handles auto-SSL. Webhook URL: `https://api.elorae.cloud/webhooks/jubelio/<event>`. See `README.md §Production deploy` for first-time setup + ops commands. |
| VPS MariaDB (docker `db` service) | MySQL-compatible DB | Port 3306 bound to 127.0.0.1 on the VPS. Local dev tunnels via `ssh -fNL 3306:127.0.0.1:3306 elorae@api.elorae.cloud`. `DATABASE_URL` lives in each platform's env store. |

ngrok stays available as a fallback for local-only demo work (laptop apps/api + temporary public tunnel). VPS is the authoritative prod target.

## Env layout

- `apps/web/.env` — Next.js env. Holds the shared `DATABASE_URL` (single source of truth).
- `apps/api/.env` — api-only keys (`JUBELIO_*`, `SWAGGER_*`, `PORT`, `CORS_ORIGINS`, `REDIS_URL`). No `DATABASE_URL` — `apps/api/src/bootstrap-env.ts` cascades it from `apps/web/.env`.
- Cascade order in api: `apps/api/.env` → `<root>/.env` → `apps/web/.env`. Earlier wins per key (dotenv no-override).
- In prod (VPS + local-with-ngrok): each platform injects env from its own store; cascade is irrelevant.
- **Secrets that have appeared in any chat transcript are compromised.** Rotate `DATABASE_URL` password, `JUBELIO_WEBHOOK_SECRET`, `SWAGGER_PASS` if you accidentally paste them.

## What NOT to do

- Don't put EPIC-XX refs in commits, PRs, branch names, or shared specs.
- Don't bundle multiple sub-projects into one PR. Each sub-project is its own slice.
- Don't write to web-owned tables from apps/api (and vice versa) without going through a `@elorae/db` helper — see `docs/BOUNDARY.md §3`.
- Don't add Prisma model comments. Don't add `Co-Authored-By` trailers to commits.
- Don't run `prisma migrate dev` against the shared VPS MariaDB — that creates throwaway migrations and resets state. Use `migrate:deploy` only.
- Don't deploy apps/api or apps/web to Vercel. Both need persistent processes; Vercel functions don't fit (node-cron, BullMQ workers). Production target is the Hostinger VPS; local-ngrok is the dev/demo fallback.
- **Don't run the whole test suite** (no filter, or repo-wide). It's slow + wasteful. Scope to the specs you changed. **api (jest):** `pnpm -F @elorae/api test -- <pattern> [<pattern>...]` (jest treats each positional arg as a testPathPattern, OR-ed). **web (vitest):** `pnpm -F @elorae/web exec vitest run <pattern> [<pattern>...]` — positional args are file-path filters. **DO NOT use `pnpm -F @elorae/web test -- <pattern>`** — the `--` pattern is NOT forwarded to vitest, so it silently runs the FULL ~450-test suite against `:3308` (confirmed 2026-07-26; the jest-style `test --` form only works for api). Only widen if a change plausibly affects unrelated specs.
- **Never write an id filter as identifier shorthand in a spec teardown.** `deleteMany({ where: { itemId } })` collapses to `deleteMany({})` — deleting the WHOLE TABLE on the shared `:3308` bed — whenever the fixture hook threw before assigning that id, because **Prisma drops an `undefined` filter term** (measured: `item.count({ where: { id: undefined } })` returns every row). Declare fixture ids `= ""`, reset them at the top of the hook, and pass every one through `seededId()` from `@elorae/db`'s `src/spec-teardown.ts` so the filter is explicit. Prefer `delete` over `deleteMany` for a single row where you can — `delete` REJECTS an undefined id instead of widening, which is fail-closed. Same rule for `in: [...]` lists (`?? []`). Never filter a teardown on a prefix, a category or a date range alone: those over-match real rows without any variable being undefined.
- **A test-bed spec that calls a DB-WIDE function must scope it to the spec's own seeded rows.** The tests share `:3308` with real dev data. A function that sweeps/batches over ALL matching rows (e.g. `postPendingSalesJournals`, any future reconcile/backfill sweep) will mutate REAL rows when a spec invokes it — e.g. the sales-journal sweep test journaled real orders to the test's chart accounts, then teardown FK-failed and leaked. Give such functions an optional scope param (`orderIds`/filter) and pass it from the spec; a single-seeded-row test masks the global reach in review. Learned 2026-07-26 (EPIC-13-03).
- **Don't type-check the whole repo** (turbo/all-package). Scope to the one package you changed: `pnpm -F @elorae/api type-check` only. (`@elorae/web` type-check stays the user's — it saturates disk; never run it.) tsc can't do single-file, so package-scope is the finest partial available.

## When you need more context

- **Architecture/data ownership:** `docs/BOUNDARY.md`.
- **EPIC story details + status:** the GitHub project board — each EPIC has a tracking issue (`EPIC-NN` → issue #`NN+4`, e.g. EPIC-13 → #17, EPIC-15 → #19). `gh issue view <n>`. Update the issue's progress checklist on merge (the maintenance rule now applies to the board, not a local file).
- **Past designs/plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/` (local-only, gitignored).
- **What changed and why:** `git log --oneline` (commit messages are descriptive; bodies are rare by convention).
