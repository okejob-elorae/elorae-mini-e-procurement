export type RequestStatus = "OPEN" | "CONVERTED" | "CANCELLED";

/** Header status from its lines: any open line keeps it open; else converted wins over cancelled. */
export function deriveRequestStatus(lines: RequestStatus[]): RequestStatus {
  if (lines.some((s) => s === "OPEN")) return "OPEN";
  if (lines.some((s) => s === "CONVERTED")) return "CONVERTED";
  return "CANCELLED";
}
