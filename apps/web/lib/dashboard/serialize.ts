import type { DashboardStats } from "./queries";

/**
 * Dulu membawa umpan aktivitas (berisi `Date`) yang harus diubah ke string
 * sebelum menyeberang ke klien. Umpannya sudah tidak di beranda; angka yang
 * tersisa semuanya bilangan, jadi bentuknya sama persis.
 */
export type SerializedDashboardStats = DashboardStats;

export function serializeDashboardStats(stats: DashboardStats): SerializedDashboardStats {
  return stats;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}
