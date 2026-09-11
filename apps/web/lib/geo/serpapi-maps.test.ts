import { describe, it, expect } from "vitest";
import {
  mapSerpLocalResults,
  buildSerpLl,
  buildSerpMapsSearchUrl,
} from "./serpapi-maps";

const fixture = {
  local_results: [
    {
      position: 1,
      title: "Rita Mall",
      place_id: "ChIJ_test_rita",
      gps_coordinates: { latitude: -7.4245, longitude: 109.2304 },
      address: "Jl. Jend. Sudirman, Purwokerto",
      rating: 4.3,
    },
    {
      position: 2,
      title: "Missing coords",
      address: "Somewhere",
    },
    {
      title: "  ",
      gps_coordinates: { latitude: -7.1, longitude: 109.1 },
      address: "Empty title skipped",
    },
    {
      title: "Roxy Banyuwangi",
      place_id: "ChIJ_roxy",
      gps_coordinates: { latitude: "-8.2192", longitude: "114.3691" },
      address: "Banyuwangi",
      rating: "4.1",
    },
    {
      title: "Out of range",
      gps_coordinates: { latitude: 91, longitude: 0 },
      address: "Bad",
    },
    {
      title: "Extra 5",
      gps_coordinates: { latitude: -7.2, longitude: 109.2 },
      address: "A",
    },
    {
      title: "Extra 6",
      gps_coordinates: { latitude: -7.3, longitude: 109.3 },
      address: "B",
    },
  ],
};

describe("mapSerpLocalResults", () => {
  it("maps valid local_results and skips invalid rows", () => {
    const rows = mapSerpLocalResults(fixture, 5);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      title: "Rita Mall",
      address: "Jl. Jend. Sudirman, Purwokerto",
      lat: -7.4245,
      lng: 109.2304,
      placeId: "ChIJ_test_rita",
      rating: 4.3,
    });
    expect(rows[1]).toEqual({
      title: "Roxy Banyuwangi",
      address: "Banyuwangi",
      lat: -8.2192,
      lng: 114.3691,
      placeId: "ChIJ_roxy",
      rating: 4.1,
    });
  });

  it("maps place_results when local_results is absent (address/landmark search)", () => {
    const rows = mapSerpLocalResults({
      place_results: {
        title: "Merdeka Square",
        place_id: "ChIJ_monas",
        gps_coordinates: { latitude: -6.1751235, longitude: 106.8252123 },
        address: "Jl. Medan Merdeka Sel., Gambir, Jakarta Pusat",
        rating: 4.7,
      },
    });
    expect(rows).toEqual([
      {
        title: "Merdeka Square",
        address: "Jl. Medan Merdeka Sel., Gambir, Jakarta Pusat",
        lat: -6.1751235,
        lng: 106.8252123,
        placeId: "ChIJ_monas",
        rating: 4.7,
      },
    ]);
  });

  it("prefers local_results when both are present", () => {
    const rows = mapSerpLocalResults({
      local_results: [
        {
          title: "Cafe A",
          gps_coordinates: { latitude: -6.2, longitude: 106.8 },
          address: "A",
        },
      ],
      place_results: {
        title: "Ignored Place",
        gps_coordinates: { latitude: -6.1, longitude: 106.7 },
        address: "B",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Cafe A");
  });

  it("returns empty for malformed payload", () => {
    expect(mapSerpLocalResults(null)).toEqual([]);
    expect(mapSerpLocalResults({})).toEqual([]);
    expect(mapSerpLocalResults({ local_results: "nope" })).toEqual([]);
  });

  it("respects limit", () => {
    expect(mapSerpLocalResults(fixture, 1)).toHaveLength(1);
  });
});

describe("buildSerpLl", () => {
  it("uses pin zoom when coords present", () => {
    expect(buildSerpLl(-6.2, 106.8)).toBe("@-6.2,106.8,14z");
  });

  it("defaults to Jakarta overview", () => {
    expect(buildSerpLl(null, null)).toBe("@-6.2,106.8,6z");
  });
});

describe("buildSerpMapsSearchUrl", () => {
  it("builds google_maps search URL with id locale", () => {
    const url = new URL(
      buildSerpMapsSearchUrl({
        apiKey: "secret",
        q: "Rita Mall",
        ll: "@-7.5,110,6z",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://serpapi.com/search.json");
    expect(url.searchParams.get("engine")).toBe("google_maps");
    expect(url.searchParams.get("type")).toBe("search");
    expect(url.searchParams.get("q")).toBe("Rita Mall");
    expect(url.searchParams.get("hl")).toBe("id");
    expect(url.searchParams.get("gl")).toBe("id");
    expect(url.searchParams.get("api_key")).toBe("secret");
  });
});
