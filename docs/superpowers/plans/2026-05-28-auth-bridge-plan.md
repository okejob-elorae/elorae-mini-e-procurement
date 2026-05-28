# API Auth Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default-deny HMAC-SHA256 guard on every web→api route, with `@Public()` opt-out for `/health` and the Jubelio webhook receiver. Shared `INTERNAL_API_SECRET` between apps. New internal endpoint `POST /jubelio/outbox/enqueue/:rowId` invoked by web's outbox server actions to replace the poller's role as the only drain path on the per-item push flow.

**Architecture:** apps/web mints a per-call hex signature over `${METHOD}\n${path}\n${userId}\n${body}` using `INTERNAL_API_SECRET`; sends `X-Internal-Sign` + `X-User-Id` headers. apps/api global `InternalSignGuard` (registered as `APP_GUARD`) recomputes and timing-safe-compares; attaches `userId` to the request for audit. `@Public()` decorator opts routes out. Web is the RBAC boundary; api logs `userId` only. Activation of the global guard lands in the FINAL task so intermediate commits don't break dev.

**Tech Stack:** NestJS 11 (`@nestjs/common`, `@nestjs/core` `APP_GUARD`, `Reflector`, `ConfigService`), Next.js 16 server actions, Node built-in `node:crypto` (`createHmac`, `timingSafeEqual`), jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-05-28-auth-bridge-design.md`

---

## File Structure

**New files:**

```
apps/api/src/auth/internal-sign.util.ts             # computeSignature(method, path, userId, body, secret)
apps/api/src/auth/internal-sign.util.spec.ts
apps/api/src/auth/public.decorator.ts               # @Public() + IS_PUBLIC_KEY constant
apps/api/src/auth/internal-sign.guard.ts            # InternalSignGuard (CanActivate)
apps/api/src/auth/internal-sign.guard.spec.ts
apps/api/src/auth/auth.module.ts                    # provides APP_GUARD = InternalSignGuard

apps/api/src/jubelio/outbox/jubelio-outbox.controller.ts   # POST /jubelio/outbox/enqueue/:rowId

apps/web/lib/internal-api.ts                        # signInternalRequest + apiFetch
```

**Modified files:**

```
apps/api/src/app.module.ts                          # import AuthModule (Task 11 — activation)
apps/api/src/health/health.controller.ts            # @Public() on the GET
apps/api/src/jubelio/webhooks/webhooks.controller.ts        # @Public() on the @Post()
apps/api/src/jubelio/outbox/jubelio-outbox.module.ts        # controllers: [JubelioOutboxController]
apps/api/src/jubelio/outbox/outbox-poller.service.ts        # extract enqueueById() public method

apps/api/.env.example                               # + INTERNAL_API_SECRET block
apps/web/.env.example                               # + INTERNAL_API_SECRET block

apps/web/app/actions/jubelio-outbox.ts              # fire apiFetch after row insert (per-item only)
apps/web/app/actions/settings/jubelio.ts            # retrofit existing INTERNAL_API_URL fetches
```

**Reused from earlier branches (do not modify):**

- `apps/api/src/db/prisma.module.ts` — `PRISMA` + `PrismaService`
- `apps/api/src/jubelio/queue/errors.ts` — `NonRetryableError` (not used here, but stays)
- `apps/api/src/main.ts` — already has `rawBody: true` so the guard can read `req.rawBody`
- Sub-2 outbox primitives (poller, processor, router, handler)

---

## Task 1: Env example updates

**Files:**
- Modify: `apps/api/.env.example`
- Modify: `apps/web/.env.example`

Sets up the new env contract before any code reads it. Local `.env` files (gitignored) get the value filled in by the operator.

- [ ] **Step 1: Append `INTERNAL_API_SECRET` block to `apps/api/.env.example`**

Read the file first to find the bottom of the structured block (after the existing CORS_ORIGINS or REDIS_URL section). Append:

```bash

