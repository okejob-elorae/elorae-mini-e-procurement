import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseShopeeSettlement } from "./shopee-settlement-parser";

const FIX = path.resolve(
  process.cwd(),
  "../../reference/finance/Income.sudah dilepas.id.20260601_20260630.xlsx",
);
const has = fs.existsSync(FIX);
const d = has ? describe : describe.skip;

d("parseShopeeSettlement (local fixture only)", () => {
  it("parses 4 sheets, income lines, summary total, and sums parsedNetTotal", () => {
    const res = parseShopeeSettlement(fs.readFileSync(FIX));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data;
    expect(d.seller).toContain("elorae");
    expect(d.incomeLines.length).toBeGreaterThan(50); // ~86 orders
    expect(d.summary.totalDilepas).not.toBe(0);
    // every income line has a non-empty orderNo + numeric netIncome
    expect(d.incomeLines.every((l) => l.orderNo.trim().length > 0 && Number.isFinite(l.netIncome))).toBe(true);
    // parsedNetTotal is the sum
    const sum = d.incomeLines.reduce((s, l) => s + l.netIncome, 0);
    expect(Math.round(d.parsedNetTotal)).toBe(Math.round(sum));
    expect(Array.isArray(d.sellerFeesRaw)).toBe(true);
    expect(Array.isArray(d.adjustmentsRaw)).toBe(true);
  });
});
