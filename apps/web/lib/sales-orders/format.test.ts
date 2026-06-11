import { describe, it, expect } from "vitest";
import { formatIDR, formatDateTime } from "./format";

describe("formatIDR", () => {
  it("formats a numeric string as Rp with thousand separators, no decimals", () => {
    // Indonesian locale outputs "Rp" + non-breaking space (U+00A0) + digits; match with \s
    expect(formatIDR("100000")).toMatch(/^Rp\s*100\.000$/);
    expect(formatIDR("1000000")).toMatch(/^Rp\s*1\.000\.000$/);
  });

  it("handles zero", () => {
    expect(formatIDR("0")).toMatch(/^Rp\s*0$/);
  });

  it("handles empty / null fallback as Rp 0", () => {
    expect(formatIDR("")).toMatch(/^Rp\s*0$/);
    expect(formatIDR(null)).toMatch(/^Rp\s*0$/);
    expect(formatIDR(undefined)).toMatch(/^Rp\s*0$/);
  });

  it("accepts a number as well as a string", () => {
    expect(formatIDR(50000)).toMatch(/^Rp\s*50\.000$/);
  });
});

describe("formatDateTime", () => {
  it("renders a Date as 'dd MMM yyyy, HH:mm' in the en-GB locale", () => {
    const d = new Date("2026-06-11T10:30:00.000Z");
    const out = formatDateTime(d, "en-GB");
    expect(out).toMatch(/11 Jun 2026/);
    expect(out).toMatch(/10:30|17:30/);
  });

  it("renders id-ID locale with Indonesian month names", () => {
    const d = new Date("2026-06-11T10:30:00.000Z");
    const out = formatDateTime(d, "id-ID");
    expect(out).toMatch(/Jun|Juni/);
    expect(out).toMatch(/2026/);
  });
});
