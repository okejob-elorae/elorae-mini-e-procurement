import { randomUUID } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import {
  getViraEnv,
  VIRA_CLOCK_SKEW_SECONDS,
  VIRA_TOKEN_ISSUER,
} from "./config";
import { ViraAuthError, ViraInputError } from "./errors";

export const VIRA_CONFIRM_AUDIENCE = "vira-confirm";
export const VIRA_CONFIRM_TTL_SECONDS = 300;
const VIRA_CONFIRM_ARGS_MAX_CHARS = 4096;

export type ViraConfirmClaims = {
  sub: string; // user id who prepared it
  tool: string; // write tool name
  args: unknown; // the prepared writer args (JSON-safe)
  jti: string;
  iat: number;
  exp: number;
};

/** Used jtis → retain-until unix seconds (`exp + VIRA_CLOCK_SKEW_SECONDS + 1`).
 *  The +1 matches jose's inclusive clockTolerance boundary so a used jti cannot be
 *  pruned while verifyConfirmToken can still accept the token. In-memory, per process (E4). */
const usedJtis = new Map<string, number>();

function secretKey(): Uint8Array {
  const secret = getViraEnv().tokenSecret;
  if (!secret) throw new ViraAuthError("missing_secret", "VIRA token secret is not configured");
  return new TextEncoder().encode(secret);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function pruneUsedJtis(nowSeconds: number): void {
  for (const [jti, exp] of usedJtis) {
    if (nowSeconds >= exp) usedJtis.delete(jti);
  }
}

/** Signs with VIRA_TOKEN_SECRET via jose (HS256), iss "elorae", aud "vira-confirm".
 *  Throws ViraAuthError("missing_secret") if the secret is unset.
 *  Throws ViraInputError if JSON.stringify(args) is longer than 4096 characters. */
export async function signConfirmToken(input: {
  userId: string;
  tool: string;
  args: unknown;
  now?: Date;
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const key = secretKey();
  let argsJson: string;
  try {
    argsJson = JSON.stringify(input.args);
  } catch {
    throw new ViraInputError("Confirm token args must be JSON-serializable");
  }
  if (argsJson.length > VIRA_CONFIRM_ARGS_MAX_CHARS) {
    throw new ViraInputError(
      `Confirm token args exceed ${VIRA_CONFIRM_ARGS_MAX_CHARS} characters`,
    );
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const expSeconds = nowSeconds + VIRA_CONFIRM_TTL_SECONDS;
  const jti = randomUUID();
  const token = await new SignJWT({ tool: input.tool, args: input.args })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(VIRA_TOKEN_ISSUER)
    .setAudience(VIRA_CONFIRM_AUDIENCE)
    .setSubject(input.userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .setJti(jti)
    .sign(key);
  return { token, jti, expiresAt: new Date(expSeconds * 1000) };
}

/** Verifies signature, alg HS256 only, iss, aud "vira-confirm", exp (clock skew VIRA_CLOCK_SKEW_SECONDS).
 *  Rejects a phase 1 access token (aud "vira-mcp") and vice versa.
 *  Throws ViraAuthError("expired") or ViraAuthError("invalid"). Does NOT consume the jti. */
export async function verifyConfirmToken(token: string, now?: Date): Promise<ViraConfirmClaims> {
  const key = secretKey();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: VIRA_TOKEN_ISSUER,
      audience: VIRA_CONFIRM_AUDIENCE,
      clockTolerance: VIRA_CLOCK_SKEW_SECONDS,
      currentDate: now,
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new ViraAuthError("expired", "VIRA confirm token has expired");
    }
    throw new ViraAuthError("invalid", "VIRA confirm token is invalid");
  }
  const { sub, jti, tool, args, iat, exp } = payload;
  if (!isNonEmptyString(sub) || !isNonEmptyString(jti) || !isNonEmptyString(tool)) {
    throw new ViraAuthError("invalid", "VIRA confirm token is invalid");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new ViraAuthError("invalid", "VIRA confirm token is invalid");
  }
  if (args === undefined) {
    throw new ViraAuthError("invalid", "VIRA confirm token is invalid");
  }
  return { sub, tool, args, jti, iat, exp };
}

/** Single use. Returns true the first time a jti is seen, false after.
 *  Entries are retained until `exp + VIRA_CLOCK_SKEW_SECONDS + 1` so a used jti cannot be
 *  re-accepted while verifyConfirmToken still tolerates clock skew past bare `exp`
 *  (jose accepts through the inclusive `exp + clockTolerance` second).
 *  In-memory, per process (decision E4). Export a reset helper for tests only. */
export function consumeConfirmJti(jti: string, exp: number, now?: Date): boolean {
  const nowSeconds = Math.floor((now ?? new Date()).getTime() / 1000);
  pruneUsedJtis(nowSeconds);
  if (usedJtis.has(jti)) return false;
  usedJtis.set(jti, exp + VIRA_CLOCK_SKEW_SECONDS + 1);
  return true;
}

export function __resetConfirmJtisForTests(): void {
  usedJtis.clear();
}
