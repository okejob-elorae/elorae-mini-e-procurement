import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, type JWTPayload } from "jose";
import { VIRA_TOKEN_AUDIENCE, VIRA_TOKEN_ISSUER } from "./config";
import { ViraAuthError, type ViraAuthReason } from "./errors";
import { passwordFingerprint, signViraToken, verifyViraToken } from "./token";

const SECRET = "test-vira-token-secret-0123456789abcdefg";
const NOW = new Date("2026-11-16T05:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

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

function validClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    sub: "42",
    iss: VIRA_TOKEN_ISSUER,
    aud: VIRA_TOKEN_AUDIENCE,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 600,
    jti: "test-jti",
    pwf: passwordFingerprint("hash"),
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

describe("VIRA token", () => {
  beforeEach(() => {
    vi.stubEnv("VIRA_TOKEN_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a 40-character test secret", () => {
    expect(SECRET).toHaveLength(40);
  });

  it("sign → verify round trip returns sub, iss, aud, jti and pwf", async () => {
    const { token } = await signViraToken({ userId: 42, passwordHash: "hash", now: NOW });
    const claims = await verifyViraToken(token, NOW);
    expect(claims.sub).toBe("42");
    expect(claims.iss).toBe("elorae");
    expect(claims.aud).toBe("vira-mcp");
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.pwf).toBe(passwordFingerprint("hash"));
    expect(claims.iat).toBe(NOW_SECONDS);
    expect(claims.exp).toBe(NOW_SECONDS + 600);
  });

  it("every token gets its own jti", async () => {
    const a = await signViraToken({ userId: "7", passwordHash: null, now: NOW });
    const b = await signViraToken({ userId: "7", passwordHash: null, now: NOW });
    const [ca, cb] = await Promise.all([verifyViraToken(a.token, NOW), verifyViraToken(b.token, NOW)]);
    expect(ca.jti).not.toBe(cb.jti);
  });

  it("expiresAt = now + 600 s", async () => {
    const { expiresAt } = await signViraToken({ userId: 42, passwordHash: "hash", now: NOW });
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 600_000);
  });

  it("passes at now + 629 s (clock skew) and is expired at now + 631 s", async () => {
    const { token } = await signViraToken({ userId: 42, passwordHash: "hash", now: NOW });
    await expect(verifyViraToken(token, at(629))).resolves.toMatchObject({ sub: "42" });
    expect(await reasonOf(verifyViraToken(token, at(631)))).toBe("expired");
  });

  it("wrong aud → invalid", async () => {
    const token = await handSigned(validClaims({ aud: "someone-else" }));
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("a confirm token (aud vira-confirm) → invalid", async () => {
    const token = await handSigned(validClaims({ aud: "vira-confirm" }));
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("wrong iss → invalid", async () => {
    const token = await handSigned(validClaims({ iss: "not-elorae" }));
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("a signature made with a different secret → invalid", async () => {
    const token = await handSigned(validClaims(), { secret: "another-secret-0123456789abcdefghijklmn" });
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("a hand-built alg: none token → invalid", async () => {
    const token = `${base64url({ alg: "none", typ: "JWT" })}.${base64url(validClaims())}.`;
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("a token signed HS512 with the right secret → invalid", async () => {
    const token = await handSigned(validClaims(), { alg: "HS512" });
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("a token missing pwf → invalid", async () => {
    const claims = validClaims();
    delete claims.pwf;
    const token = await handSigned(claims);
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("invalid");
  });

  it("garbage → invalid, and the message never contains the token", async () => {
    const token = "not.a.jwt-at-all";
    const err = await verifyViraToken(token, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ViraAuthError);
    expect((err as ViraAuthError).reason).toBe("invalid");
    expect((err as ViraAuthError).message).not.toContain(token);
  });

  it("secret unset → sign and verify both throw missing_secret", async () => {
    const { token } = await signViraToken({ userId: 42, passwordHash: "hash", now: NOW });
    vi.stubEnv("VIRA_TOKEN_SECRET", "");
    expect(await reasonOf(signViraToken({ userId: 42, passwordHash: "hash", now: NOW }))).toBe(
      "missing_secret",
    );
    expect(await reasonOf(verifyViraToken(token, NOW))).toBe("missing_secret");
  });
});

describe("passwordFingerprint", () => {
  it("is stable for the same input and differs for different input", () => {
    expect(passwordFingerprint("hash-a")).toBe(passwordFingerprint("hash-a"));
    expect(passwordFingerprint("hash-a")).not.toBe(passwordFingerprint("hash-b"));
  });

  it("null, undefined and an empty string give the same value", () => {
    expect(passwordFingerprint(null)).toBe(passwordFingerprint(""));
    expect(passwordFingerprint(undefined)).toBe(passwordFingerprint(""));
  });

  it("is base64url SHA-256 (43 chars, no padding)", () => {
    expect(passwordFingerprint("x")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
