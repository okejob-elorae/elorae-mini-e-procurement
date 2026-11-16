import { prisma } from "@elorae/db";
import { PILIH_PENGGUNA_SESI, isiSesiDari } from "@/lib/auth/segarkan-sesi";
import { hasPermission } from "@/lib/rbac";
import { VIRA_USE_PERMISSION } from "./config";
import { ViraAuthError } from "./errors";
import { passwordFingerprint, type ViraTokenClaims } from "./token";

export type ViraActor = { id: string; name: string; permissions: string[] };

export type ViraGate =
  | { kind: "anyValidToken" }
  | { kind: "code"; code: string }
  | { kind: "anyOf"; codes: readonly string[] }
  | { kind: "allOf"; codes: readonly string[] }
  | { kind: "izin"; name: string; check: (permissions: string[]) => boolean };

/** Loads the user fresh from the DB on every call. Throws ViraAuthError("invalid")
 *  if the user does not exist, if pwf does not match, or if the user is inactive
 *  (only if NextAuth rejects inactive users — see step 3). */
export async function loadActor(claims: Pick<ViraTokenClaims, "sub" | "pwf">): Promise<ViraActor> {
  // No segarkanToken and no cache: permissions are read from the DB on every call.
  const u = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { ...PILIH_PENGGUNA_SESI, id: true, name: true, passwordHash: true },
  });
  if (!u) throw new ViraAuthError("invalid", "VIRA token user not found");
  if (passwordFingerprint(u.passwordHash) !== claims.pwf) {
    throw new ViraAuthError("invalid", "VIRA token is no longer valid for this user");
  }
  // The NextAuth jwt callback (lib/auth.ts) has no inactive/disabled/soft-deleted check —
  // User has no such column (see lib/auth/segarkan-sesi.ts) — so none is added here.
  return {
    id: u.id,
    // Same display-name field the session carries (session.user.name = User.name). No email fallback.
    name: u.name ?? "",
    permissions: isiSesiDari(u).permissions,
  };
}

/** Uses hasPermission() from lib/rbac.ts for every code check, so "*" behaves exactly like the UI. */
export function gateAllows(gate: ViraGate, permissions: string[]): boolean {
  switch (gate.kind) {
    case "anyValidToken":
      return true;
    case "code":
      return hasPermission(permissions, gate.code);
    // An anyOf/allOf with no codes denies: an empty requirement must never open a tool to everyone.
    case "anyOf":
      return gate.codes.length > 0 && gate.codes.some((c) => hasPermission(permissions, c));
    case "allOf":
      return gate.codes.length > 0 && gate.codes.every((c) => hasPermission(permissions, c));
    case "izin":
      return gate.check(permissions);
  }
}

/** Throws ViraAuthError("forbidden") unless the actor has VIRA_USE_PERMISSION (via hasPermission). */
export function requireViraUse(actor: ViraActor): void {
  if (!hasPermission(actor.permissions, VIRA_USE_PERMISSION)) {
    throw new ViraAuthError("forbidden", "VIRA is not enabled for this user");
  }
}
