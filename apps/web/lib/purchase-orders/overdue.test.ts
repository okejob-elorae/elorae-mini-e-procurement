import { describe, expect, it } from "vitest";
import { overduePOWhere, parsePOStatusFilter, STATUS_PO_BISA_TERLAMBAT } from "./overdue";

describe("overduePOWhere", () => {
  it("membandingkan dengan awal hari ini WIB, jadi PO yang tiba hari ini belum terlambat", () => {
    const w = overduePOWhere(new Date("2026-10-01T05:00:00Z")); // 1 Okt 12.00 WIB
    expect(w.etaDate.lt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    const etaHariIni = new Date("2026-10-01T00:00:00+07:00");
    expect(etaHariIni < w.etaDate.lt).toBe(false);
    const etaKemarin = new Date("2026-09-30T00:00:00+07:00");
    expect(etaKemarin < w.etaDate.lt).toBe(true);
  });

  it("hanya PO yang sudah di tangan pemasok dan belum lengkap — tidak pernah DRAFT", () => {
    const w = overduePOWhere();
    expect(w.status.in).toEqual(["SUBMITTED", "PARTIAL"]);
    expect(STATUS_PO_BISA_TERLAMBAT).not.toContain("DRAFT");
    for (const selesai of ["CLOSED", "OVER", "CANCELLED"]) {
      expect(w.status.in).not.toContain(selesai);
    }
  });
});

describe("parsePOStatusFilter", () => {
  it("menerima status PO dan saringan overdue, menolak yang lain", () => {
    expect(parsePOStatusFilter("overdue")).toBe("overdue");
    expect(parsePOStatusFilter("SUBMITTED")).toBe("SUBMITTED");
    expect(parsePOStatusFilter("submitted")).toBe("");
    expect(parsePOStatusFilter("APPROVED")).toBe("");
    expect(parsePOStatusFilter(undefined)).toBe("");
    expect(parsePOStatusFilter(null)).toBe("");
  });
});
