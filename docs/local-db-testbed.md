# Local MariaDB test bed

Isolated local database for testing risky changes (e.g. the stock-reservation
backfill and its webhook handler) without touching the shared prod MariaDB.

## WARNING — read before running anything

The default `DATABASE_URL` (in `apps/web/.env`) is:

```
mysql://elorae:elorae@127.0.0.1:3308/elorae
```

**This already points at the local test bed** (docker container
`elorae-dev-db`, port 3308) — it is safe to run `pnpm -F @elorae/db
migrate:deploy`, seeds, tests, or a backfill script with `--apply` without any
override.

`apps/web/.env` also has `DATABASE_URL_PROD` (port 3307, the SSH tunnel to the
PROD VPS MariaDB) — but **no code reads that variable**; it's an inert
bookmark. To deliberately target prod you must set `DATABASE_URL` yourself
(the real prod URL lives in the VPS env store, not in this repo). Commands
below that need the 3307 tunnel (e.g. cloning prod data down) set it
explicitly via `SRC_DATABASE_URL`/`DEST_DATABASE_URL` — never rely on an
ambient `DATABASE_URL=...3307...` since that's not the default.

## Command sequence

Run these yourself — none of this is run automatically.

1. Start the local MariaDB container (alongside the existing `redis` service,
   which is untouched):

   ```
   docker compose -f docker-compose.dev.yml up -d db
   ```

2. Confirm the `elorae` database exists. The container's env vars
   (`MARIADB_DATABASE=elorae`, `MARIADB_USER=elorae`,
   `MARIADB_PASSWORD=elorae`) auto-create it and the user on first boot — no
   manual step needed. If you want to double check:

   ```
   docker exec -it elorae-dev-db mariadb -uelorae -pelorae -e "SHOW DATABASES;"
   ```

3. Apply all Prisma migrations to the local DB — including this branch's
   reserved-stock migration:

   ```
   DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" pnpm -F @elorae/db migrate:deploy
   ```

4. Make sure the SSH tunnel to prod is up on 3307 (however you normally start
   it), then clone a PII-scrubbed slice of prod data into the local DB:

   ```
   SRC_DATABASE_URL="mysql://elorae:<pw>@127.0.0.1:3307/elorae" \
   DEST_DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" \
   pnpm -F @elorae/db exec tsx prisma/clone-to-local.ts
   ```

   The script refuses to run if `DEST_DATABASE_URL` contains `3307`, as a
   guard against accidentally pointing the destination at the prod tunnel.

   It copies, in FK-safe order: `UOM` and `ItemCategory` (prerequisite
   lookups referenced by `Item`'s required/optional foreign keys), `Item`,
   `InventoryValue`, `JubelioProductMapping`, `SalesOrder`, `SalesOrderItem`,
   `JubelioSalesOrderState`. It scrubs customer PII on every `SalesOrder` row
   (`customerName` → `"REDACTED"`, `customerPhone`/`customerEmail`/
   `shippingAddress` → `null`) while keeping stock-relevant fields
   (`status`, `isCanceled`, `fulfillmentStatus`, `salesorderId`,
   `salesorderNo`) and coarse geo (`shippingProvince`/`shippingCity`) intact.
   It's idempotent — re-running skips rows that already exist.

5. To run the app, tests, or the backfill against the local DB, prefix the
   command with the local `DATABASE_URL`:

   ```
   DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" <your command>
   ```

   For example, a dry-run backfill:

   ```
   DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" pnpm -F @elorae/api exec tsx <backfill-script>.ts
   ```

   Only pass `--apply` (or whatever flag makes the backfill write) once
   you've confirmed `DATABASE_URL` in that same command points at 3308, not
   3307.

## Teardown

```
docker compose -f docker-compose.dev.yml stop db
```

Data persists in the `db-data` docker volume across restarts. To wipe and
start fresh:

```
docker compose -f docker-compose.dev.yml down db
docker volume rm elorae_db-data
```

(Volume name may be prefixed differently depending on your docker compose
project name — check `docker volume ls` if `elorae_db-data` isn't found.)

## Production cutover notes (reserved-stock backfill)

The backfill (`prisma/backfill-reservations.ts`) reconciles existing orders to the
reserve model. Before running `--apply` against prod:

- **Run in a webhook-quiet window.** The backfill classifies each order from its
  current `status`/`fulfillmentStatus`. There is no lock preventing concurrent live
  Jubelio ingest, so a webhook mutating an order mid-backfill could disagree with the
  classification. Pause/drain the webhook worker (or pick a low-traffic window) during
  the run.
- **Expect oversell-alert noise.** Any already-shipped order whose webhook re-fires
  after cutover but before its backfill row is processed will briefly reserve against
  an already-deducted `onHand`, firing a `STOCK_OVERSELL_RISK` `AdminNotification`.
  These are transient and self-correct once consume runs — expect and ignore a burst.
- **Dry-run first, always.** Review the summary (counts per action + total onHand
  delta) before `--apply`. The runner refuses `--apply` against a `3307` (prod tunnel)
  URL — apply is intended for the real prod `DATABASE_URL` from its env store, not the
  local tunnel.

## Seeding a login (users/RBAC) alongside cloned data

`clone-to-local.ts` copies only stock/order tables — NOT `User`/RBAC — so the web
app can't log in against a freshly-cloned local DB. Seed a login user:

```
# additive seed (keeps the cloned stock data) — REQUIRED order note below
SEED_NO_TRUNCATE=1 DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" \
  pnpm -F @elorae/db seed:production-login
```

Login: `admin@elorae.com` / `admin123` (PIN `123456`).

- **`SEED_NO_TRUNCATE=1` is required when seeding on top of cloned data** — the
  default `seed:production-login` truncates ALL tables first (would wipe the clone).
  It also can't truncate under the pooled MariaDB driver adapter (`SET
  FOREIGN_KEY_CHECKS=0` is session-scoped and doesn't span pooled connections →
  "Cannot truncate a table referenced in a foreign key constraint"), so the flag is
  the reliable path here. All seed writes are `upsert`, so additive is safe.
- If starting fresh instead: seed FIRST (default truncate — but see the pooled-adapter
  caveat), then clone, then backfill.
