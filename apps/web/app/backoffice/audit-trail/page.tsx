'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GetAuditLogsFilters } from '@/types/audit';
import { getAuditLogs, getAuditUsers } from '@/app/actions/audit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { RentangTanggalInput } from '@/components/ui/rentang-tanggal-input';
import { PageHeader } from '@/components/ui/page-header';
import { ChevronDown, ChevronRight, Loader2, FileDown, Filter, ScrollText, X } from 'lucide-react';
import { useLocale, useMessages, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { toCsv } from "@/lib/reports/csv";
import { formatDisplayDateTime } from '@/lib/date-only';
import { keDateLokal } from '@/lib/tanggal-isian';
import { auditActionLabel, auditEntityLabel } from '@/lib/audit/action-label';
import { RincianPerubahan } from './RincianPerubahan';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type AuditLogRow = Awaited<ReturnType<typeof getAuditLogs>>['logs'][number];

const SEMUA = '__all__';

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
  const rows = logs.map((l) => ({
    "Timestamp": l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
    "User": (l.user as { name?: string; email?: string })?.email ?? l.userId,
    "Action": l.action,
    "Entity Type": l.entityType,
    "Entity ID": l.entityId,
    "IP": l.ipAddress ?? "",
    "Sensitive": String(l.sensitiveDataAccessed ?? ""),
    "Reason": l.reason ?? "",
  }));
  return toCsv(headers, rows);
}

