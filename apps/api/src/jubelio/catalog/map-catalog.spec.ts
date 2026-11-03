import { buildCatalogDrafts, readCatalogVariant, summarizeGroupsPrice, summarizeJubelioPrices } from "./map-catalog";
import type { JubelioItemsPayload } from "./catalog.types";

describe("buildCatalogDrafts variant axes (#437)", () => {
  it("folds Jubelio colour/size labels onto Warna and Ukuran", () => {
    const { drafts } = buildCatalogDrafts({
      data: [
        {
          item_group_id: 7,
          item_name: "Cargo Pants",
          variants: [
            {
              item_group_id: 7,
              item_id: 1,
              item_code: "27000015P-L",
              variation_values: [
                { label: "color", value: "Khaki" },
                { label: "Size", value: "L" },
              ],
            },
            {
              item_group_id: 7,
              item_id: 2,
              item_code: "27000015P-S",
              variation_values: [
                { label: "Warna", value: "Khaki" },
                { label: "Ukuran", value: "S" },
              ],
            },
          ],
        },
      ],
    });
    expect(drafts[0].variants).toEqual([
      { sku: "27000015P-L", Warna: "Khaki", Ukuran: "L" },
      { sku: "27000015P-S", Warna: "Khaki", Ukuran: "S" },
    ]);
  });
});

/*
 * Owner answer P1 (2026-11-02): one price per article; when Jubelio's variants differ, the HIGHEST
 * is the Jubelio price. A missing figure is unknown, never 0 (Jubelio landmine).
 */
describe("summarizeJubelioPrices", () => {
  it("takes the highest and the lowest variant price", () => {
    expect(summarizeJubelioPrices([{ sell_price: 100000 }, { sell_price: "110000" }], "90000")).toEqual({
      highest: "110000",
      lowest: "100000",
    });
  });

  it("falls back to the group price for both when no variant price is known", () => {
    expect(summarizeJubelioPrices([{}, { sell_price: null }, { sell_price: "" }], "150000")).toEqual({
      highest: "150000",
      lowest: "150000",
    });
  });

  it("a variant explicitly at 0 among priced ones makes the lowest 0", () => {
    expect(summarizeJubelioPrices([{ sell_price: 110000 }, { sell_price: 0 }], undefined)).toEqual({
      highest: "110000",
      lowest: "0",
    });
  });

  it("a variant with its sell_price missing among priced ones is skipped, not read as 0", () => {
    expect(summarizeJubelioPrices([{ sell_price: 110000 }, {}, { sell_price: "abc" }], undefined)).toEqual({
      highest: "110000",
      lowest: "110000",
    });
  });

  it("knows nothing when no variant and no group price is readable", () => {
    expect(summarizeJubelioPrices([{}, { sell_price: null }], undefined)).toBeNull();
    expect(summarizeJubelioPrices([], "")).toBeNull();
  });

  it("has no highest price when none is positive", () => {
    expect(summarizeJubelioPrices([{ sell_price: 0 }, { sell_price: -1 }], "150000")).toEqual({ highest: null, lowest: "0" });
  });

  it("buildCatalogDrafts carries the highest as sellingPrice, plus the lowest", () => {
    const { drafts } = buildCatalogDrafts({
      data: [
        {
          item_group_id: 9,
          item_name: "Kaos",
          sell_price: "90000",
          variants: [
            { item_group_id: 9, item_id: 11, item_code: "28000001K-S", sell_price: 100000 },
            { item_group_id: 9, item_id: 12, item_code: "28000001K-L", sell_price: 110000 },
          ],
        },
      ],
    });
    expect(drafts[0]).toMatchObject({ sellingPrice: "110000", lowestPrice: "100000", priceKnown: true });
  });
});

/*
 * The ingest, the price observer and the product push's read-before-write read the same variants
 * (bundles, empty or unparseable item codes skipped, one row per item_id, last listing winning), so
 * one unchanged Jubelio product records the same figures whoever reads it — otherwise
 * jubelioObservedChangedAt would move on every alternate read and the item would be held forever.
 */
describe("summarizeGroupsPrice / readCatalogVariant (one variant rule)", () => {
  const payload: JubelioItemsPayload = {
    data: [
      {
        item_group_id: 9,
        item_name: "Kaos",
        sell_price: "90000",
        variants: [
          { item_group_id: 9, item_id: 11, item_code: "28000001K-S", sell_price: 100000 },
          { item_group_id: 9, item_id: 12, item_code: "28000001K-L", sell_price: 120000 },
          { item_group_id: 9, item_id: 13, item_code: "28000001K-PAKET", is_bundle: true, sell_price: 999999 },
          { item_group_id: 9, item_id: 14, item_code: "   ", sell_price: 1 },
          { item_group_id: 9, item_id: 15, item_code: "-X", sell_price: 2 },
        ],
      },
      {
        item_group_id: 9,
        item_name: "Kaos",
        sell_price: "80000",
        variants: [{ item_group_id: 9, item_id: 12, item_code: "28000001K-L", sell_price: 110000 }],
      },
      { item_group_id: 10, item_name: "Hanya paket", variants: [{ item_group_id: 10, item_id: 20, item_code: "P-1", is_bundle: true, sell_price: 5 }] },
    ],
  };

  it("skips bundles and unreadable item codes, with the ingest's own warnings", () => {
    expect(readCatalogVariant({ item_group_id: 9, item_id: 13, item_code: "X-1", is_bundle: true }, 9)).toEqual({
      ok: false,
      warning: "Skipped bundle variant X-1 (group 9)",
    });
    expect(readCatalogVariant({ item_group_id: 9, item_id: 14, item_code: " " }, 9)).toEqual({ ok: false, warning: "Empty item_code in group 9" });
    expect(readCatalogVariant({ item_group_id: 9, item_id: 15, item_code: "-X" }, 9)).toEqual({ ok: false, warning: "Could not derive parent SKU for -X" });
    expect(readCatalogVariant({ item_group_id: 9, item_id: 11, item_code: " 28000001K-S " }, 9)).toEqual({ ok: true, code: "28000001K-S", family: "280000" });
  });

  it("equals the price buildCatalogDrafts puts on the group's draft", () => {
    const { drafts } = buildCatalogDrafts(payload);
    const draft = drafts.find((d) => d.jubelioItemGroupId === 9)!;
    const price = summarizeGroupsPrice(payload.data, new Set([9]));
    expect(price).toEqual({ highest: "110000", lowest: "100000" });
    expect({ highest: draft.sellingPrice, lowest: draft.lowestPrice }).toEqual(price);
  });

  it("records nothing for a group the ingest builds no item for, or one Jubelio no longer lists", () => {
    expect(buildCatalogDrafts(payload).drafts.some((d) => d.jubelioItemGroupId === 10)).toBe(false);
    expect(summarizeGroupsPrice(payload.data, new Set([10]))).toBeNull();
    expect(summarizeGroupsPrice(payload.data, new Set([404]))).toBeNull();
  });
});
