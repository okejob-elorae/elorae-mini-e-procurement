import { describe, expect, it } from "vitest";
import { jumlahLakuPerKunci, returRusakBerbuku, tanpaBarisBuku, type GerakLaku } from "./laku-bersih";

const t = (iso: string) => new Date(iso);

describe("returRusakBerbuku", () => {
  it("retur rusak/expired atas nota yang tercatat JUAL di buku menjadi gerakan +qty bertanggal returnya", () => {
    const hasil = returRusakBerbuku(
      [{ lineId: "r1", storeId: "S", spgSaleId: "N1", itemId: "A", variantSku: "A-M", qty: 2, createdAt: t("2026-09-20T03:00:00Z") }],
      [{ refId: "N1", itemId: "A", variantSku: "A-M", qty: -3 }],
    );
    expect(hasil).toEqual([
      { lineId: "r1", storeId: "S", itemId: "A", variantSku: "A-M", qty: 2, createdAt: t("2026-09-20T03:00:00Z") },
    ]);
  });

  it("nota tanpa baris JUAL (penjualan tanpa sinyal yang tertelan opname) tidak mengurangi laku apa pun", () => {
    expect(
      returRusakBerbuku(
        [{ lineId: "r1", storeId: "S", spgSaleId: "N1", itemId: "A", variantSku: "", qty: 1, createdAt: t("2026-09-20T03:00:00Z") }],
        [{ refId: "N2", itemId: "A", variantSku: "", qty: -5 }],
      ),
    ).toEqual([]);
  });

  it("JUAL untuk barang lain atau ukuran lain di nota yang sama tidak dihitung", () => {
    expect(
      returRusakBerbuku(
        [{ lineId: "r1", storeId: "S", spgSaleId: "N1", itemId: "A", variantSku: "A-L", qty: 1, createdAt: t("2026-09-20T03:00:00Z") }],
        [
          { refId: "N1", itemId: "A", variantSku: "A-M", qty: -2 },
          { refId: "N1", itemId: "B", variantSku: "A-L", qty: -2 },
        ],
      ),
    ).toEqual([]);
  });

  it("dibatasi jumlah JUAL nota itu: yang lebih awal didahulukan", () => {
    const hasil = returRusakBerbuku(
      [
        { lineId: "r2", storeId: "S", spgSaleId: "N1", itemId: "A", variantSku: "", qty: 2, createdAt: t("2026-09-22T03:00:00Z") },
        { lineId: "r1", storeId: "S", spgSaleId: "N1", itemId: "A", variantSku: "", qty: 2, createdAt: t("2026-09-21T03:00:00Z") },
      ],
      [{ refId: "N1", itemId: "A", variantSku: "", qty: -3 }],
    );
    expect(hasil.map((h) => [h.lineId, h.qty])).toEqual([
      ["r1", 2],
      ["r2", 1],
    ]);
  });
});

describe("jumlahLakuPerKunci", () => {
  const g = (itemId: string, variantSku: string, qty: number, iso: string, storeId = "S"): GerakLaku => ({
    storeId,
    itemId,
    variantSku,
    qty,
    createdAt: t(iso),
  });

  it("menjumlahkan gerakan sejak batasnya per toko × barang × ukuran (tanda buku: JUAL negatif)", () => {
    const peta = jumlahLakuPerKunci(
      [
        g("A", "M", -3, "2026-09-25T03:00:00Z"),
        g("A", "M", 1, "2026-09-26T03:00:00Z"),
        g("A", "M", -4, "2026-08-01T03:00:00Z"),
        g("A", "L", -1, "2026-09-25T03:00:00Z"),
        g("A", "M", -2, "2026-09-25T03:00:00Z", "T"),
      ],
      t("2026-09-01T00:00:00Z"),
    );
    expect(peta.get("S")?.get("A::M")).toBe(-2);
    expect(peta.get("S")?.get("A::L")).toBe(-1);
    expect(peta.get("T")?.get("A::M")).toBe(-2);
    expect(peta.get("S")?.size).toBe(2);
  });
});

describe("tanpaBarisBuku", () => {
  const baris = (id: string, returnId: string, condition: string, itemId = "A", variantSku = "A-M") => ({ id, returnId, itemId, variantSku, condition });

  it("retur LAYAK yang disetujui tanpa baris RETUR_PEMBELI (sudah terhitung opname) ikut mengurangi laku; yang berbuku tidak", () => {
    const hasil = tanpaBarisBuku(
      [baris("l1", "R1", "LAYAK"), baris("l2", "R2", "LAYAK"), baris("l3", "R2", "RUSAK")],
      [{ refId: "R1", itemId: "A", variantSku: "A-M" }],
    );
    // R1 sudah kembali ke buku lewat RETUR_PEMBELI; R2 LAYAK dilewati buku; rusak selalu lewat.
    expect(hasil.map((b) => b.id)).toEqual(["l2", "l3"]);
  });

  it("baris buku laporan lain atau ukuran lain tidak menutupi baris ini", () => {
    const hasil = tanpaBarisBuku(
      [baris("l1", "R1", "LAYAK"), baris("l2", "R1", "LAYAK", "A", "A-L")],
      [
        { refId: "R9", itemId: "A", variantSku: "A-M" },
        { refId: "R1", itemId: "A", variantSku: "A-L" },
        { refId: null, itemId: "A", variantSku: "A-M" },
      ],
    );
    expect(hasil.map((b) => b.id)).toEqual(["l1"]);
  });

  it("varian kosong dan null dianggap sama (barang tanpa varian)", () => {
    expect(tanpaBarisBuku([baris("l1", "R1", "LAYAK", "B", "")], [{ refId: "R1", itemId: "B", variantSku: null }])).toEqual([]);
  });
});
