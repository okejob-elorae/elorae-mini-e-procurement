import {
  buildSerpLl,
  buildSerpMapsSearchUrl,
  mapSerpLocalResults,
  type SerpPlaceResult,
} from "./serpapi-maps";

export type { SerpPlaceResult };

export type SearchPlacesErrorCode =
  | "NO_API_KEY"
  | "EMPTY_QUERY"
  | "UPSTREAM"
  | "FORBIDDEN";

export type SearchPlacesResult =
  | { ok: true; results: SerpPlaceResult[] }
  | { ok: false; code: SearchPlacesErrorCode; message: string };

/**
 * Server-side SerpAPI google_maps place search. Never call from the browser
 * with the API key — use the stores server action wrapper.
 */
export async function searchPlacesViaSerpApi(input: {
  q: string;
  lat?: number | null;
  lng?: number | null;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SearchPlacesResult> {
  const q = input.q.trim();
  if (!q) {
    return { ok: false, code: "EMPTY_QUERY", message: "Query is empty." };
  }
  const apiKey = (input.apiKey ?? process.env.SERPAPI_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, code: "NO_API_KEY", message: "SERPAPI_KEY is not configured." };
  }

  const ll = buildSerpLl(input.lat ?? null, input.lng ?? null);
  const url = buildSerpMapsSearchUrl({ apiKey, q, ll });
  const fetchFn = input.fetchImpl ?? fetch;

  try {
    const res = await fetchFn(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        code: "UPSTREAM",
        message: `SerpAPI HTTP ${res.status}`,
      };
    }
    const json: unknown = await res.json();
    if (
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof (json as { error: unknown }).error === "string"
    ) {
      return {
        ok: false,
        code: "UPSTREAM",
        message: (json as { error: string }).error,
      };
    }
    return { ok: true, results: mapSerpLocalResults(json, 5) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SerpAPI request failed";
    return { ok: false, code: "UPSTREAM", message };
  }
}
