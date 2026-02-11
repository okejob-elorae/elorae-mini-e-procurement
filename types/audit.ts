/** Filters for querying audit logs (client-safe, no server deps). */
export interface GetAuditLogsFilters {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  entitySearch?: string;
  limit?: number;
  offset?: number;
}
