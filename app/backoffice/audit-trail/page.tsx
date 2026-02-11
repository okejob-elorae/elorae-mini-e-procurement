'use client';

import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { GetAuditLogsFilters } from '@/types/audit';
import { getAuditLogs, getAuditUsers } from '@/app/actions/audit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, ChevronRight, Loader2, FileDown, Filter, X } from 'lucide-react';
import { toast } from 'sonner';

type AuditLogRow = Awaited<ReturnType<typeof getAuditLogs>>['logs'][number];

function rowStatus(log: AuditLogRow): 'danger' | 'warning' | 'normal' {
  const action = log.action.toUpperCase();
  if (
    action.includes('FAILED') ||
    action.includes('UNAUTHORIZED') ||
    action.includes('LOGIN_FAILED')
  ) {
    return 'danger';
  }
  if (log.sensitiveDataAccessed) return 'warning';
  return 'normal';
}

function exportToCSV(logs: AuditLogRow[]): string {
  const headers = [
    'Timestamp',
    'User',
    'Action',
    'Entity Type',
    'Entity ID',
    'IP',
    'Sensitive',
    'Reason',
  ];
  const rows = logs.map((l) => [
    l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
    (l.user as { name?: string; email?: string })?.email ?? l.userId,
    l.action,
    l.entityType,
    l.entityId,
    l.ipAddress ?? '',
    l.sensitiveDataAccessed ?? '',
    l.reason ?? '',
  ]);
  const escape = (v: string) =>
    /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return [headers.join(','), ...rows.map((r) => r.map(String).map(escape).join(','))].join('\n');
}

export default function AuditTrailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<GetAuditLogsFilters>({
    limit: 50,
    offset: 0,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const res = await getAuditLogs(filters);
      setLogs(res.logs);
      setTotal(res.total);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    loadLogs();
  }, [status, filters.userId, filters.action, filters.dateFrom, filters.dateTo, filters.entitySearch, filters.offset, filters.limit]);

  useEffect(() => {
    getAuditUsers().then(setUsers).catch(() => {});
  }, []);

  const handleExport = () => {
    getAuditLogs({ ...filters, limit: 2000, offset: 0 })
      .then((res) => {
        const csv = exportToCSV(res.logs);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error('Export failed'));
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
        <p className="text-muted-foreground">
          View and filter system audit logs. Entries are immutable.
        </p>
      </div>

      <Card className="border-muted/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Filter className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-lg">Filters</CardTitle>
              <CardDescription className="mt-0.5">
                Filter by user, action, date range, or entity (e.g. doc number).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="audit-user" className="text-muted-foreground">
                User
              </Label>
              <Select
                value={filters.userId ?? '__all__'}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    userId: v === '__all__' ? undefined : v,
                    offset: 0,
                  }))
                }
              >
                <SelectTrigger id="audit-user" className="h-9 w-full">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All users</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-action" className="text-muted-foreground">
                Action
              </Label>
              <Input
                id="audit-action"
                placeholder="e.g. VIEW_BANK_ACCOUNT"
                value={filters.action ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, action: e.target.value || undefined, offset: 0 }))
                }
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-entity" className="text-muted-foreground">
                Entity search
              </Label>
              <Input
                id="audit-entity"
                placeholder="Entity ID or doc #"
                value={filters.entitySearch ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, entitySearch: e.target.value || undefined, offset: 0 }))
                }
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-date-from" className="text-muted-foreground">
                Date from
              </Label>
              <Input
                id="audit-date-from"
                type="date"
                value={
                  filters.dateFrom
                    ? new Date(filters.dateFrom).toISOString().slice(0, 10)
                    : ''
                }
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    dateFrom: e.target.value ? new Date(e.target.value) : undefined,
                    offset: 0,
                  }))
                }
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-date-to" className="text-muted-foreground">
                Date to
              </Label>
              <Input
                id="audit-date-to"
                type="date"
                value={
                  filters.dateTo
                    ? new Date(filters.dateTo).toISOString().slice(0, 10)
                    : ''
                }
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    dateTo: e.target.value ? new Date(e.target.value) : undefined,
                    offset: 0,
                  }))
                }
                className="h-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() =>
                setFilters({
                  limit: 50,
                  offset: 0,
                  userId: undefined,
                  action: undefined,
                  dateFrom: undefined,
                  dateTo: undefined,
                  entitySearch: undefined,
                })
              }
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Clear filters
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="ml-auto">
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
          <CardDescription>
            {total} entry(ies). Expand row for before/after and details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No audit logs found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => {
                      const statusType = rowStatus(log);
                      const user = log.user as { name?: string; email?: string };
                      const isExpanded = expandedId === log.id;
                      return (
                        <React.Fragment key={log.id}>
                          <TableRow
                            className={
                              statusType === 'danger'
                                ? 'bg-red-50 dark:bg-red-950/20'
                                : statusType === 'warning'
                                  ? 'bg-amber-50 dark:bg-amber-950/20'
                                  : undefined
                            }
                          >
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                              {log.createdAt instanceof Date
                                ? log.createdAt.toLocaleString()
                                : new Date(log.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {user?.name || user?.email || log.userId}
                            </TableCell>
                            <TableCell className="font-medium">{log.action}</TableCell>
                            <TableCell>{log.entityType}</TableCell>
                            <TableCell className="font-mono text-xs max-w-[120px] truncate">
                              {log.entityId}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {log.ipAddress ?? '—'}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${log.id}-detail`}>
                              <TableCell colSpan={7} className="bg-muted/50">
                                <div className="p-4 space-y-2 text-sm">
                                  {log.sensitiveDataAccessed && (
                                    <p>
                                      <span className="font-medium">Sensitive:</span>{' '}
                                      {log.sensitiveDataAccessed}
                                    </p>
                                  )}
                                  {log.reason && (
                                    <p>
                                      <span className="font-medium">Reason:</span> {log.reason}
                                    </p>
                                  )}
                                  {log.userAgent && (
                                    <p>
                                      <span className="font-medium">User-Agent:</span>{' '}
                                      <span className="break-all">{log.userAgent}</span>
                                    </p>
                                  )}
                                  {log.changes && (
                                    <pre className="bg-background p-3 rounded text-xs overflow-auto max-h-48">
                                      {JSON.stringify(log.changes, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {total > (filters.limit ?? 50) && (
            <div className="flex justify-between items-center mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {(filters.offset ?? 0) + 1}–{Math.min((filters.offset ?? 0) + (filters.limit ?? 50), total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(filters.offset ?? 0) === 0}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      offset: Math.max(0, (f.offset ?? 0) - (f.limit ?? 50)),
                    }))
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(filters.offset ?? 0) + (filters.limit ?? 50) >= total}
                  onClick={() =>
                    setFilters((f) => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 50) }))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
