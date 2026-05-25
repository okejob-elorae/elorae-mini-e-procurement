import type { DashboardStats } from './queries';

export type SerializedDashboardStats = Omit<DashboardStats, 'recentActivity'> & {
  recentActivity: Array<{
    id: string;
    action: string;
    label: string;
    userName: string | null;
    createdAt: string;
  }>;
};

export function serializeDashboardStats(stats: DashboardStats): SerializedDashboardStats {
  return {
    ...stats,
    recentActivity: stats.recentActivity.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return value.toISOString();
}