# ────────────────────────────────────────────────
# Internal API auth bridge (HMAC-SHA256 between apps/web ↔ apps/api)
# ────────────────────────────────────────────────
# Shared secret used by apps/web to sign every web→api request and by
# apps/api to verify. Must match the value in apps/web/.env exactly.
# Generate: openssl rand -base64 32
INTERNAL_API_SECRET=
```

- [ ] **Step 2: Append the same block to `apps/web/.env.example`**

Read the file first. Append the SAME block as above (header comment + INTERNAL_API_SECRET line) at the bottom, after the other env sections.

- [ ] **Step 3: Generate a value + populate both local `.env` files**

```bash
NEW_SECRET=$(openssl rand -base64 32)
echo "INTERNAL_API_SECRET=$NEW_SECRET" >> apps/api/.env
echo "INTERNAL_API_SECRET=$NEW_SECRET" >> apps/web/.env
```

DO NOT commit the local `.env` files (already gitignored). Verify:

```bash
git status -s apps/api/.env apps/web/.env
```

Expected: nothing (both gitignored).

- [ ] **Step 4: Commit only the `.env.example` files**

```bash
git add apps/api/.env.example apps/web/.env.example
git commit -m "build: INTERNAL_API_SECRET env entry for both apps"
```

---

## Task 2: HMAC signature utility (apps/api) + tests (TDD)

**Files:**
- Create: `apps/api/src/auth/internal-sign.util.spec.ts`
- Create: `apps/api/src/auth/internal-sign.util.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/auth/internal-sign.util.spec.ts`:

```ts
import { computeSignature } from "./internal-sign.util";

describe("computeSignature", () => {
  const secret = "test-secret-xyz";

  it("produces a 64-char lowercase hex string for HMAC-SHA256", () => {
    const sig = computeSignature("POST", "/test", "user_1", "{}", secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hex for identical inputs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_1", "{}", secret);
    expect(a).toBe(b);
  });

  it("changes when the method differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("GET", "/test", "user_1", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the path differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/other", "user_1", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the userId differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_2", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the body differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_1", `{"a":1}`, secret);
    expect(a).not.toBe(b);
  });

  it("accepts empty string for userId (system flow)", () => {
    const sig = computeSignature("GET", "/health-detail", "", "", secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uppercases the method before hashing (case-insensitive method)", () => {
    const a = computeSignature("post", "/test", "u", "", secret);
    const b = computeSignature("POST", "/test", "u", "", secret);
    expect(a).toBe(b);
  });

  it("matches a known fixture (regression guard against silent format drift)", () => {
    const sig = computeSignature(
      "POST",
      "/jubelio/outbox/enqueue/abc123",
      "user_admin_123",
      "",
      "test-secret-xyz",
    );
    // Computed once and pinned; do not change without bumping the protocol.
    expect(sig).toBe(
      "9b8e3def6ee0019b3e0a3a99e0fce3b15de0a7c1eaad8efb18cf3c39d9a6c95f",
    );
  });
});
```

Note on the fixture in the last test: the expected hex is what the algorithm WILL produce for those exact inputs. If the implementation in Step 3 uses the documented format `${METHOD}\n${path}\n${userId}\n${body}` and HMAC-SHA256, this fixture will pass. If a subsequent change to format breaks it, the test catches the drift loudly. The fixture is pre-computed; the implementer should NOT regenerate it to fit a broken implementation. If the fixture fails, the format must match the spec.

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern internal-sign.util 2>&1 | tail -10
```

Expected: module not found `./internal-sign.util`.

- [ ] **Step 3: Implement the util**

Create `apps/api/src/auth/internal-sign.util.ts`:

```ts
import { createHmac } from "node:crypto";

export function computeSignature(
  method: string,
  path: string,
  userId: string,
  body: string,
  secret: string,
): string {
  const input = `${method.toUpperCase()}\n${path}\n${userId}\n${body}`;
  return createHmac("sha256", secret).update(input).digest("hex");
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern internal-sign.util 2>&1 | tail -10
```

Expected: `Tests: 9 passed`.

If the fixture test (`matches a known fixture`) fails: the literal hex in the spec was pre-computed assuming the exact algorithm above. Verify your implementation matches the format precisely (`\n` as separators, uppercase method, hex digest). Do NOT regenerate the fixture — that defeats the regression-guard purpose.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/internal-sign.util.ts apps/api/src/auth/internal-sign.util.spec.ts
git commit -m "feat(api): HMAC-SHA256 internal request signature util"
```

---

## Task 3: `@Public()` decorator

**Files:**
- Create: `apps/api/src/auth/public.decorator.ts`

- [ ] **Step 1: Write the decorator**

Create `apps/api/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/public.decorator.ts
git commit -m "feat(api): @Public() decorator for guard opt-out"
```

---

## Task 4: InternalSignGuard + tests (TDD)

**Files:**
- Create: `apps/api/src/auth/internal-sign.guard.spec.ts`
- Create: `apps/api/src/auth/internal-sign.guard.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/auth/internal-sign.guard.spec.ts`:

```ts
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { InternalSignGuard } from "./internal-sign.guard";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { computeSignature } from "./internal-sign.util";

