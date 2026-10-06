import { fetchItemGroups } from "./fetch-item-groups";

function group(itemGroupId: number) {
  return { item_group_id: itemGroupId, item_name: `G${itemGroupId}`, variants: [] };
}

/* A full page of 200 filler groups, so the pager has to ask for the next one. */
function fillerPage(startGroupId: number) {
  return Array.from({ length: 200 }, (_, i) => group(startGroupId + i));
}

describe("fetchItemGroups", () => {
  let http: { get: jest.Mock };
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    http = { get: jest.fn() };
    logger = { warn: jest.fn() };
  });

  it("concatenates pages until a short page", async () => {
    http.get
      .mockResolvedValueOnce({ data: fillerPage(1), totalCount: 201 })
      .mockResolvedValueOnce({ data: [group(500)], totalCount: 201 });

    const result = await fetchItemGroups(http, logger);

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get).toHaveBeenNthCalledWith(1, "/inventory/items/", { query: { page: 1, pageSize: 200 } });
    expect(http.get).toHaveBeenNthCalledWith(2, "/inventory/items/", { query: { page: 2, pageSize: 200 } });
    expect(result.data).toHaveLength(201);
    expect(result.totalCount).toBe(201);
  });

  it("stops and warns when a page repeats the previous one", async () => {
    http.get.mockResolvedValue({ data: fillerPage(1) });

    const result = await fetchItemGroups(http, logger);

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("returned the same page again at page 2"));
    expect(result.data).toHaveLength(200);
  });

  it("stops after one page when every stopWhenSeen id is on it, even if totalCount says more", async () => {
    http.get.mockResolvedValue({ data: fillerPage(1), totalCount: 5000 });

    const result = await fetchItemGroups(http, logger, { stopWhenSeen: new Set([7]) });

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(200);
  });

  it("pages to the end when a stopWhenSeen id never appears", async () => {
    http.get
      .mockResolvedValueOnce({ data: fillerPage(1), totalCount: 201 })
      .mockResolvedValueOnce({ data: [group(500)], totalCount: 201 });

    const result = await fetchItemGroups(http, logger, { stopWhenSeen: new Set([999_999]) });

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(result.data).toHaveLength(201);
  });
});
