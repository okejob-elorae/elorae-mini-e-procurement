import { describe, expect, it } from "vitest";
import { prisma } from "@elorae/db";
import { getPantoneFilterFacetCounts, listPantoneColors } from "./queries";

/*
 * Cip rona "Hitam"/"Putih" di /backoffice/production/colors: hitungan cip dan
 * hasil saringan memakai aturan yang sama (tag tersimpan ∪ L*a*b*). Hanya
 * membaca katalog Pantone yang sudah di-seed.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

d("saringan rona hitam & putih (test bed only)", () => {
  it("hitungan cip = jumlah hasil saringan; Jet Black ada di Hitam, Bright White di Putih", async () => {
    const adaKatalog = (await prisma.pantoneColor.count()) > 0;
    if (!adaKatalog) return;
    const cip = await getPantoneFilterFacetCounts();
    const hitam = await listPantoneColors({ hue: ["Black"] }, { page: 1, pageSize: 200 });
    const putih = await listPantoneColors({ hue: ["White"] }, { page: 1, pageSize: 200 });
    expect(cip.hue.Black).toBe(hitam.totalCount);
    expect(cip.hue.White).toBe(putih.totalCount);
    expect(hitam.totalCount).toBeGreaterThan(10);
    expect(hitam.colors.map((c) => c.name)).toContain("Jet Black");
    expect(putih.colors.map((c) => c.name)).toContain("Bright White");
  });
});
