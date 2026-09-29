/**
 * The POD upload route's 404 (shipment missing, not SALESMAN_CARRY, or not this carrier's) and
 * 409 (shipment no longer IN_TRANSIT) are the same refusals the completion writer would raise as
 * `NOT_FOUND` / `INVALID_STATE`, only now they fire first. Both callers — the online sheet and the
 * offline sync — must treat them as terminal with that reason: queued or retried, they would only
 * grind through the retry ceiling and end as `RETRY_LIMIT_EXCEEDED`, losing the diagnosis. Every
 * other non-ok status (401, 403, 5xx) is left to the caller as a plain failure, i.e. a retry.
 */
export class PodUploadRefusedError extends Error {
  readonly reason: "NOT_FOUND" | "INVALID_STATE";

  constructor(reason: "NOT_FOUND" | "INVALID_STATE") {
    super(`upload refused: ${reason}`);
    this.name = "PodUploadRefusedError";
    this.reason = reason;
  }
}

export function throwIfPodUploadRefused(res: { status: number }): void {
  if (res.status === 404) throw new PodUploadRefusedError("NOT_FOUND");
  if (res.status === 409) throw new PodUploadRefusedError("INVALID_STATE");
}
