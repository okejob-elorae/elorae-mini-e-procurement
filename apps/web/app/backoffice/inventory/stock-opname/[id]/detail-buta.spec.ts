import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Layar opname gudang mengikuti muatan buta dari `getOpnameById`: tabel dengan
// snapshot/selisih hanya saat angka sistem boleh tampil, selain itu tabel buta.
// Penjaga sumber — tes muatan aksinya ada di app/actions/stock-opname-buta.spec.ts.

const baca = (...p: string[]) => readFileSync(path.join(__dirname, ...p), "utf8");

describe("layar opname gudang buta", () => {
  it("the detail page shows the snapshot/variance table only when the payload says the figures may show", () => {
    const sumber = baca("StockOpnameDetailClient.tsx");
    expect(sumber).toContain("opname?.angkaSistemTampil === true");
    expect(sumber).toMatch(/tampil \? \(\s*<OpnameDetailReviewTable/);
    expect(sumber).toContain("<TabelHitunganButa");
    // Kartu "ada selisih" juga ikut tersembunyi.
    expect(sumber).toMatch(/tampil \? <StatCard label=\{t\("statVariance"\)\}/);
  });

  it("the blind review table has no system-figure column at all", () => {
    const sumber = baca("TabelHitunganButa.tsx");
    expect(sumber).not.toMatch(/snapshot|variance/i);
  });

  it("the counting screen closes once the count is submitted, and never shows system figures", () => {
    const sumber = baca("count", "StockOpnameCountPageClient.tsx");
    expect(sumber).toContain("masihMenghitung(String(opname.status))");
    expect(sumber).not.toMatch(/snapshotQty|snapshotLength|variance/);
  });
});
