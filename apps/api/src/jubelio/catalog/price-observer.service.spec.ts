import { Logger } from "@nestjs/common";
import { recordJubelioObservedPrice } from "@elorae/db";
import { JubelioPriceObserverService } from "./price-observer.service";

jest.mock("@elorae/db", () => ({
  ...jest.requireActual("@elorae/db"),
  recordJubelioObservedPrice: jest.fn().mockResolvedValue(true),
}));

/*
 * Owner answers 2026-11-02 (P1, P2): what Jubelio shows is read on a schedule, because a price-only
 * edit in Jubelio may send no product webhook. The observer is READ-ONLY towards everything but the
 * observed columns, which it writes only through recordJubelioObservedPrice.
 */
describe("JubelioPriceObserverService", () => {
  let prisma: any;
  let http: { get: jest.Mock };
  let service: JubelioPriceObserverService;
  let warn: jest.SpyInstance;
  let firstGetAt = 0;

  const groups = [
    {
      item_group_id: 7,
      item_name: "Kaos",
      sell_price: "90000",
      variants: [
        { item_group_id: 7, item_id: 1, item_code: "A-S", sell_price: 100000 },
        { item_group_id: 7, item_id: 2, item_code: "A-L", sell_price: 110000 },
      ],
    },
    { item_group_id: 8, item_name: "Belum dipetakan", sell_price: "50000", variants: [{ item_group_id: 8, item_id: 3, item_code: "B" }] },
    { item_group_id: 9, item_name: "Tanpa harga", variants: [{ item_group_id: 9, item_id: 4, item_code: "C" }] },
    { item_group_id: 10, item_name: "Dua barang", sell_price: "60000", variants: [{ item_group_id: 10, item_id: 5, item_code: "D" }] },
  ];

  beforeEach(() => {
    firstGetAt = 0;
    prisma = {
      jubelioProductMapping: {
        findMany: jest.fn().mockResolvedValue([
          { itemId: "item-7", jubelioItemGroupId: 7 },
          { itemId: "item-7", jubelioItemGroupId: 7 },
          { itemId: "item-9", jubelioItemGroupId: 9 },
          { itemId: "item-10a", jubelioItemGroupId: 10 },
          { itemId: "item-10b", jubelioItemGroupId: 10 },
        ]),
      },
      item: { update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      itemImage: { upsert: jest.fn() },
      $executeRaw: jest.fn(),
    };
    http = {
      get: jest.fn(async () => {
        if (!firstGetAt) firstGetAt = Date.now();
        return { data: groups, totalCount: groups.length };
      }),
    };
    service = new JubelioPriceObserverService(prisma, http as any);
    jest.mocked(recordJubelioObservedPrice).mockClear().mockResolvedValue(true);
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("lists the catalog once, out of the call log, and records the highest and lowest price with the read time taken before the first GET", async () => {
    const r = await service.observe();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith("/inventory/items/", expect.objectContaining({ redactResponseBody: true }));
    expect(recordJubelioObservedPrice).toHaveBeenCalledTimes(1);
    const [client, itemId, price, readAt] = jest.mocked(recordJubelioObservedPrice).mock.calls[0];
    expect(client).toBe(prisma);
    expect(itemId).toBe("item-7");
    expect(price).toEqual({ highest: "110000", lowest: "100000" });
    expect((readAt as Date).getTime()).toBeLessThanOrEqual(firstGetAt);
    expect(r).toEqual({ groups: 4, recorded: 1, skipped: 2 });
  });

  it("skips unmapped groups, groups with no readable price and a group mapped to two items", async () => {
    await service.observe();

    const ids = jest.mocked(recordJubelioObservedPrice).mock.calls.map((c) => c[1]);
    expect(ids).not.toContain("item-9");
    expect(ids).not.toContain("item-10a");
    expect(ids).not.toContain("item-10b");
  });

  /*
   * The same variant rule as the ingest and the push's read-before-write (summarizeGroupsPrice): a
   * bundle or an unreadable item code never moves the reading, so an unchanged Jubelio product is
   * recorded with the same figures by all three and no price decision is cancelled by a read.
   */
  it("reads the variants the ingest reads: bundles, empty item codes and repeated rows do not change the figures", async () => {
    http.get.mockResolvedValueOnce({
      data: [
        {
          ...groups[0],
          variants: [
            ...groups[0].variants,
            { item_group_id: 7, item_id: 90, item_code: "A-BUNDLE", is_bundle: true, sell_price: 999999 },
            { item_group_id: 7, item_id: 91, item_code: "  ", sell_price: 1 },
          ],
        },
        { ...groups[0], variants: [{ item_group_id: 7, item_id: 2, item_code: "A-L", sell_price: 110000 }] },
      ],
      totalCount: 2,
    });

    await service.observe();

    expect(recordJubelioObservedPrice).toHaveBeenCalledTimes(1);
    expect(jest.mocked(recordJubelioObservedPrice).mock.calls[0][2]).toEqual({ highest: "110000", lowest: "100000" });
  });

  it("writes nothing else: no item, mapping, image or raw statement of its own", async () => {
    await service.observe();

    expect(prisma.item.update).not.toHaveBeenCalled();
    expect(prisma.item.updateMany).not.toHaveBeenCalled();
    expect(prisma.item.create).not.toHaveBeenCalled();
    expect(prisma.itemImage.upsert).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("skips an overlapping run instead of queueing it", async () => {
    let release!: () => void;
    http.get.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ data: groups, totalCount: groups.length }))),
    );
    const first = service.observe();
    const second = await service.observe();
    release();
    await first;

    expect(second).toEqual({ groups: 0, recorded: 0, skipped: 0 });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("a failed read is logged by the scheduled tick, never thrown", async () => {
    http.get.mockRejectedValueOnce(new Error("jubelio down"));
    await expect(service.tick()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
