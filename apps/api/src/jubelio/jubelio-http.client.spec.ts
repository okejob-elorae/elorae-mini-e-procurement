import { Test } from "@nestjs/testing";
import { JubelioHttpClient } from "./jubelio-http.client";
import { JubelioHttpService } from "./http.service";

describe("JubelioHttpClient", () => {
  let client: JubelioHttpClient;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    http = { get: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        JubelioHttpClient,
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();

    client = mod.get(JubelioHttpClient);
  });

  describe("getSalesReturn", () => {
    it("GETs /sales-returns/:id and returns the JSON body", async () => {
      http.get.mockResolvedValue({ return_id: 7, return_no: "SR-000000007", items: [] });

      const result = await client.getSalesReturn(7);

      expect(result).toEqual(expect.objectContaining({ return_id: 7 }));
      expect(http.get).toHaveBeenCalledWith("/sales-returns/7");
    });

    it("forwards the full detail payload including items array", async () => {
      const detail = {
        return_id: 42,
        return_no: "SR-000000042",
        source_name: "Shop | Tokopedia",
        customer_name: "Jane",
        items: [
          {
            return_detail_id: 11,
            item_code: "SKU-A",
            item_name: "Product A",
            qty_in_base: "2.0000",
          },
        ],
      };
      http.get.mockResolvedValue(detail);

      const result = await client.getSalesReturn(42);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].item_code).toBe("SKU-A");
    });
  });

  describe("listUnprocessedReturns", () => {
    it("GETs /sales-returns/unprocessed and unwraps the data array", async () => {
      http.get.mockResolvedValue({
        data: [
          { salesorder_id: 100, item_code: "SKU-A", item_name: "A", qty_in_base: "1.0000" },
          { salesorder_id: 101, item_code: "SKU-B", item_name: "B", qty_in_base: "2.0000" },
        ],
        totalCount: 2,
      });

      const result = await client.listUnprocessedReturns();

      expect(result).toHaveLength(2);
      expect(result[0].item_code).toBe("SKU-A");
      expect(http.get).toHaveBeenCalledWith("/sales-returns/unprocessed");
    });

    it("returns [] when data is missing from response", async () => {
      http.get.mockResolvedValue({});

      const result = await client.listUnprocessedReturns();

      expect(result).toEqual([]);
    });

    it("returns [] when data is an empty array", async () => {
      http.get.mockResolvedValue({ data: [], totalCount: 0 });

      const result = await client.listUnprocessedReturns();

      expect(result).toEqual([]);
    });
  });
});
