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

  describe("getSalesOrder", () => {
    it("GETs /sales/orders/:id and returns the JSON body", async () => {
      http.get.mockResolvedValue({ salesorder_id: 7, salesorder_no: "SP-7", items: [] });

      const result = await client.getSalesOrder(7);

      expect(result).toEqual(expect.objectContaining({ salesorder_id: 7 }));
      expect(http.get).toHaveBeenCalledWith("/sales/orders/7");
    });

    it("forwards the full detail payload including items array", async () => {
      const detail = {
        salesorder_id: 42,
        salesorder_no: "TT-42",
        source_name: "Shop | Tokopedia",
        customer_name: "Jane",
        internal_status: "RETURNED",
        items: [
          {
            salesorder_detail_id: 11,
            item_code: "SKU-A",
            item_name: "Product A",
            qty_in_base: "2.0000",
            is_return_resolved: null,
            reject_return_reason: null,
          },
        ],
      };
      http.get.mockResolvedValue(detail);

      const result = await client.getSalesOrder(42);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].item_code).toBe("SKU-A");
    });
  });

  describe("listReturnedOrders", () => {
    it("GETs /sales/orders/returned-list/ with paging and unwraps the data array", async () => {
      http.get.mockResolvedValue({
        data: [
          { salesorder_id: 100, salesorder_no: "SP-100", status: "To Return" },
          { salesorder_id: 101, salesorder_no: "TT-101", status: "Order Return" },
        ],
        totalCount: 2,
      });

      const result = await client.listReturnedOrders(1, 100);

      expect(result).toHaveLength(2);
      expect(result[0].salesorder_id).toBe(100);
      expect(http.get).toHaveBeenCalledWith("/sales/orders/returned-list/?page=1&pageSize=100");
    });

    it("returns [] when data is missing from response", async () => {
      http.get.mockResolvedValue({});

      const result = await client.listReturnedOrders();

      expect(result).toEqual([]);
    });

    it("returns [] when data is an empty array", async () => {
      http.get.mockResolvedValue({ data: [], totalCount: 0 });

      const result = await client.listReturnedOrders();

      expect(result).toEqual([]);
    });

    it("uses default page=1 and pageSize=100 when not specified", async () => {
      http.get.mockResolvedValue({ data: [], totalCount: 0 });

      await client.listReturnedOrders();

      expect(http.get).toHaveBeenCalledWith("/sales/orders/returned-list/?page=1&pageSize=100");
    });
  });

  describe("listOrders (general, all-status)", () => {
    it("GETs /sales/orders/ with q + paging and unwraps data", async () => {
      http.get.mockResolvedValue({ data: [{ salesorder_id: 5, salesorder_no: "SP-5" }] });

      const result = await client.listOrders("SP-5");

      expect(result).toEqual([{ salesorder_id: 5, salesorder_no: "SP-5" }]);
      expect(http.get).toHaveBeenCalledWith("/sales/orders/?q=SP-5&page=1&pageSize=20");
    });

    it("returns [] when data is missing", async () => {
      http.get.mockResolvedValue({});
      expect(await client.listOrders("x")).toEqual([]);
    });
  });

  describe("listCompletedOrders / listCancelledOrders / listFailedOrders", () => {
    it("GETs /sales/orders/completed/ with q + paging and unwraps data", async () => {
      http.get.mockResolvedValue({ data: [{ salesorder_id: 1, salesorder_no: "SP-1" }] });

      const result = await client.listCompletedOrders("SP-1");

      expect(result).toEqual([{ salesorder_id: 1, salesorder_no: "SP-1" }]);
      expect(http.get).toHaveBeenCalledWith("/sales/orders/completed/?q=SP-1&page=1&pageSize=20");
    });

    it("GETs /sales/orders/cancel/ with q + paging", async () => {
      http.get.mockResolvedValue({ data: [] });

      await client.listCancelledOrders("SP-2");

      expect(http.get).toHaveBeenCalledWith("/sales/orders/cancel/?q=SP-2&page=1&pageSize=20");
    });

    it("GETs /sales/orders/failed/ with q + paging", async () => {
      http.get.mockResolvedValue({ data: [] });

      await client.listFailedOrders("SP-3");

      expect(http.get).toHaveBeenCalledWith("/sales/orders/failed/?q=SP-3&page=1&pageSize=20");
    });

    it("returns [] when data is missing", async () => {
      http.get.mockResolvedValue({});
      expect(await client.listCompletedOrders("x")).toEqual([]);
    });
  });

  describe("findSalesOrderIdByNo", () => {
    it("resolves from the general list first (single call, no bucket fallback)", async () => {
      http.get.mockResolvedValueOnce({ data: [{ salesorder_id: 7, salesorder_no: "SP-7" }] });

      const id = await client.findSalesOrderIdByNo("SP-7");

      expect(id).toBe(7);
      // Only the general /sales/orders/?q= list is hit; buckets never queried.
      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get).toHaveBeenCalledWith("/sales/orders/?q=SP-7&page=1&pageSize=20");
    });

    it("resolves an in-flight order via the general list that the buckets would miss", async () => {
      // The whole point of the swap: an order not in completed/cancel/failed
      // (still being picked/shipped at settlement time) is found by the general list.
      http.get.mockResolvedValueOnce({ data: [{ salesorder_id: 26859, salesorder_no: "SP-26062630P1QHU7" }] });

      const id = await client.findSalesOrderIdByNo("SP-26062630P1QHU7");

      expect(id).toBe(26859);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("falls back to completed when the general list misses", async () => {
      http.get
        .mockResolvedValueOnce({ data: [] }) // general
        .mockResolvedValueOnce({ data: [{ salesorder_id: 8, salesorder_no: "SP-8" }] }); // completed

      const id = await client.findSalesOrderIdByNo("SP-8");

      expect(id).toBe(8);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("falls back through general → completed → cancelled → failed", async () => {
      http.get
        .mockResolvedValueOnce({ data: [] }) // general
        .mockResolvedValueOnce({ data: [] }) // completed
        .mockResolvedValueOnce({ data: [] }) // cancelled
        .mockResolvedValueOnce({ data: [{ salesorder_id: 9, salesorder_no: "SP-9" }] }); // failed

      const id = await client.findSalesOrderIdByNo("SP-9");

      expect(id).toBe(9);
      expect(http.get).toHaveBeenCalledTimes(4);
    });

    it("returns null when not found in any list (all four tiers queried)", async () => {
      http.get.mockResolvedValue({ data: [] });

      const id = await client.findSalesOrderIdByNo("SP-missing");

      expect(id).toBeNull();
      expect(http.get).toHaveBeenCalledTimes(4);
    });

    it("ignores a fuzzy q match that isn't the exact salesorder_no across all tiers", async () => {
      http.get
        .mockResolvedValueOnce({ data: [{ salesorder_id: 1, salesorder_no: "SP-100" }] }) // fuzzy hit on general
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      const id = await client.findSalesOrderIdByNo("SP-10");

      expect(id).toBeNull();
      expect(http.get).toHaveBeenCalledTimes(4);
    });
  });
});
