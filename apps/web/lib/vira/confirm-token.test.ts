import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, type JWTPayload } from "jose";
import { VIRA_CLOCK_SKEW_SECONDS, VIRA_TOKEN_ISSUER } from "./config";
import { ViraAuthError, ViraInputError, type ViraAuthReason } from "./errors";
import {
  VIRA_CONFIRM_AUDIENCE,
  __resetConfirmJtisForTests,
  consumeConfirmJti,
  signConfirmToken,
  verifyConfirmToken,
} from "./confirm-token";
import { signViraToken, verifyViraToken } from "./token";

const SECRET = "test-vira-token-secret-0123456789abcdefg";
const NOW = new Date("2026-11-16T05:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const ARGS = { orderId: "ord-1" };

function at(offsetSeconds: number): Date {
  return new Date(NOW.getTime() + offsetSeconds * 1000);
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function handSigned(
  claims: JWTPayload,
  options: { alg?: string; secret?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(options.secret ?? SECRET));
}

function validConfirmClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    sub: "42",
    iss: VIRA_TOKEN_ISSUER,
    aud: VIRA_CONFIRM_AUDIENCE,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    jti: "confirm-jti",
    tool: "approve_field_sales_order",
    args: ARGS,
    ...overrides,
  };
}

async function reasonOf(promise: Promise<unknown>): Promise<ViraAuthReason> {
  const err = await promise.then(
    () => {
      throw new Error("expected a ViraAuthError, got success");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ViraAuthError);
  return (err as ViraAuthError).reason;
}

describe("VIRA confirm token", () => {
  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
    __resetConfirmJtisForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetConfirmJtisForTests();
  });

  it("sign → verify round trip returns the same sub, tool, args, jti", async () => {
    const { token, jti } = await signConfirmToken({
      userId: "42",
      tool: "approve_field_sales_order",
      args: ARGS,
      now: NOW,
    });
    const claims = await verifyConfirmToken(token, NOW);
    expect(claims.sub).toBe("42");
    expect(claims.tool).toBe("approve_field_sales_order");
    expect(claims.args).toEqual(ARGS);
    expect(claims.jti).toBe(jti);
    expect(claims.iat).toBe(NOW_SECONDS);
    expect(claims.exp).toBe(NOW_SECONDS + 300);
  });

  it("passes at now + 329 s (clock skew) and is expired at now + 331 s", async () => {
    const { token } = await signConfirmToken({
      userId: "42",
      tool: "approve_field_sales_order",
      args: ARGS,
      now: NOW,
    });
    await expect(verifyConfirmToken(token, at(329))).resolves.toMatchObject({ sub: "42" });
    expect(await reasonOf(verifyConfirmToken(token, at(331)))).toBe("expired");
  });

  it("wrong signature, alg: none, HS512, wrong iss → invalid", async () => {
    expect(
      await reasonOf(
        verifyConfirmToken(
          await handSigned(validConfirmClaims(), {
            secret: "another-secret-0123456789abcdefghijklmn",
          }),
          NOW,
        ),
      ),
    ).toBe("invalid");

    const noneToken = `${base64url({ alg: "none", typ: "JWT" })}.${base64url(validConfirmClaims())}.`;
    expect(await reasonOf(verifyConfirmToken(noneToken, NOW))).toBe("invalid");

    expect(
      await reasonOf(verifyConfirmToken(await handSigned(validConfirmClaims(), { alg: "HS512" }), NOW)),
    ).toBe("invalid");

    expect(
      await reasonOf(
        verifyConfirmToken(await handSigned(validConfirmClaims({ iss: "not-elorae" })), NOW),
      ),
    ).toBe("invalid");
  });

  it("phase 1 access token ↔ confirm token cross-reject", async () => {
    const access = await signViraToken({ userId: 42, passwordHash: "hash", now: NOW });
    const confirm = await signConfirmToken({
      userId: "42",
      tool: "approve_field_sales_order",
      args: ARGS,
      now: NOW,
    });
    expect(await reasonOf(verifyConfirmToken(access.token, NOW))).toBe("invalid");
    expect(await reasonOf(verifyViraToken(confirm.token, NOW))).toBe("invalid");
  });

  it("args over 4096 characters → ViraInputError", async () => {
    const big = { pad: "x".repeat(4100) };
    await expect(
      signConfirmToken({
        userId: "42",
        tool: "approve_field_sales_order",
        args: big,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ViraInputError);
  });

  it("consumeConfirmJti: true once, then false; pruned after exp + skew", () => {
    const exp = NOW_SECONDS + 300;
    expect(consumeConfirmJti("j1", exp, NOW)).toBe(true);
    expect(consumeConfirmJti("j1", exp, NOW)).toBe(false);
    // Within skew window after bare exp, entry is retained (verify still accepts).
    expect(
      consumeConfirmJti("j1", exp, at(300 + VIRA_CLOCK_SKEW_SECONDS - 1)),
    ).toBe(false);
    // Only after exp + skew can the map drop the entry.
    expect(
      consumeConfirmJti("j1", exp, at(300 + VIRA_CLOCK_SKEW_SECONDS)),
    ).toBe(true);
  });

  it("missing secret → missing_secret for both sign and verify", async () => {
    const { token } = await signConfirmToken({
      userId: "42",
      tool: "approve_field_sales_order",
      args: ARGS,
      now: NOW,
    });
    vi.stubEnv("VIRA_TOKEN_SECRET", "");
    expect(
      await reasonOf(
        signConfirmToken({
          userId: "42",
          tool: "approve_field_sales_order",
          args: ARGS,
          now: NOW,
        }),
      ),
    ).toBe("missing_secret");
    expect(await reasonOf(verifyConfirmToken(token, NOW))).toBe("missing_secret");
  });
});