/** Akhir hari (inklusif) dari "YYYY-MM-DD" di zona peramban. */
function akhirHari(teks: string): Date | undefined {
  const d = keDateLokal(teks);
  if (!d) return undefined;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export default function AuditTrailPage() {
  const tAudit = useTranslations('audit');
  const tAuditActions = useTranslations('auditActions');
  const messages = useMessages() as Record<string, unknown>;
  const locale = useLocale();
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  // Hasil dicatat bersama kunci saringannya; "memuat" = hasil belum untuk saringan sekarang.
  const [hasil, setHasil] = useState<{ kunci: string; logs: AuditLogRow[]; total: number } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Saringan hidup di URL: bisa dibagikan, dan Kembali dari halaman lain tidak menghapusnya.
  const pengguna = searchParams?.get('pengguna') ?? '';
  const aksi = searchParams?.get('aksi') ?? '';
  const cari = searchParams?.get('cari') ?? '';
  const dari = searchParams?.get('dari') ?? '';
  const sampai = searchParams?.get('sampai') ?? '';
  const halMentah = Number(searchParams?.get('hal') ?? '1');
  const hal = Number.isInteger(halMentah) && halMentah > 0 ? halMentah : 1;
  const limit = DEFAULT_PAGE_SIZE;

  const [cariInput, setCariInput] = useState(cari);
  const kunciSaringan = [pengguna, aksi, cari, dari, sampai, hal].join('|');
  const isLoading = hasil?.kunci !== kunciSaringan;
  const logs = hasil?.logs ?? [];
  const total = hasil?.total ?? 0;

  const filters = useMemo<GetAuditLogsFilters>(
    () => ({
      limit,
      offset: (hal - 1) * limit,
      userId: pengguna || undefined,
      action: aksi || undefined,
      entitySearch: cari || undefined,
      dateFrom: dari ? keDateLokal(dari) : undefined,
      dateTo: sampai ? akhirHari(sampai) : undefined,
    }),
    [limit, hal, pengguna, aksi, cari, dari, sampai],
  );

  const setParams = useCallback(
    (updates: Record<string, string | null>, resetHal = true) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      for (const [k, v] of Object.entries(updates)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      if (resetHal) next.delete('hal');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  // Ketikan pencarian ditulis ke URL setelah jeda, bukan setiap huruf.
  useEffect(() => {
    if (cariInput === cari) return;
    const h = setTimeout(() => setParams({ cari: cariInput.trim() || null }), 300);
    return () => clearTimeout(h);
  }, [cariInput, cari, setParams]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (status !== 'authenticated') return;
    let batal = false;
    getAuditLogs(filters)
      .then((res) => {
        if (!batal) setHasil({ kunci: kunciSaringan, logs: res.logs, total: res.total });
      })
      .catch(() => {
        if (batal) return;
        setHasil({ kunci: kunciSaringan, logs: [], total: 0 });
        toast.error(tAudit('trail.loadFailed'));
      });
    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tAudit from useTranslations
  }, [status, filters, kunciSaringan, router]);

  useEffect(() => {
    getAuditUsers().then(setUsers).catch(() => {});
  }, []);

  // Pilihan aksi: setiap kode yang punya label di `auditActions.actions`, berlabel Indonesia.
  const opsiAksi = useMemo(() => {
    const kamus = (messages.auditActions as { actions?: Record<string, unknown> } | undefined)?.actions ?? {};
    const kode = new Set(Object.keys(kamus));
    if (aksi) kode.add(aksi);
    const opsi = [...kode]
      .map((c) => ({ value: c, label: auditActionLabel(tAuditActions, c) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
    return [{ value: SEMUA, label: tAudit('trail.allActions') }, ...opsi];
  }, [messages, aksi, tAuditActions, tAudit, locale]);

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
      .catch(() => toast.error(tAudit('trail.exportFailed')));
  };

  const adaSaringan = Boolean(pengguna || aksi || cari || dari || sampai);

  if (status === 'loading') {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={tAudit('trail.judulHalaman')}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            {tAudit('trail.exportCsv')}
          </Button>
        }
      />

      <Card className="border-muted/60 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="h-4 w-4" />
            {tAudit('trail.filtersTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="audit-user" className="text-muted-foreground">
                {tAudit('trail.user')}
              </Label>
              <SearchableCombobox
                id="audit-user"
                options={[
                  { value: SEMUA, label: tAudit('trail.allUsers') },
                  ...users.map((u) => ({
                    value: u.id,
                    label: u.name || u.email || tAudit('trail.unnamedUser'),
                  })),
                ]}
                value={pengguna || SEMUA}
                onValueChange={(v) => setParams({ pengguna: v === SEMUA ? null : v })}
                placeholder={tAudit('trail.allUsers')}
                triggerClassName="h-9 w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-action" className="text-muted-foreground">
                {tAudit('trail.action')}
              </Label>
              <SearchableCombobox
                id="audit-action"
                options={opsiAksi}
                value={aksi || SEMUA}
                onValueChange={(v) => setParams({ aksi: v === SEMUA ? null : v })}
                placeholder={tAudit('trail.allActions')}
                searchPlaceholder={tAudit('trail.searchAction')}
                triggerClassName="h-9 w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-entity" className="text-muted-foreground">
                {tAudit('trail.entitySearch')}
              </Label>
              <Input
                id="audit-entity"
                placeholder={tAudit('trail.entitySearchPlaceholder')}
                value={cariInput}
                onChange={(e) => setCariInput(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-date-range" className="text-muted-foreground">
                {tAudit('trail.dateRange')}
              </Label>
              <RentangTanggalInput
                id="audit-date-range"
                dari={dari}
                sampai={sampai}
                onChange={(r) => setParams({ dari: r.dari || null, sampai: r.sampai || null })}
              />
            </div>
          </div>
          {adaSaringan && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setCariInput('');
                  router.replace(pathname, { scroll: false });
                }}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                {tAudit('trail.clearFilters')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5" />
              {tAudit('trail.logsTitle')}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {tAudit('trail.logCount', { total })}
            </span>
          </div>
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
                    <TableHead className="w-8">
                      <span className="sr-only">{tAudit('trail.expandRow')}</span>
                    </TableHead>
                    <TableHead>{tAudit('trail.colTime')}</TableHead>
                    <TableHead>{tAudit('trail.colUser')}</TableHead>
                    <TableHead>{tAudit('trail.colAction')}</TableHead>
                    <TableHead>{tAudit('trail.colEntity')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{tAudit('trail.colIp')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {tAudit('trail.empty')}
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
                                aria-expanded={isExpanded}
                                aria-label={
                                  isExpanded ? tAudit('trail.collapseRow') : tAudit('trail.expandRow')
                                }
                                title={isExpanded ? tAudit('trail.collapseRow') : tAudit('trail.expandRow')}
                                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDisplayDateTime(log.createdAt, locale)}
                            </TableCell>
                            <TableCell className="min-w-[120px] max-w-[200px] whitespace-normal break-words">
                              {user?.name || user?.email || tAudit('trail.unnamedUser')}
                            </TableCell>
                            <TableCell className="min-w-[180px] max-w-[280px] whitespace-normal font-medium">
                              {auditActionLabel(tAuditActions, log.action, log.entityType)}
                            </TableCell>
                            <TableCell className="min-w-[140px] max-w-[220px] whitespace-normal">
                              {auditEntityLabel(tAuditActions, log.entityType)}
                            </TableCell>
                            <TableCell className="hidden text-sm text-muted-foreground 2xl:table-cell">
                              {log.ipAddress ?? '—'}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${log.id}-detail`}>
                              <TableCell colSpan={6} className="whitespace-normal bg-muted/50">
                                <div className="space-y-3 p-4 text-sm">
                                  <RincianPerubahan changes={log.changes} entityType={log.entityType} />
                                  {(log.reason || log.sensitiveDataAccessed) && (
                                    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                                      {log.reason && (
                                        <>
                                          <dt className="text-muted-foreground">{tAudit('trail.reason')}</dt>
                                          <dd className="whitespace-pre-wrap break-words">{log.reason}</dd>
                                        </>
                                      )}
                                      {log.sensitiveDataAccessed && (
                                        <>
                                          <dt className="text-muted-foreground">{tAudit('trail.sensitive')}</dt>
                                          <dd>{log.sensitiveDataAccessed}</dd>
                                        </>
                                      )}
                                    </dl>
                                  )}
                                  {/* Id data, IP, dan perangkat hanya untuk penelusuran teknis — tidak tampil sampai diminta. */}
                                  <Collapsible>
                                    <CollapsibleTrigger asChild>
                                      <Button variant="ghost" size="sm" className="group h-8 px-2 text-muted-foreground">
                                        <ChevronRight className="mr-1 h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                                        {tAudit('trail.rincianTeknis')}
                                      </Button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                                        <dt className="text-muted-foreground">{tAudit('trail.recordId')}</dt>
                                        <dd className="break-all font-mono text-xs text-muted-foreground">
                                          {log.entityId}
                                        </dd>
                                        {log.ipAddress && (
                                          <>
                                            <dt className="text-muted-foreground">{tAudit('trail.colIp')}</dt>
                                            <dd className="text-muted-foreground">{log.ipAddress}</dd>
                                          </>
                                        )}
                                        {log.userAgent && (
                                          <>
                                            <dt className="text-muted-foreground">{tAudit('trail.userAgent')}</dt>
                                            <dd className="break-all text-xs text-muted-foreground">{log.userAgent}</dd>
                                          </>
                                        )}
                                      </dl>
                                    </CollapsibleContent>
                                  </Collapsible>
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
          <Pagination
            page={hal}
            totalPages={Math.max(1, Math.ceil(total / limit))}
            onPageChange={(newPage) => setParams({ hal: newPage > 1 ? String(newPage) : null }, false)}
            totalCount={total}
            pageSize={limit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
