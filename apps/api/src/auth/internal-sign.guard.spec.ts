import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { InternalSignGuard } from "./internal-sign.guard";
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
