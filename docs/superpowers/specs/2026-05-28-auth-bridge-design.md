# API auth bridge (web → api HMAC) — design

Status: **draft** · Branch: `feat/api-auth-bridge` · Date: 2026-05-28

## 1. Goal

Close `docs/BOUNDARY.md §5` for the web→api direction: every call from apps/web to apps/api carries an HMAC-SHA256 signature over `method + path + userId + body`, verified by a global NestJS guard with a shared secret. Routes are default-deny; `@Public()` opts out (used by `/health` and the Jubelio webhook receiver). User identity propagates via `X-User-Id` header, bound into the signature input so it cannot be swapped.

Bundled in the same branch: replace the outbox poller's role as the only drain path by adding a direct-enqueue endpoint that the per-item "Push stock" server action calls immediately after inserting an outbox row. Poller stays as the safety net.

## 2. Scope

In scope:
- New `INTERNAL_API_SECRET` env (set in both `apps/api/.env` and `apps/web/.env`, same value).
- apps/api: new `auth/` module — `InternalSignGuard` registered globally via `APP_GUARD`, `@Public()` decorator, HMAC utility.
- apps/web: new `lib/internal-api.ts` — `signInternalRequest` + `apiFetch` helpers.
- New endpoint `POST /jubelio/outbox/enqueue/:rowId` in apps/api (internal-signed). `OutboxPoller` gains a public `enqueueById(rowId)` method.
- Retrofit every existing `fetch(INTERNAL_API_URL...)` site in apps/web to use the signed client.
- Webhook receiver keeps its existing Jubelio `Sign` header verification; marked `@Public()` to opt out of the new internal guard.
- Unit tests on the HMAC util (both sides) and the guard.

Out of scope (later slices):
- Per-permission RBAC enforced on api side. Web remains the RBAC boundary; api logs `userId` for audit only.
- Replay protection via timestamp/nonce. Internal TLS-only traffic; revisit if threat model changes.
- Graceful secret rotation (overlap window accepting old + new). Manual rotation = restart both processes.
- `PERMISSIONS` constants shared via `@elorae/types`. Defer until a downstream consumer (sub-3 or mobile/third-party caller) actually needs them on the api side.
- Replacing the outbox poller entirely. Direct-enqueue lands alongside; poller remains the fallback BOUNDARY §4.2 primitive.

## 3. Architecture

```
┌─ apps/web (server actions, admin context) ──────────────────────────────┐
│                                                                         │
│  caller → signInternalRequest(method, path, userId, body)              │
│              ↓                                                          │
│              input = `${METHOD}\n${path}\n${userId}\n${body}`          │
│              sig   = HMAC-SHA256(input, INTERNAL_API_SECRET).hex       │
│              ↓                                                          │
│        apiFetch:                                                        │
│          POST  http://<api>/<path>                                      │
│          headers:  X-Internal-Sign: <sig>                              │
│                    X-User-Id: <session.user.id or "">                  │
│          body:     <raw bytes signed above>                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                       HTTP (localhost / ngrok / TLS)
                                  ▼
┌─ apps/api (NestJS) ─────────────────────────────────────────────────────┐
│                                                                         │
│  Global guard registered as APP_GUARD:                                  │
│                                                                         │
│  InternalSignGuard.canActivate(ctx):                                    │
│    if Reflector reads @Public() on route or class  → allow             │
│    else:                                                                │
│      sig    = req.headers["x-internal-sign"]                           │
│      userId = req.headers["x-user-id"]    // may be empty string       │
│      if missing → UnauthorizedException                                 │
│      input    = METHOD + "\n" + path + "\n" + userId + "\n" + rawBody │
│      expected = HMAC-SHA256(input, INTERNAL_API_SECRET).hex            │
│      if !timingSafeEqual(sig, expected) → UnauthorizedException        │
│      req.userId = userId                                                │
│      return true                                                        │
│                                                                         │
│  Routes:                                                                │
│    GET  /health                  → @Public()                            │
│    POST /webhooks/jubelio/:event → @Public() + own Jubelio Sign check   │
│    GET  /jubelio/status          → guard                                │
│    POST /jubelio/refresh         → guard                                │
│    POST /jubelio/catalog/sync    → guard                                │
│    POST /jubelio/outbox/enqueue/:rowId  ← new this branch + guard      │
│    GET  /docs*                   → existing Basic auth, unchanged       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Trust model

Web is the RBAC boundary. apps/web checks `permissions.includes("*")` before signing a call. apps/api does NOT re-check RBAC — HMAC verification proves "web sent this," which is sufficient for a single-team monorepo where web + api ship together. apps/api records `userId` for audit (e.g., new outbox enqueue endpoint can log who triggered it).

### 3.2 Threat coverage

| Attack | Outcome |
|---|---|
| External attacker hits api directly without secret | 401 (missing or wrong sig) |
| Captured sig replayed against a DIFFERENT endpoint | 401 (path bound into sig input) |
| `X-User-Id` swapped on a captured request | 401 (user-id bound into sig input) |
| Replay of exact same request within secret lifetime | succeeds — accepted YAGNI for internal TLS traffic |
| `INTERNAL_API_SECRET` compromised | full bypass — same blast radius as `JUBELIO_WEBHOOK_SECRET`. Rotation = update env in both stores + restart both processes |

## 4. Signature scheme

Canonical input format:

```
<METHOD>\n<path>\n<userId>\n<body>
```

- `METHOD`: uppercase verb (`GET`, `POST`, `PUT`, `DELETE`).
- `path`: URL pathname only. No query string in v1 (no current routes are query-driven). If a future route depends on query params for semantics, include them here.
- `userId`: session user id string, or empty string `""` for system flows. Always present in the input.
- `body`: the raw bytes of the request body, UTF-8 decoded. Empty body = empty string. The signed bytes MUST equal the bytes apps/api receives. JSON bodies must be serialized identically on both sides — web's `JSON.stringify` output is the canonical form; api reads `req.rawBody` (already enabled in `apps/api/src/main.ts` via `rawBody: true`).

Output: lowercase hex string (64 chars for SHA-256).

Comparison: `crypto.timingSafeEqual` on equal-length buffers. Length mismatch → 401 immediately.

## 5. Components

### 5.1 apps/api file layout

```
apps/api/src/auth/
  internal-sign.util.ts             # computeSignature(method, path, userId, body, secret) → hex
  internal-sign.guard.ts            # InternalSignGuard (CanActivate)
  public.decorator.ts               # @Public() — SetMetadata(IS_PUBLIC_KEY, true)
  auth.module.ts                    # provides APP_GUARD = InternalSignGuard
