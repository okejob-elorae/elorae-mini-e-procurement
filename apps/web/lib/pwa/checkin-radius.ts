import { haversineMeters } from "@/lib/geo/haversine";

export const DEFAULT_CHECKIN_RADIUS_METERS = 100;

export function parseRadiusSetting(value: string | null | undefined): number {
  if (value === null || value === undefined) return DEFAULT_CHECKIN_RADIUS_METERS;
  const n = Number(value);
  return Number.isFinite(n) ? n : DEFAULT_CHECKIN_RADIUS_METERS;
}

export function resolveEffectiveRadius(overrideMeters: number | null, globalMeters: number): number {
  return overrideMeters ?? globalMeters;
}

export function evaluateCheckinRadius(input: {
  checkin: { lat: number; lng: number };
  store: { lat: number | null; lng: number | null };
  effectiveRadiusMeters: number;
}): { distanceMeters: number | null; outOfRadius: boolean } {
  const { store, checkin, effectiveRadiusMeters } = input;
  if (store.lat === null || store.lng === null) {
    return { distanceMeters: null, outOfRadius: false };
  }
  const distanceMeters = Math.round(
    haversineMeters(checkin, { lat: store.lat, lng: store.lng }),
  );
  return { distanceMeters, outOfRadius: distanceMeters > effectiveRadiusMeters };
}
