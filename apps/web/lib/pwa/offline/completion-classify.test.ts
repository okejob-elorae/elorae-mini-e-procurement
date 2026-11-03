import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyCompletionResult } from "./completion-classify";

/** Members of an exported string-literal union, read from source with comments stripped. */
function anggotaUnion(berkas: string, nama: string): string[] {
  const sumber = readFileSync(path.join(__dirname, berkas), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const awal = sumber.indexOf(`export type ${nama}`);
  if (awal < 0) throw new Error(`${nama} not found in ${berkas}`);
  const akhir = sumber.indexOf(";", awal);
  return [...sumber.slice(awal, akhir).matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

describe("classifyCompletionResult", () => {
  it("classifies ok as evict", () => {
    expect(classifyCompletionResult({ ok: true })).toBe("evict");
  });

  it("classifies a thrown/network failure as retry", () => {
    expect(classifyCompletionResult({ thrown: true })).toBe("retry");
  });

  it("classifies FORBIDDEN as retry (unattended queue must wait for re-login, not drop the row)", () => {
    expect(classifyCompletionResult({ ok: false, reason: "FORBIDDEN" })).toBe("retry");
  });

  it("classifies UNEXPECTED as retry", () => {
    expect(classifyCompletionResult({ ok: false, reason: "UNEXPECTED" })).toBe("retry");
  });

  it.each([
    "NOT_FOUND", "INVALID_STATE", "OVER_PLANNED", "LINE_MISMATCH", "INVALID_QTY", "NO_LINES",
    "NOT_CARRIER", "MISSING_PROOF", "MISSING_NOTA_PHOTO", "MISSING_SIGNED_BY", "KONSI_NOT_RESERVED", "KONSI_PESANAN_LAMA", "NO_INVENTORY_ROW", "MISSING_GPS",
    "STORE_NOT_GEOCODED", "GPS_OUT_OF_RADIUS", "MISSING_DATES", "MISSING_CARRIER", "MISSING_RESI",
    "OVER_DELIVER", "INSUFFICIENT_STOCK", "INVALID_DATES", "SHIPMENT_IN_FLIGHT", "REPLAY_MISMATCH", "RESERVATION_MISMATCH", "INVALID_REQUEST",
    "ALREADY_RECEIVED", "INVALID_WEIGHT", "CONSUME_RECORD_MISSING", "LINE_UNACCOUNTED", "DICATAT_SPG", "POD_KOSONG", "TERIMA_GAGAL",
    "INVALID_CARRIER", "REASON_REQUIRED", "RECEIVABLE_PAID", "RECEIVABLE_IN_USE", "RETURN_PRICED", "INDEN_BELUM_RILIS",
    "NOMOR_NOTA_DIPAKAI", "MISSING_WEIGHT", "MISSING_HANDOVER_PHOTO",
  ])("classifies %s as terminal", (reason) => {
    expect(classifyCompletionResult({ ok: false, reason })).toBe("terminal");
  });

  it("treats EVERY shipment and delivery refusal code as terminal, so a new code can never loop the queue", () => {
    const kode = [
      ...anggotaUnion("../../delivery/errors.ts", "DeliveryShipmentErrorCode"),
      ...anggotaUnion("../../field-sales/errors.ts", "DeliveryErrorCode"),
      "INVALID_REQUEST",
    ];
    expect(kode.length).toBeGreaterThan(40);
    const bukanTerminal = kode.filter((reason) => classifyCompletionResult({ ok: false, reason }) !== "terminal");
    expect(bukanTerminal).toEqual([]);
  });

  it("classifies an unrecognized reason as retry (fail open toward retry, never silently discard)", () => {
    expect(classifyCompletionResult({ ok: false, reason: "SOME_FUTURE_CODE" })).toBe("retry");
  });
});