```

`AuthModule` imported in `AppModule` so the guard becomes global. From that moment, every Nest route is default-deny unless decorated `@Public()`.

`@Public()` is applied to:
- `apps/api/src/health/health.controller.ts` (the `@Get()` method)
- `apps/api/src/jubelio/webhooks/webhooks.controller.ts` (the `POST :event` method) — the controller keeps its existing Jubelio `Sign` header verification

### 5.2 New endpoint — outbox direct enqueue

`apps/api/src/jubelio/outbox/jubelio-outbox.controller.ts`:

```ts
@Controller("jubelio/outbox")
export class JubelioOutboxController {
  constructor(private readonly poller: OutboxPoller) {}

  @Post("enqueue/:rowId")
  @HttpCode(200)
  async enqueue(@Param("rowId") rowId: string): Promise<{ ok: boolean }> {
    await this.poller.enqueueById(rowId);
    return { ok: true };
  }
}
```

Registered as a controller on `JubelioOutboxModule`. Inherits the global `InternalSignGuard` automatically.

### 5.3 `OutboxPoller.enqueueById(rowId)`

New public method. Extracted from the existing `poll()` inner loop — the per-row logic (revert PROCESSING → PENDING if stuck, add BullMQ job, stamp `lastEnqueuedAt`) becomes `enqueueById(rowId)`. `poll()` then iterates the candidate batch and calls this method for each.

Behavior: idempotent if called twice for the same `rowId` — BullMQ `jobId: rowId` deduplicates at the queue level.

Surface this branch adds: the public method + the new controller endpoint that calls it. Existing scheduled `poll()` behavior unchanged.

### 5.4 apps/web file layout

```
apps/web/lib/internal-api.ts        # signInternalRequest + apiFetch
```

`signInternalRequest(method, path, userId, body): string` — produces the hex signature.

`apiFetch(method, path, opts): Promise<{ ok, status, data?, error? }>` — wraps `fetch` with signing + headers. Reads `INTERNAL_API_URL` (existing env) for the base.

Single file, no new deps (`node:crypto` + global `fetch`).

### 5.5 Retrofit — existing web → api call sites

Pre-flight audit before code:

```bash
grep -rn "INTERNAL_API_URL\|fetch.*localhost:3001" apps/web --include="*.ts" --include="*.tsx" | grep -v node_modules
```

For each match: wrap with `apiFetch(method, path, { userId, body })`. Pass `session.user.id` for `userId`; pass `""` for system/cron callers. Anything not retrofitted will 401 once the guard ships.

Expected call sites (verified at implementation):
- `apps/web/app/actions/settings/jubelio.ts` — Jubelio status / refresh / catalog-sync triggers.
- `apps/web/app/actions/jubelio-outbox.ts` — `pushItemStockToJubelio` and `bulkPushAllStockToJubelio` gain a NEW `apiFetch("POST", "/jubelio/outbox/enqueue/<rowId>", { userId })` call **after** the row inserts.

Direct enqueue policy:
- **Per-item push**: server action inserts row → fires `apiFetch` for instant enqueue → returns. `.catch` swallows HTTP failure — the poller picks the row up within 5s as the safety net.
- **Bulk push**: server action inserts N rows → returns immediately, no fan-out api calls. Poller drains. Fan-out would multiply HTTP cost for marginal latency gain on a bulk path.

## 6. Env

New variable in both `apps/api/.env` and `apps/web/.env`:

```
INTERNAL_API_SECRET=<openssl rand -base64 32>
```

`.env.example` updates in both apps. Generate fresh value at first setup; secret values committed to neither.

## 7. Testing

| Layer | Tests | Approach |
|---|---|---|
| `internal-sign.util.ts` `computeSignature` (apps/api) | same inputs → same hex; each input field changes output independently; hex is 64 chars | pure unit |
| `internal-sign.guard.ts` `InternalSignGuard.canActivate` | `@Public()` route → allow without inspecting headers; missing `X-Internal-Sign` → 401; missing `X-User-Id` → 401; wrong sig → 401; correct sig → allow + attaches `req.userId`; missing `INTERNAL_API_SECRET` env → 401 | jest + Nest `TestingModule`; mock `Reflector` + `ConfigService` |
| `signInternalRequest` (apps/web) | mirrors api util tests; a known fixture produces the same hex on both sides | pure unit; uses the same node `crypto` API |
| `apiFetch` (apps/web) | skipped — pure plumbing, mocking `fetch` adds little | n/a |
| `OutboxPoller.enqueueById` extraction | existing poll() tests already cover the per-row behavior. If they don't, add one targeted test for `enqueueById` (queues with correct opts + stamps `lastEnqueuedAt`). | jest + mock prisma + queue |
| `JubelioOutboxController.enqueue` | not unit-tested in this branch — delegates to `enqueueById`. Manual smoke covers. | n/a |

Target ~10 tests across 3 suites (util both sides + guard).

### 7.1 Manual smoke

1. Generate `INTERNAL_API_SECRET`; set in both `apps/{api,web}/.env`. Restart both services.
2. **401 paths:** `curl http://localhost:3001/jubelio/status` (no headers) → 401. With wrong sig → 401. With missing `X-User-Id` → 401.
3. **Correct sig** (use the canonical bash recipe with `openssl dgst -sha256 -hmac`) → 200.
4. **`@Public()` routes:** `curl http://localhost:3001/health` → 200 with no headers. Jubelio webhook delivery still works (its own `Sign` header verified inside the controller).
5. **Web→api integration:** open `/backoffice/jubelio/admin` as admin; click an existing admin action (e.g. catalog sync). Request succeeds via the signed client. View Network tab; confirm `X-Internal-Sign` and `X-User-Id` headers present.
6. **Direct-enqueue happy path:** click "Push stock to Jubelio" on an item page. Outbox row appears in the dashboard; status transitions PENDING → DONE within ~1s (instant via the new endpoint, not the 5s poller window).
7. **Direct-enqueue fallback:** remove `INTERNAL_API_URL` from `apps/web/.env` so the api HTTP call fails. Click push. Row inserts. Poller picks it up within 5s. DONE. Restore env.

