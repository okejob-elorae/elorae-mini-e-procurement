import { Test } from "@nestjs/testing";
import { JubelioLocationsService } from "./locations.service";
import { JubelioHttpService } from "../http.service";

const KUTABUMI = {
  location_id: 3,
  location_name: "Kutabumi",
  location_code: "KTB",
  is_pos_outlet: false,
  city: "Tangerang",
  address: "Jl. Raya Kutabumi Ruko Pondok Permai blok CA 1 no 6",
  phone: "215442490",
  email: "kutabumi.warehouse@example.com",
};

function page(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    location_id: offset + i + 1,
    location_name: `Loc ${offset + i + 1}`,
  }));
}

describe("JubelioLocationsService", () => {
  let svc: JubelioLocationsService;
  let http: { get: jest.Mock };

  beforeEach(async () => {
    http = { get: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioLocationsService,
        { provide: JubelioHttpService, useValue: http },
      ],
    }).compile();
    svc = mod.get(JubelioLocationsService);
  });

  it("requests the documented path and keeps the body out of the call log", async () => {
    http.get.mockResolvedValue({ data: [] });

    await svc.list();

    expect(http.get).toHaveBeenCalledWith("/locations/", {
      query: { page: 1, pageSize: 200 },
      redactResponseBody: true,
    });
  });

  /**
   * Shaping the return value is not enough on its own: JubelioHttpService logs
   * the RAW body into JubelioApiCall before any mapping runs, so without the
   * redact flag the address/phone/email would be persisted regardless.
   */
  it("sets redactResponseBody on every page it fetches", async () => {
    http.get
      .mockResolvedValueOnce({ data: page(200), totalCount: 250 })
      .mockResolvedValueOnce({ data: page(50), totalCount: 250 });

    await svc.list();

    expect(http.get).toHaveBeenCalledTimes(2);
    for (const call of http.get.mock.calls) {
      expect(call[1].redactResponseBody).toBe(true);
    }
  });

  it("follows pagination until totalCount is satisfied", async () => {
    http.get
      .mockResolvedValueOnce({ data: page(200), totalCount: 250 })
      .mockResolvedValueOnce({ data: page(50, 200), totalCount: 250 });

    const result = await svc.list();

    expect(result.locations).toHaveLength(250);
    expect(http.get.mock.calls[1][1].query).toEqual({ page: 2, pageSize: 200 });
  });

  it("stops on a short page without asking for another", async () => {
    http.get.mockResolvedValue({ data: page(3), totalCount: 3 });

    await svc.list();

    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("drops rows with no usable location_id rather than emitting id: undefined", async () => {
    http.get.mockResolvedValue({
      data: [{ location_name: "No id here" }, KUTABUMI],
      totalCount: 2,
    });

    const result = await svc.list();

    expect(result.locations).toHaveLength(1);
    expect(result.locations[0]?.id).toBe(3);
  });

  it("accepts a numeric-string location_id, which the spec also documents", async () => {
    http.get.mockResolvedValue({ data: [{ location_id: "7" }], totalCount: 1 });

    const result = await svc.list();

    expect(result.locations[0]?.id).toBe(7);
  });

  it("maps the identifying fields out of the documented envelope", async () => {
    http.get.mockResolvedValue({ data: [KUTABUMI], totalCount: 1 });

    const result = await svc.list();

    expect(result.locations).toEqual([
      { id: 3, name: "Kutabumi", code: "KTB", isPosOutlet: false, city: "Tangerang" },
    ]);
  });

  /**
   * The address, phone and email Jubelio sends back are business contact details
   * with no caller that needs them, so the mapping must not relay them.
   */
  it("drops address, phone and email rather than relaying them", async () => {
    http.get.mockResolvedValue({ data: [KUTABUMI], totalCount: 1 });

    const result = await svc.list();

    const row = result.locations[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["city", "code", "id", "isPosOutlet", "name"]);
    expect(row.address).toBeUndefined();
    expect(row.phone).toBeUndefined();
    expect(row.email).toBeUndefined();
  });

  it("accepts a bare array, since the spec lags this API elsewhere", async () => {
    http.get.mockResolvedValue([KUTABUMI]);

    const result = await svc.list();

    expect(result.locations).toHaveLength(1);
    expect(result.locations[0]?.id).toBe(3);
  });

  it("normalises missing optional fields rather than emitting undefined", async () => {
    http.get.mockResolvedValue({ data: [{ location_id: -1 }], totalCount: 1 });

    const result = await svc.list();

    expect(result.locations[0]).toEqual({
      id: -1,
      name: null,
      code: null,
      isPosOutlet: false,
      city: null,
    });
  });

  it.each([null, undefined, {}, { data: null }, "boom", 42])(
    "returns an empty list on the unusable response %p",
    async (raw) => {
      http.get.mockResolvedValue(raw);

      const result = await svc.list();

      expect(result.locations).toEqual([]);
    },
  );
});
