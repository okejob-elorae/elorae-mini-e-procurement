import { JubelioError } from "../jubelio.types";
import {
  constraintFingerprint,
  hasFingerprint,
  withFingerprint,
} from "./constraint-fingerprint";

describe("constraintFingerprint", () => {
  it("fingerprints a 500 whose body code is an integrity-constraint SQLSTATE", () => {
    const err = new JubelioError("An internal server error occurred", 500, {
      statusCode: 500,
      message: "An internal server error occurred",
      code: "23505",
    });
    expect(constraintFingerprint(err)).toBe("500:23505");
  });

  it("returns null when the body code is free text", () => {
    const err = new JubelioError("An internal server error occurred", 500, {
      code: "Data sudah ada",
    });
    expect(constraintFingerprint(err)).toBeNull();
  });

  it("returns null for a SQLSTATE outside class 23", () => {
    const err = new JubelioError("boom", 500, { code: "42P01" });
    expect(constraintFingerprint(err)).toBeNull();
  });

  it("returns null when the cause is not an object", () => {
    expect(constraintFingerprint(new JubelioError("boom", 500, "23505"))).toBeNull();
    expect(constraintFingerprint(new JubelioError("boom", 500))).toBeNull();
  });

  it("returns null for a plain Error", () => {
    expect(constraintFingerprint(new Error("timeout"))).toBeNull();
  });
});

describe("withFingerprint / hasFingerprint", () => {
  it("round-trips a fingerprint through the message", () => {
    const message = withFingerprint("An internal server error occurred", "500:23505");
    expect(message).toBe("An internal server error occurred [constraint 500:23505]");
    expect(hasFingerprint(message, "500:23505")).toBe(true);
    expect(hasFingerprint(message, "500:23503")).toBe(false);
  });

  it("leaves the message untouched without a fingerprint", () => {
    expect(withFingerprint("timeout", null)).toBe("timeout");
  });

  it("tolerates a missing lastError", () => {
    expect(hasFingerprint(null, "500:23505")).toBe(false);
    expect(hasFingerprint(undefined, "500:23505")).toBe(false);
  });
});
