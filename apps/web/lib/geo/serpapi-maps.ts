export type SerpPlaceResult = {
  title: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string | null;
  rating: number | null;
};

type GpsCoordinates = {
  latitude?: unknown;
  longitude?: unknown;
};

type LocalResult = {
  title?: unknown;
  address?: unknown;
  place_id?: unknown;
  rating?: unknown;
  gps_coordinates?: GpsCoordinates;
};

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Map SerpAPI google_maps payload into a stable DTO list.
 * Business searches use `local_results`; exact addresses/landmarks often
 * return a single `place_results` object instead.
 * Pure — no network. Caps at `limit` (default 5).
 */
export function mapSerpLocalResults(
  payload: unknown,
  limit = 5,
): SerpPlaceResult[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { local_results?: unknown; place_results?: unknown };

  const fromLocal = mapLocalResultsArray(root.local_results, limit);
  if (fromLocal.length > 0) return fromLocal;

  const fromPlace = mapPlaceResult(root.place_results);
  return fromPlace ? [fromPlace] : [];
}

function mapLocalResultsArray(localResults: unknown, limit: number): SerpPlaceResult[] {
  if (!Array.isArray(localResults)) return [];
  const out: SerpPlaceResult[] = [];
  for (const row of localResults) {
    if (out.length >= limit) break;
    const mapped = mapOneResult(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

function mapPlaceResult(place: unknown): SerpPlaceResult | null {
  return mapOneResult(place);
}

function mapOneResult(row: unknown): SerpPlaceResult | null {
  if (!row || typeof row !== "object") return null;
  const r = row as LocalResult;
  const lat = asFiniteNumber(r.gps_coordinates?.latitude);
  const lng = asFiniteNumber(r.gps_coordinates?.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  const address = typeof r.address === "string" ? r.address.trim() : "";
  const placeId = typeof r.place_id === "string" ? r.place_id : null;
  const rating = asFiniteNumber(r.rating);

  return { title, address, lat, lng, placeId, rating };
}

export function buildSerpMapsSearchUrl(input: {
  apiKey: string;
  q: string;
  ll: string;
}): string {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", input.q);
  url.searchParams.set("ll", input.ll);
  url.searchParams.set("hl", "id");
  url.searchParams.set("gl", "id");
  url.searchParams.set("api_key", input.apiKey);
  return url.toString();
}

/** Bias search around current pin, or default Java overview. */
export function buildSerpLl(lat: number | null, lng: number | null): string {
  if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `@${lat},${lng},14z`;
  }
  return "@-6.2,106.8,6z";
}
