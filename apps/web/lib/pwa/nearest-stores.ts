import { haversineMeters } from "@/lib/geo/haversine";

export type StoreWithCoords = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

export type RankedStore = {
  store: StoreWithCoords;
  distanceMeters: number | null;
};

export function rankStoresByDistance(
  stores: StoreWithCoords[],
  origin: { lat: number; lng: number } | null,
): RankedStore[] {
  if (origin === null) {
    return stores.map(store => ({ store, distanceMeters: null }));
  }

  const withDistance: RankedStore[] = [];
  const withoutCoords: RankedStore[] = [];

  for (const store of stores) {
    if (store.lat === null || store.lng === null) {
      withoutCoords.push({ store, distanceMeters: null });
      continue;
    }
    const d = haversineMeters(origin, { lat: store.lat, lng: store.lng });
    withDistance.push({ store, distanceMeters: d });
  }

  withDistance.sort((a, b) => (a.distanceMeters! - b.distanceMeters!));
  return [...withDistance, ...withoutCoords];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = Math.round(meters / 100) / 10;
  return `${km.toFixed(1)} km`;
}
