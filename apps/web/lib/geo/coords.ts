export type ParsedCoords = { lat: number; lng: number };

function validatePair(lat: number, lng: number): ParsedCoords | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Try "lat,lng" or "lat lng" (exactly two numeric tokens). */
function parsePairTokens(raw: string): ParsedCoords | null {
  const commaParts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    return validatePair(Number(commaParts[0]), Number(commaParts[1]));
  }
  const spaceParts = raw.split(/\s+/).filter(Boolean);
  if (spaceParts.length === 2) {
    return validatePair(Number(spaceParts[0]), Number(spaceParts[1]));
  }
  return null;
}

/** Extract lat,lng from common Google Maps URL shapes. */
function parseFromMapsUrl(raw: string): ParsedCoords | null {
  const atMatch = raw.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    return validatePair(Number(atMatch[1]), Number(atMatch[2]));
  }
  const qMatch = raw.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (qMatch) {
    return validatePair(Number(qMatch[1]), Number(qMatch[2]));
  }
  return null;
}

export function parseCoordsPaste(raw: string): ParsedCoords | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed) || /google\.[^/]*\/maps/i.test(trimmed) || /maps\.google/i.test(trimmed)) {
    const fromUrl = parseFromMapsUrl(trimmed);
    if (fromUrl) return fromUrl;
  }

  // Bare @lat,lng fragment pasted without full URL
  if (trimmed.includes("@")) {
    const fromAt = parseFromMapsUrl(trimmed);
    if (fromAt) return fromAt;
  }

  return parsePairTokens(trimmed);
}
