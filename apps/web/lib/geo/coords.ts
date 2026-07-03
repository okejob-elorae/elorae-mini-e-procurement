export type ParsedCoords = { lat: number; lng: number };

export function parseCoordsPaste(raw: string): ParsedCoords | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { lat, lng };
}
