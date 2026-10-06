export class ActorMismatchError extends Error {
  constructor() {
    super("Forbidden: actor does not match the session");
    this.name = "ActorMismatchError";
  }
}

/**
 * Server actions that take the acting user's id as a parameter stamp it onto document rows and
 * ledger entries. A "use server" export is callable by URL with any arguments, so the id is only
 * trustworthy once it is proven to be the session's own.
 */
export function assertActor(sessionUserId: string, claimedUserId: string): void {
  if (!claimedUserId || claimedUserId !== sessionUserId) {
    throw new ActorMismatchError();
  }
}
