import { describe, expect, it } from "vitest";
import { formatFaktor } from "./format-faktor";

describe("formatFaktor", () => {
  it("angka Indonesia: koma desimal, titik ribuan", () => {
    expect(formatFaktor(25)).toBe("25");
    expect(formatFaktor(0.9144)).toBe("0,9144");
    expect(formatFaktor(1000)).toBe("1.000");
    expect(formatFaktor("1.5")).toBe("1,5");
  });

  it("paling banyak 6 desimal, angka tidak sah tampil sebagai tanda pisah", () => {
    expect(formatFaktor(0.12345678)).toBe("0,123457");
    expect(formatFaktor("abc")).toBe("—");
  });
});