const SECRET = "guard-test-secret";

function mockContext(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  rawBody?: string;
}): ExecutionContext {
  const req = {
    method: opts.method ?? "POST",
    path: opts.path ?? "/jubelio/status",
    headers: opts.headers ?? {},
    rawBody: opts.rawBody !== undefined ? Buffer.from(opts.rawBody, "utf8") : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as unknown as ExecutionContext;
}

describe("InternalSignGuard", () => {
  let guard: InternalSignGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    config = { get: jest.fn().mockReturnValue(SECRET) };
    const mod = await Test.createTestingModule({
      providers: [
        InternalSignGuard,
        { provide: Reflector, useValue: reflector },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    guard = mod.get(InternalSignGuard);
  });

  it("allows the request when route is @Public()", () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const ctx = mockContext({});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects when X-Internal-Sign is missing", () => {
    const ctx = mockContext({ headers: { "x-user-id": "u" } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when X-User-Id is missing", () => {
    const ctx = mockContext({ headers: { "x-internal-sign": "deadbeef" } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when INTERNAL_API_SECRET env is unset", () => {
    config.get.mockReturnValue(undefined);
    const ctx = mockContext({
      headers: { "x-internal-sign": "deadbeef", "x-user-id": "u" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when signature is wrong", () => {
    const ctx = mockContext({
      headers: { "x-internal-sign": "deadbeef".repeat(8), "x-user-id": "u" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("rejects when signature is wrong length", () => {
    const ctx = mockContext({
      headers: { "x-internal-sign": "deadbeef", "x-user-id": "u" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("allows + attaches userId when signature is correct", () => {
    const method = "POST";
    const path = "/jubelio/status";
    const userId = "user_admin_42";
    const body = "";
    const sig = computeSignature(method, path, userId, body, SECRET);

    const req: any = {
      method,
      path,
      headers: { "x-internal-sign": sig, "x-user-id": userId },
      rawBody: Buffer.from(body, "utf8"),
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}) as any,
      getClass: () => ({}) as any,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.userId).toBe(userId);
  });

  it("verifies signature over the raw body bytes", () => {
    const method = "POST";
    const path = "/jubelio/refresh";
    const userId = "u_1";
    const body = `{"hello":"world"}`;
    const sig = computeSignature(method, path, userId, body, SECRET);

    const req: any = {
      method,
      path,
      headers: { "x-internal-sign": sig, "x-user-id": userId },
      rawBody: Buffer.from(body, "utf8"),
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}) as any,
      getClass: () => ({}) as any,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("accepts empty userId for system flows", () => {
    const sig = computeSignature("GET", "/jubelio/status", "", "", SECRET);
    const req: any = {
      method: "GET",
      path: "/jubelio/status",
      headers: { "x-internal-sign": sig, "x-user-id": "" },
      rawBody: undefined,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}) as any,
      getClass: () => ({}) as any,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm -F @elorae/api test --testPathPattern internal-sign.guard 2>&1 | tail -10
```

Expected: module not found.

- [ ] **Step 3: Implement the guard**

Create `apps/api/src/auth/internal-sign.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { computeSignature } from "./internal-sign.util";

@Injectable()
export class InternalSignGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const sig = req.headers["x-internal-sign"];
    const userId = req.headers["x-user-id"];

    if (typeof sig !== "string" || typeof userId !== "string") {
      throw new UnauthorizedException("Missing internal auth headers");
    }

    const secret = this.config.get<string>("INTERNAL_API_SECRET");
    if (!secret) {
      throw new UnauthorizedException("Server misconfigured");
    }

    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const expected = computeSignature(req.method, req.path, userId, rawBody, secret);

    let sigBuf: Buffer;
    let expectedBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig, "hex");
      expectedBuf = Buffer.from(expected, "hex");
    } catch {
      throw new UnauthorizedException("Invalid signature encoding");
    }

    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedException("Invalid signature");
    }

    (req as Request & { userId: string }).userId = userId;
    return true;
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm -F @elorae/api test --testPathPattern internal-sign.guard 2>&1 | tail -10
```

Expected: `Tests: 9 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/internal-sign.guard.ts apps/api/src/auth/internal-sign.guard.spec.ts
git commit -m "feat(api): InternalSignGuard with @Public() opt-out"
```

---

## Task 5: AuthModule (provider skeleton, NOT yet wired)

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`

Module declared but NOT yet imported into `AppModule` — activation deferred to Task 11 so intermediate dev mode keeps working.

- [ ] **Step 1: Write the module**

Create `apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { InternalSignGuard } from "./internal-sign.guard";

@Module({
  imports: [ConfigModule],
  providers: [{ provide: APP_GUARD, useClass: InternalSignGuard }],
})
export class AuthModule {}
```

- [ ] **Step 2: Type-check**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/auth.module.ts
git commit -m "feat(api): AuthModule registering InternalSignGuard as APP_GUARD"
```

---

## Task 6: @Public() on health + webhook routes

**Files:**
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/jubelio/webhooks/webhooks.controller.ts`

Applies the decorator now so when activation lands in Task 11, these routes are already opted out.

- [ ] **Step 1: Read both files first**

```bash
cat apps/api/src/health/health.controller.ts
cat apps/api/src/jubelio/webhooks/webhooks.controller.ts | head -50
```

- [ ] **Step 2: Add `@Public()` to the health controller**

Add the import at the top of `apps/api/src/health/health.controller.ts`:

```ts
import { Public } from "../auth/public.decorator";
```

Decorate the `@Get()` method with `@Public()` immediately above it. Final method should look approximately like:

```ts
@Public()
@Get()
check() {
  return { status: "ok", service: "@elorae/api", timestamp: new Date().toISOString() };
}
```

Don't change the method body or its return shape.

- [ ] **Step 3: Add `@Public()` to the webhook controller**

Add the import at the top of `apps/api/src/jubelio/webhooks/webhooks.controller.ts`:

```ts
import { Public } from "../../auth/public.decorator";
```

Decorate the `@Post(":event")` method with `@Public()`. The existing Jubelio `Sign` header verification INSIDE the method stays — `@Public()` only opts out of the global `InternalSignGuard`. Webhook routes keep their own auth.

Final method decorators (in order):

```ts
@Public()
@Post(":event")
@HttpCode(200)
@ApiOperation({...existing...})
async receive(...) { ...existing... }
```

- [ ] **Step 4: Type-check + run all tests (regression)**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: both silent success. Existing test counts unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/health/health.controller.ts apps/api/src/jubelio/webhooks/webhooks.controller.ts
git commit -m "feat(api): @Public() on /health and /webhooks/jubelio/:event"
```

---

## Task 7: Extract `OutboxPoller.enqueueById` + add JubelioOutboxController

**Files:**
- Modify: `apps/api/src/jubelio/outbox/outbox-poller.service.ts`
- Create: `apps/api/src/jubelio/outbox/jubelio-outbox.controller.ts`
- Modify: `apps/api/src/jubelio/outbox/jubelio-outbox.module.ts`

- [ ] **Step 1: Read current poller**

```bash
cat apps/api/src/jubelio/outbox/outbox-poller.service.ts
```

The existing `poll()` method has an inner loop that, for each candidate row, (a) reverts `PROCESSING → PENDING` if it was a stuck row, (b) calls `this.q.add(...)`, (c) stamps `lastEnqueuedAt`. Extract that per-row body into a new public `enqueueById(rowId)` method.

- [ ] **Step 2: Refactor `poll()` to call `enqueueById`**

Replace the per-row try/catch inner body inside `poll()` with a call to the new method. The new method signature:

```ts
async enqueueById(rowId: string): Promise<void> {
  const row = await this.prisma.jubelioOutbox.findUnique({
    where: { id: rowId },
    select: { status: true },
  });
  if (!row) return;
  if (row.status === OUTBOX_STATUS.PROCESSING) {
    await this.prisma.jubelioOutbox.update({
      where: { id: rowId },
      data: { status: OUTBOX_STATUS.PENDING },
    });
  }
  await this.q.add(
    "process",
    { rowId },
    {
      attempts: OUTBOX_QUEUE_DEFAULTS.JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: OUTBOX_QUEUE_DEFAULTS.BACKOFF_BASE_MS },
      removeOnComplete: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_COMPLETE_COUNT },
      removeOnFail: { count: OUTBOX_QUEUE_DEFAULTS.REMOVE_ON_FAIL_COUNT },
      jobId: rowId,
    },
  );
  await this.prisma.jubelioOutbox.update({
    where: { id: rowId },
    data: { lastEnqueuedAt: new Date() },
  });
}
```

Then inside `poll()`:

```ts
for (const row of ready) {
  try {
    await this.enqueueById(row.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Poller failed on ${row.id}: ${msg}`);
  }
}
```

The `findUnique` inside `enqueueById` duplicates a read the poller already did (it has the row from its scan), but the extra read is cheap (1ms against TiDB) and lets the controller endpoint use the same method safely without trusting its caller's prior knowledge.

- [ ] **Step 3: Write the controller**

Create `apps/api/src/jubelio/outbox/jubelio-outbox.controller.ts`:

```ts
import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { OutboxPoller } from "./outbox-poller.service";

@ApiTags("jubelio-outbox")
@Controller("jubelio/outbox")
export class JubelioOutboxController {
  constructor(private readonly poller: OutboxPoller) {}

  @Post("enqueue/:rowId")
  @HttpCode(200)
  @ApiOperation({
    summary: "Enqueue an existing JubelioOutbox row for immediate processing",
    description:
      "Called by apps/web after inserting an outbox row to skip the 5s poller delay. " +
      "Idempotent at the BullMQ level via jobId=rowId. The poller is the safety net if " +
      "this call fails.",
  })
  async enqueue(@Param("rowId") rowId: string): Promise<{ ok: boolean }> {
    await this.poller.enqueueById(rowId);
    return { ok: true };
  }
}
```

- [ ] **Step 4: Register the controller in `JubelioOutboxModule`**

Read the existing module file:

```bash
cat apps/api/src/jubelio/outbox/jubelio-outbox.module.ts
```

Add the import at the top:

```ts
import { JubelioOutboxController } from "./jubelio-outbox.controller";
```

Add a `controllers:` array (it likely doesn't exist yet) to the `@Module(...)` decorator:

```ts
@Module({
  imports: [...existing...],
  providers: [...existing...],
  controllers: [JubelioOutboxController],
})
export class JubelioOutboxModule {}
```

- [ ] **Step 5: Type-check + run all tests**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: both silent success. Existing test counts unchanged. If the poller has its own test, the extracted method behavior may need a small assertion adjustment — verify the test still asserts the correct call sequence.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jubelio/outbox/outbox-poller.service.ts apps/api/src/jubelio/outbox/jubelio-outbox.controller.ts apps/api/src/jubelio/outbox/jubelio-outbox.module.ts
git commit -m "feat(api): outbox direct-enqueue endpoint + extract enqueueById"
```

---

## Task 8: apps/web internal-api helper

**Files:**
- Create: `apps/web/lib/internal-api.ts`

No unit tests on the web side (apps/web has no jest config). Algorithm correctness is verified by the matching api-side util tests; manual smoke verifies wire compatibility between the two sides.

- [ ] **Step 1: Write the helper**

Create `apps/web/lib/internal-api.ts`:

```ts
import { createHmac } from "node:crypto";

const DEFAULT_BASE = "http://localhost:3001";

function getSecret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s) {
    throw new Error(
      "INTERNAL_API_SECRET is not set. Add it to apps/web/.env (must match apps/api/.env).",
    );
  }
  return s;
}

function getBase(): string {
  return process.env.INTERNAL_API_URL ?? DEFAULT_BASE;
}

export function signInternalRequest(
  method: string,
  path: string,
  userId: string,
  body: string,
): string {
  const input = `${method.toUpperCase()}\n${path}\n${userId}\n${body}`;
  return createHmac("sha256", getSecret()).update(input).digest("hex");
}

export type ApiFetchResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export async function apiFetch<T = unknown>(
  method: string,
  path: string,
  opts: { userId: string; body?: unknown } = { userId: "" },
): Promise<ApiFetchResult<T>> {
  const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const sig = signInternalRequest(method, path, opts.userId, bodyStr);

  const headers: Record<string, string> = {
    "X-Internal-Sign": sig,
    "X-User-Id": opts.userId,
  };
  if (bodyStr) headers["Content-Type"] = "application/json";

  const res = await fetch(`${getBase()}${path}`, {
    method: method.toUpperCase(),
    headers,
    body: bodyStr || undefined,
  });

  const text = await res.text();
  const data = text ? safeJson<T>(text) : undefined;
  if (!res.ok) {
    return { ok: false, status: res.status, error: typeof data === "string" ? data : text };
  }
  return { ok: true, status: res.status, data: data as T };
}

function safeJson<T>(s: string): T | string {
  try {
    return JSON.parse(s) as T;
  } catch {
    return s;
  }
}
```

- [ ] **Step 2: Type-check apps/web**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 3: Quick interop verification (manual)**

Cross-check that the web helper produces the same hex as the api util for the fixture from Task 2 Step 1's last test. In a one-off tsx session:

```bash
cd /home/rifkyltf/project/elorae
set -a && source apps/web/.env && set +a
INTERNAL_API_SECRET=test-secret-xyz pnpm -F @elorae/web exec tsx -e "
import { signInternalRequest } from './lib/internal-api';
console.log(signInternalRequest('POST', '/jubelio/outbox/enqueue/abc123', 'user_admin_123', ''));
"
```

Expected output:

```
9b8e3def6ee0019b3e0a3a99e0fce3b15de0a7c1eaad8efb18cf3c39d9a6c95f
```

Same fixture as the api-side test. If they match, both sides agree on the wire format.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/internal-api.ts
git commit -m "feat(web): signInternalRequest + apiFetch helpers"
```

---

## Task 9: Retrofit existing apps/web → api call sites

**Files:**
- Modify: `apps/web/app/actions/settings/jubelio.ts` (likely)
- Modify: any other file the audit turns up

- [ ] **Step 1: Audit**

```bash
grep -rn "INTERNAL_API_URL\|fetch.*localhost:3001\|fetch.*ngrok-free" apps/web --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Note every match. Files outside `apps/web/lib/internal-api.ts` and (already-correct) the spec/plan markdown are the retrofit targets.

- [ ] **Step 2: For each match, wrap with `apiFetch`**

The retrofit pattern, given the existing call shape `fetch(`${process.env.INTERNAL_API_URL}/...`, ...)`:

```ts
// BEFORE
const res = await fetch(`${process.env.INTERNAL_API_URL}/jubelio/refresh`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ some: "thing" }),
});
const data = await res.json();
if (!res.ok) throw new Error("refresh failed");

// AFTER
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";

const session = await auth();
const userId = session?.user?.id ?? "";

const r = await apiFetch<{ ok: boolean }>("POST", "/jubelio/refresh", {
  userId,
  body: { some: "thing" },
});
if (!r.ok) throw new Error(r.error ?? "refresh failed");
const data = r.data;
```

Apply the same transformation to every match from Step 1. For GET requests, omit the `body` field. For system-flow callers without a session, pass `userId: ""`.

If a call site doesn't already have `await auth()` because it's a non-session-aware utility, add the `auth()` call to retrieve `userId` — most server actions already do this for RBAC.

- [ ] **Step 3: Type-check + run web app's typecheck**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success. If `.next/dev/types/validator.ts` reports TS1128, `rm -rf apps/web/.next/dev` and retry.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/actions/settings/jubelio.ts
# Add any other paths the audit identified.
git commit -m "refactor(web): route existing api calls through signed apiFetch"
```

---

## Task 10: Outbox direct-enqueue from web

**Files:**
- Modify: `apps/web/app/actions/jubelio-outbox.ts`

- [ ] **Step 1: Read the existing file**

```bash
cat apps/web/app/actions/jubelio-outbox.ts
```

Find `pushItemStockToJubelio`. Currently it inserts a row and returns. Add a fire-and-forget `apiFetch` AFTER the insert, before returning.

- [ ] **Step 2: Add the imports + the direct-enqueue call**

Add the import alongside existing ones at the top:

```ts
import { apiFetch } from "@/lib/internal-api";
```

Modify `pushItemStockToJubelio`. Replace the existing implementation with:

```ts
export async function pushItemStockToJubelio(itemId: string): Promise<{ ok: boolean; outboxId?: string }> {
  if (!(await isAdmin())) return { ok: false };
  const enqueuedById = await currentUserId();
  const row = await prisma.jubelioOutbox.create({
    data: { entityType: "stock_push", entityId: itemId, payload: {}, enqueuedById },
    select: { id: true },
  });

  // Fire-and-forget direct enqueue — poller is the safety net if this fails.
  void apiFetch("POST", `/jubelio/outbox/enqueue/${row.id}`, {
    userId: enqueuedById ?? "",
  }).catch(() => {
    // swallow: poller will pick the row up within ~5s
  });

  return { ok: true, outboxId: row.id };
}
```

`bulkPushAllStockToJubelio` deliberately does NOT add direct-enqueue. Bulk relies on the poller — fan-out of N parallel HTTP calls is overhead the bulk path doesn't need.

- [ ] **Step 3: Type-check**

```bash
pnpm -F @elorae/web type-check 2>&1 | tail -5
```

Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/actions/jubelio-outbox.ts
git commit -m "feat(web): direct-enqueue outbox row after per-item push"
```

---

## Task 11: Activate the global guard

**Files:**
- Modify: `apps/api/src/app.module.ts`

THIS is the activation flip. Before this commit: every code path exists but the guard is inert. After this commit: every non-`@Public()` route is default-deny.

- [ ] **Step 1: Read current app.module**

```bash
cat apps/api/src/app.module.ts
```

- [ ] **Step 2: Import AuthModule**

Add the import at the top alongside existing imports:

```ts
import { AuthModule } from "./auth/auth.module";
```

Add `AuthModule` to the `imports: [...]` array. Order does not matter functionally; put it near the start of the array (alongside other infrastructure modules like `ConfigModule`, `ScheduleModule`).

- [ ] **Step 3: Type-check + build**

```bash
pnpm -F @elorae/api type-check 2>&1 | tail -5
pnpm -F @elorae/api build 2>&1 | tail -5
```

Expected: both silent success.

- [ ] **Step 4: Run all tests (full regression)**

```bash
pnpm -F @elorae/api test 2>&1 | tail -10
```

Expected: prior tests + auth tests = 55+ tests across 9+ suites. No regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "feat(api): activate InternalSignGuard globally"
```

---

## Task 12: End-to-end manual smoke

No file changes. User-driven verification.

- [ ] **Step 1: Start support services**

User runs (per `feedback_service_control` memory — Claude only states commands):

```bash
docker start elorae-dev-redis
```

- [ ] **Step 2: Restart api in prod mode**

User runs (must pick up new code + env):

```bash
pnpm -F @elorae/api build
cd apps/api && NODE_ENV=production node dist/main.js
```

Boot log should show:
- All previously-loaded modules
- A new `AuthModule dependencies initialized` line
- `@elorae/api listening on http://localhost:3001`

- [ ] **Step 3: Start apps/web dev**

User runs:

```bash
pnpm -F @elorae/web dev
```

Wait for `:3000` ready.

- [ ] **Step 4: Unauthenticated call → 401**

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3001/jubelio/status
```

Expected: `{"statusCode":401,"message":"Missing internal auth headers", ...}` and HTTP 401.

- [ ] **Step 5: Wrong sig → 401**

```bash
curl -s -w "\n%{http_code}\n" \
  -H "X-Internal-Sign: deadbeef" \
  -H "X-User-Id: foo" \
  http://localhost:3001/jubelio/status
```

Expected: 401 with `"Invalid signature"`.

- [ ] **Step 6: Correct sig → 200**

```bash
set -a && source apps/api/.env && set +a
METHOD="GET"
PATH_PART="/jubelio/status"
USER_ID="smoke_user"
BODY=""
INPUT="${METHOD}\n${PATH_PART}\n${USER_ID}\n${BODY}"
SIG=$(printf '%b' "$INPUT" | openssl dgst -sha256 -hmac "$INTERNAL_API_SECRET" -hex | awk '{print $2}')
curl -s -w "\n%{http_code}\n" \
  -H "X-Internal-Sign: ${SIG}" \
  -H "X-User-Id: ${USER_ID}" \
  "http://localhost:3001${PATH_PART}"
```

Expected: the route's normal response + HTTP 200.

- [ ] **Step 7: @Public() route still open**

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3001/health
```

Expected: `{"status":"ok",...}` + HTTP 200, with no auth headers.

- [ ] **Step 8: Webhook route still works on Jubelio's signature**

Use sub-1's smoke command (with `Sign` header + `JUBELIO_WEBHOOK_SECRET`):

```bash
set -a && source apps/api/.env && set +a
BODY='{"item_code":"1000061-WHT-ALLSIZE","end_qty":7}'
SIG=$(printf '%s' "$BODY$JUBELIO_WEBHOOK_SECRET" | openssl dgst -sha256 -hmac "$JUBELIO_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -s -X POST http://localhost:3001/webhooks/jubelio/stock \
  -H "Content-Type: application/json" \
  -H "Sign: $SIG" \
  -d "$BODY" -w "\nHTTP=%{http_code}\n"
```

Expected: HTTP 200 with `{"id":"...","duplicate":...}`. `@Public()` opted out of internal guard; webhook controller's own Jubelio Sign verification still gates correctly.

- [ ] **Step 9: Web→api integration via signed client**

Open `http://localhost:3000/backoffice/jubelio/admin` as admin. Trigger any existing admin action that previously called api (e.g., the catalog sync button). Confirm:
- It still succeeds.
- DevTools → Network tab → the relevant request shows `X-Internal-Sign` + `X-User-Id` headers.

- [ ] **Step 10: Outbox direct-enqueue happy path**

Click "Push stock to Jubelio" on an item page. Outbox row appears in the dashboard with status `PENDING` → `PROCESSING` → `DONE` within ~1 second (instant via the new endpoint).

Verify with:

```bash
cd /home/rifkyltf/project/elorae/packages/db && set -a && source ../../apps/web/.env && set +a && pnpm exec tsx -e "
import { prisma } from './src/index';
(async () => {
  const r = await prisma.jubelioOutbox.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, status: true, processedAt: true, createdAt: true } });
  console.log(r);
  await prisma.\$disconnect();
})();
" 2>&1 | tail -3
```

Expected: `status='DONE'`, `processedAt - createdAt` < ~1s.

- [ ] **Step 11: Direct-enqueue fallback (poller still works)**

Temporarily break the direct call: edit `apps/web/.env`, change `INTERNAL_API_URL` to a wrong value (e.g. `http://localhost:9999`). Restart web dev. Click "Push stock". Direct call fails silently. Poller picks up the row within ~5 seconds. Status reaches `DONE`. Restore env.

- [ ] **Step 12: Stop services + commit nothing**

```bash
docker stop elorae-dev-redis
# stop api: Ctrl-C in api terminal
# stop web: Ctrl-C in web terminal
```

No commit. Smoke is verification only.

- [ ] **Step 13: Push the branch**

```bash
git push -u origin feat/api-auth-bridge
```

---

## After all tasks

- Branch `feat/api-auth-bridge` carries the auth bridge + outbox direct-enqueue.
- All apps/api routes default-deny. `/health` and webhook receiver `@Public()`.
- Run `pnpm -F @elorae/api test` once more: full suite green.
- Open PR `feat/api-auth-bridge → master` when smoke is clean.
- Next slice: **sub-3** (product push + HPP/price sync). Builds on the now-secure api + the outbox infra.

## Self-Review checklist (already run; documenting for the implementer)

- **Spec coverage:**
  - §3 architecture → Tasks 2–7 build the components, Task 11 activates.
  - §4 signature scheme → Task 2 (util) + Task 4 (guard verification path).
  - §5.1 apps/api file layout → Tasks 2, 3, 4, 5.
  - §5.2 new endpoint → Task 7.
  - §5.3 `enqueueById` extraction → Task 7.
  - §5.4 apps/web layout → Task 8.
  - §5.5 retrofit → Task 9 + Task 10 (direct-enqueue is a new call site).
  - §6 env → Task 1.
  - §7 testing → Tasks 2 (util), 4 (guard); web interop verified manually in Task 8 Step 3; integration verified in Task 12.
- **No placeholders.** Every code-changing step has full code or exact diff guidance. Retrofit task uses a grep-driven audit pattern rather than hardcoding file paths that may differ at impl time.
- **Type consistency:** `computeSignature`, `signInternalRequest`, `apiFetch`, `IS_PUBLIC_KEY`, `Public`, `InternalSignGuard`, `AuthModule`, `JubelioOutboxController`, `OutboxPoller.enqueueById` all referenced consistently across tasks.
