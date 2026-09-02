import { JubelioError } from "../../jubelio.types";
import { isAlreadyInStateError } from "./already-in-state";

/**
 * Verbatim body Jubelio returned on prod 2026-09-01 when the pack push raced a
 * Shopee order the channel had already moved to READY_TO_SHIP (salesorder 47180).
 */
const PROD_PACK_CONFLICT_BODY = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "An internal server error occurred",
  code:
    "error: Pesanan sudah dipakai di transaksi lain. Pesanan: SP-260901V8CUMUTR, " +
    "Status Channel: READY_TO_SHIP, Status Sekarang: PAID, Status Dituju: FINISH_PACK",
};

describe("isAlreadyInStateError", () => {
  it("detects the observed prod conflict, whose marker lives on cause.code", () => {
    const err = new JubelioError(
      "An internal server error occurred",
      500,
      PROD_PACK_CONFLICT_BODY,
    );
    expect(isAlreadyInStateError(err)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const err = new JubelioError("boom", 500, {
      code: "ERROR: PESANAN SUDAH DIPAKAI DI TRANSAKSI LAIN.",
    });
    expect(isAlreadyInStateError(err)).toBe(true);
  });

  it("reads the marker from cause.message as well as cause.code", () => {
    const err = new JubelioError("boom", 500, {
      message: "Pesanan sudah dipakai di transaksi lain.",
    });
    expect(isAlreadyInStateError(err)).toBe(true);
  });

  it("reads the marker from the error's own message", () => {
    const err = new JubelioError("Pesanan sudah dipakai di transaksi lain.", 500);
    expect(isAlreadyInStateError(err)).toBe(true);
  });

  it("tolerates a non-JSON body, which parse() stores as a raw string", () => {
    const err = new JubelioError("boom", 500, "Pesanan sudah dipakai di transaksi lain.");
    expect(isAlreadyInStateError(err)).toBe(true);
  });

  it("rejects an unrelated 500 so it still retries", () => {
    const err = new JubelioError("An internal server error occurred", 500, {
      statusCode: 500,
      code: "error: connection reset by peer",
    });
    expect(isAlreadyInStateError(err)).toBe(false);
  });

  it("rejects the pick validation 400, which is our payload being wrong", () => {
    const err = new JubelioError(
      'child "picklist_no" fails because ["picklist_no" is required]',
      400,
      { statusCode: 400, error: "Bad Request", validation: { keys: ["picklist_no"] } },
    );
    expect(isAlreadyInStateError(err)).toBe(false);
  });

  it("no longer honours the invented err.code marker nothing ever set", () => {
    const err = Object.assign(new Error("already packed"), { code: "ALREADY_IN_STATE" });
    expect(isAlreadyInStateError(err)).toBe(false);
  });

  it.each([null, undefined, "boom", 42, {}])("rejects the non-error %p", (input) => {
    expect(isAlreadyInStateError(input)).toBe(false);
  });
});
