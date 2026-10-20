import { buildCatalogDrafts } from "./map-catalog";

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
