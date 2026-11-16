import { createHash, randomUUID } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import {
  getViraEnv,
  VIRA_CLOCK_SKEW_SECONDS,
  VIRA_TOKEN_AUDIENCE,
  VIRA_TOKEN_ISSUER,
  VIRA_TOKEN_TTL_SECONDS,
} from "./config";
import { ViraAuthError } from "./errors";

export type ViraTokenClaims = {
  sub: string;
  iss: "elorae";
  aud: "vira-mcp";
  iat: number;
  exp: number;
  jti: string;
  pwf: string;
};

/** base64url( SHA-256( passwordHash ?? "" ) ). Uses node:crypto. */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  return createHash("sha256")
    .update(passwordHash ?? "")
    .digest("base64url");
}

function secretKey(): Uint8Array {
  const secret = getViraEnv().tokenSecret;
  if (!secret) throw new ViraAuthError("missing_secret", "VIRA token secret is not configured");
  return new TextEncoder().encode(secret);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Signs with VIRA_TOKEN_SECRET. Throws ViraAuthError("missing_secret") if unset. */
export async function signViraToken(input: {
  userId: string | number;
  passwordHash: string | null | undefined;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const key = secretKey();
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const expSeconds = nowSeconds + VIRA_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ pwf: passwordFingerprint(input.passwordHash) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(VIRA_TOKEN_ISSUER)
    .setAudience(VIRA_TOKEN_AUDIENCE)
    .setSubject(String(input.userId))
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .setJti(randomUUID())
    .sign(key);
  return { token, expiresAt: new Date(expSeconds * 1000) };
}

/** Verifies. Throws ViraAuthError with reason:
 *  "missing_secret" (secret unset), "expired" (exp passed beyond skew), "invalid" (anything else). */
export async function verifyViraToken(token: string, now?: Date): Promise<ViraTokenClaims> {
  const key = secretKey();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: VIRA_TOKEN_ISSUER,
      audience: VIRA_TOKEN_AUDIENCE,
      clockTolerance: VIRA_CLOCK_SKEW_SECONDS,
      currentDate: now,
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new ViraAuthError("expired", "VIRA token has expired");
    }
    throw new ViraAuthError("invalid", "VIRA token is invalid");
  }
  const { sub, jti, pwf, iat, exp } = payload;
  if (!isNonEmptyString(sub) || !isNonEmptyString(jti) || !isNonEmptyString(pwf)) {
    throw new ViraAuthError("invalid", "VIRA token is invalid");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new ViraAuthError("invalid", "VIRA token is invalid");
  }
  return { sub, iss: VIRA_TOKEN_ISSUER, aud: VIRA_TOKEN_AUDIENCE, iat, exp, jti, pwf };
}
