import { describe, expect, it } from "vitest";
import { RETUR_PEMBELI_BERLAKU, RETUR_PEMBELI_MENUNGGU, returPembeliBerlaku } from "./retur-pembeli-berlaku";
import { returPembeliBerlaku as returPembeliBerlakuKonstanta } from "./retur-pembeli";

/** Satu definisi "retur pembeli yang berlaku" — tidak bisa ditimpa pemanggil. Tanpa basis data. */
describe("returPembeliBerlaku", () => {
  it("is the approved status, and the pending fragment is its own thing", () => {
    expect(RETUR_PEMBELI_BERLAKU).toEqual({ status: "DISETUJUI" });
    expect(RETUR_PEMBELI_MENUNGGU).toEqual({ status: "MENUNGGU" });
  });

  it("keeps the caller's filters and adds the approved status", () => {
    const awal = new Date("2026-10-01T00:00:00+07:00");
    expect(returPembeliBerlaku({ storeId: "s1", createdAt: { gte: awal } })).toEqual({ storeId: "s1", createdAt: { gte: awal }, status: "DISETUJUI" });
    expect(returPembeliBerlaku()).toEqual({ status: "DISETUJUI" });
  });

  it("forces DISETUJUI even when the caller passes another status", () => {
    expect(returPembeliBerlaku({ status: "MENUNGGU", storeId: "s1" })).toEqual({ storeId: "s1", status: "DISETUJUI" });
    expect(returPembeliBerlaku({ status: { in: ["MENUNGGU", "DITOLAK"] } })).toEqual({ status: "DISETUJUI" });
  });

  it("the constant form exported for spreading loaders is the same fragment", () => {
    expect(returPembeliBerlakuKonstanta).toEqual({ status: "DISETUJUI" });
    expect({ storeId: "s1", ...returPembeliBerlakuKonstanta }).toEqual({ storeId: "s1", status: "DISETUJUI" });
  });
});