## 8. Open items

- **Replay protection.** No timestamp or nonce in v1. Internal TLS-only traffic; revisit if a threat model change demands it.
- **Secret rotation.** Manual: regenerate, update both env stores, restart both processes. ~30s of 401s in flight. Graceful overlap (accept old + new for an overlap window) is straightforward to add later — out of scope.
- **Per-permission RBAC on api side.** Not in this branch. When the api ever serves a different consumer, extract `PERMISSIONS` constants into a shared package and import on both sides.
- **System-flow user-id.** Convention: empty string `""` for cron/background callers. api logs `userId=null` in audit-relevant rows. No code change here, just documented behavior.
- **Direct-enqueue replaces poller fully?** No. Poller is the documented BOUNDARY §4.2 primitive and remains the safety net for any flow that can't fire the api call (cron, background jobs, retries from outside the web process).

## 9. References

- `docs/BOUNDARY.md §5` (auth model — this spec closes the web→api row), §4.2 (outbox communication pattern).
- Sub-2 spec: `docs/superpowers/specs/2026-05-28-jubelio-outbox-design.md` — outbox infrastructure this branch builds the direct-enqueue path on top of.
- `apps/api/src/jubelio/webhooks/signature.ts` — Jubelio inbound HMAC verification; the internal-sign scheme is a sibling primitive with a different secret and different signed input.
- `apps/api/src/jubelio/outbox/outbox-poller.service.ts` — `enqueueById(rowId)` extracted here for the controller to call.
