'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Search,
  ClipboardList,
  Eye,
  Pencil,
  Calendar,
  CheckCircle,
  XCircle,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
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
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-only';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { getStatusMeta } from '@/lib/ui/status-map';
import { getWorkOrders } from '@/app/actions/production';
import { WOStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { isAwaitingApproval } from '@/lib/leadtime/awaiting-acc';
import type { SnapshotStep } from '@/lib/leadtime/calculations';
import { hariTerlambatWo } from '@/lib/production/terlambat';
import type { AngkaSetoranWo } from '@/lib/production/setoran-wo';
import { DialogBatalWo } from './DialogBatalWo';
import { DialogTerbitWo } from './DialogTerbitWo';

interface WorkOrder {
  id: string;
  docNumber: string;
  status: WOStatus;
  plannedQty: string;
  actualQty: string | null;
  targetDate: string | null;
  completedAt: string | null;
  createdAt: string;
  chainSnapshot?: Array<{ name: string }> | null;
  chainConfirmedStepIndex?: number | null;
  vendor: {
    name: string;
    code: string;
  };
  finishedGood?: { id: string; sku: string; nameId: string; nameEn: string } | null;
  _count: {
    issues: number;
    receipts: number;
  };
  /** Angka setoran dari dokumen penerimaan (lib/production/setoran-wo.ts), dihitung di server. */
  setoran: AngkaSetoranWo;
}

const SEMUA_STATUS: WOStatus[] = ['DRAFT', 'ISSUED', 'IN_PRODUCTION', 'PARTIAL', 'COMPLETED', 'CANCELLED'];

/** Saringan daftar WO tinggal di URL (`?status=&q=&terlambat=1&page=`), supaya bisa dibagikan. */
export function WorkOrdersPageClient() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const vendorIdFilter = searchParams.get('vendorId') ?? undefined;
  const statusMentah = searchParams.get('status') ?? '';
  const statusFilter = (SEMUA_STATUS as string[]).includes(statusMentah) ? (statusMentah as WOStatus) : '';
  const qUrl = searchParams.get('q') ?? '';
  const terlambatSaja = searchParams.get('terlambat') === '1';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = DEFAULT_PAGE_SIZE;
  const [cari, setCari] = useState(qUrl);
  const [totalCount, setTotalCount] = useState(0);
  const [terbit, setTerbit] = useState<WorkOrder | null>(null);
  const [batal, setBatal] = useState<WorkOrder | null>(null);
  const tWO = useTranslations('workOrders');
  const tStatus = useTranslations('statuses');
  const tTable = useTranslations('tableHeaders');
  const locale = useLocale();

  /** Ganti beberapa parameter URL sekaligus; saringan baru selalu kembali ke halaman 1. */
  const setParams = useCallback(
    (ubah: Record<string, string | null>) => {
      const q = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(ubah)) {
        if (v == null || v === '') q.delete(k);
        else q.set(k, v);
      }
      if (!('page' in ubah)) q.delete('page');
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Kotak cari ditulis ke URL sesudah berhenti mengetik.
  useEffect(() => {
    if (cari.trim() === qUrl) return;
    const t = setTimeout(() => setParams({ q: cari.trim() || null }), 400);
    return () => clearTimeout(t);
  }, [cari, qUrl, setParams]);

  const fetchWorkOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getWorkOrders(
        {
          status: statusFilter || undefined,
          vendorId: vendorIdFilter,
          q: qUrl || undefined,
          terlambat: terlambatSaja || undefined,
        },
        { page, pageSize }
      );
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        setWorkOrders((result as unknown as { items: WorkOrder[] }).items);
        setTotalCount((result as unknown as { totalCount: number }).totalCount);
      } else {
        const list = (result as unknown as WorkOrder[]) ?? [];
        setWorkOrders(list);
        setTotalCount(list.length);
      }
    } catch {
      toast.error(tWO('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, vendorIdFilter, qUrl, terlambatSaja, page, pageSize, tWO]);

  useEffect(() => {
    void fetchWorkOrders();
  }, [fetchWorkOrders]);

  const labelStatus = (wo: WorkOrder) => {
    const meta = getStatusMeta('workOrder', wo.status);
    return <StatusPill tone={meta.tone}>{tStatus(meta.labelKey as never)}</StatusPill>;
  };
  const menungguAcc = (wo: WorkOrder) =>
    isAwaitingApproval(wo.chainSnapshot as SnapshotStep[] | null, wo.chainConfirmedStepIndex ?? null) &&
    wo.status !== 'DRAFT' &&
    wo.status !== 'CANCELLED' &&
    wo.status !== 'COMPLETED';
  const kemajuan = (wo: WorkOrder) => (
    <div className="w-32">
      <div className="mb-1 flex justify-between text-xs tabular-nums">
        <span>{wo.setoran.persen}%</span>
        <span className="text-muted-foreground">
          {wo.setoran.masukStok.toLocaleString('id-ID')} / {wo.setoran.target.toLocaleString('id-ID')}
        </span>
      </div>
      <Progress value={wo.setoran.persen} className="h-2" aria-label={tWO('setoran.masukDariTarget', {
        masuk: wo.setoran.masukStok.toLocaleString('id-ID'),
        target: wo.setoran.target.toLocaleString('id-ID'),
      })} />
    </div>
  );
  /** Tombol aksi baris; tautan memakai Button asChild supaya tidak ada <a> yang membungkus <button>. */
  const aksi = (wo: WorkOrder) => {
    const bolehBatal =
      (wo.status === 'DRAFT' || wo.status === 'ISSUED' || wo.status === 'IN_PRODUCTION') &&
      wo._count.receipts === 0;
    return (
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="icon">
          <Link
            href={`/backoffice/work-orders/${wo.id}`}
            title={tWO('viewWO', { docNumber: wo.docNumber })}
            aria-label={tWO('viewWO', { docNumber: wo.docNumber })}
          >
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
        {wo.status === 'DRAFT' && (
          <>
            <Button asChild variant="ghost" size="icon">
              <Link
                href={`/backoffice/work-orders/${wo.id}/edit`}
                title={tWO('editWO', { docNumber: wo.docNumber })}
                aria-label={tWO('editWO', { docNumber: wo.docNumber })}
              >
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTerbit(wo)}
              aria-label={`${tWO('issue')} — ${wo.docNumber}`}
              title={tWO('issue')}
            >
              <Play className="h-4 w-4" />
            </Button>
          </>
        )}
        {bolehBatal && (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => setBatal(wo)}
            aria-label={`${tWO('cancelWO')} — ${wo.docNumber}`}
            title={tWO('cancelWO')}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={tWO('pageTitle')}
        actions={
          <Button asChild>
            <Link href="/backoffice/work-orders/new">
              <Plus className="mr-2 h-4 w-4" />
              {tWO('newWO')}
            </Link>
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tWO('searchPlaceholder')}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="pl-9"
            aria-label={tWO('searchPlaceholder')}
          />
        </div>
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(v) => setParams({ status: v === '__all__' ? null : v })}
        >
          <SelectTrigger className="w-[180px]" aria-label={tWO('allStatus')}>
            <SelectValue placeholder={tWO('allStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tWO('allStatus')}</SelectItem>
            {SEMUA_STATUS.map((status) => (
              <SelectItem key={status} value={status}>
                {tStatus(getStatusMeta('workOrder', status).labelKey as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={terlambatSaja ? 'terlambat' : 'semua'}
          onValueChange={(v) => setParams({ terlambat: v === 'terlambat' ? '1' : null })}
        >
          <SelectTrigger className="w-[200px]" aria-label={tWO('saringTarget')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="semua">{tWO('semuaTarget')}</SelectItem>
            <SelectItem value="terlambat">{tWO('terlambatSaja')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Work Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {tWO('listTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : workOrders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={tWO('emptyTitle')}
              description={tWO('emptyDescription')}
            />
          ) : (
            <>
            {/* HP: satu kartu per perintah kerja — tabel sembilan kolom tidak terbaca di 390 px. */}
            <ul className="space-y-3 md:hidden">
              {workOrders.map((wo) => {
                const terlambat = hariTerlambatWo(wo.targetDate, wo.status);
                return (
                  <li key={wo.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <Link href={`/backoffice/work-orders/${wo.id}`} className="font-medium hover:underline">
                          {wo.docNumber}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1">
                          {labelStatus(wo)}
                          {menungguAcc(wo) ? (
                            <Badge variant="outline" className="border-amber-500 text-amber-800 dark:text-amber-300">
                              {tWO('menungguAcc')}
                            </Badge>
                          ) : null}
                          {terlambat != null ? (
                            <Badge variant="destructive">{tWO('terlambatHari', { hari: terlambat })}</Badge>
                          ) : null}
                        </div>
                      </div>
                      {aksi(wo)}
                    </div>
                    {wo.finishedGood ? (
                      <p className="text-sm">
                        {wo.finishedGood.nameId}{' '}
                        <span className="text-muted-foreground">· {wo.finishedGood.sku}</span>
                      </p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">{wo.vendor.name}</p>
                    <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="h-4 w-4" aria-hidden />
                        {wo.targetDate ? formatDisplayDate(wo.targetDate, locale) : '-'}
                      </span>
                      {kemajuan(wo)}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable('woNumber')}</TableHead>
                    <TableHead className="min-w-[180px]">{tWO('colBarangJadi')}</TableHead>
                    {/* Di bawah 2xl vendor menumpang di sel barang jadi supaya tabel muat di laptop 1280. */}
                    <TableHead className="hidden min-w-[140px] 2xl:table-cell">{tTable('vendor')}</TableHead>
                    <TableHead>{tTable('status')}</TableHead>
                    <TableHead>{tWO('colTargetDate')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{tWO('completedAt')}</TableHead>
                    <TableHead>{tTable('progress')}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{tWO('colIssues')}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{tWO('colReceipts')}</TableHead>
                    <TableHead className="sticky right-0 w-12 bg-card">
                      <span className="sr-only">{tWO('colActions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.map((wo) => {
                    const terlambat = hariTerlambatWo(wo.targetDate, wo.status);
                    return (
                    <TableRow key={wo.id}>
                      <TableCell className="font-medium">
                        <Link href={`/backoffice/work-orders/${wo.id}`} className="hover:underline">
                          {wo.docNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {wo.finishedGood ? (
                          <div>
                            <p className="font-medium">{wo.finishedGood.nameId}</p>
                            <p className="text-sm text-muted-foreground">{wo.finishedGood.sku}</p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        <p className="mt-1 text-sm text-muted-foreground 2xl:hidden">{wo.vendor.name}</p>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal 2xl:table-cell">
                        <div>
                          <p>{wo.vendor.name}</p>
                          <p className="text-sm text-muted-foreground">{wo.vendor.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {labelStatus(wo)}
                          {menungguAcc(wo) ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-800 dark:text-amber-300"
                            >
                              {tWO('menungguAcc')}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {wo.targetDate ? (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDisplayDate(wo.targetDate, locale)}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {terlambat != null ? (
                          <Badge variant="destructive" className="mt-1">
                            {tWO('terlambatHari', { hari: terlambat })}
                          </Badge>
                        ) : null}
                        {/* Below 2xl the completion time rides under the
                            target date instead of taking its own column. */}
                        {wo.completedAt ? (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground 2xl:hidden">
                            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                            {formatDisplayDateTime(wo.completedAt, locale)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {wo.completedAt ? (
                          <div className="flex items-center gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                            <span>
                              {formatDisplayDateTime(wo.completedAt, locale)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{kemajuan(wo)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{wo._count.issues}</TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{wo._count.receipts}</TableCell>
                      <TableCell className="sticky right-0 bg-card">{aksi(wo)}</TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
              onPageChange={(p) => setParams({ page: p > 1 ? String(p) : null })}
              totalCount={totalCount}
              pageSize={pageSize}
            />
            </>
          )}
        </CardContent>
      </Card>

      {terbit ? (
        <DialogTerbitWo
          open
          onOpenChange={(buka) => !buka && setTerbit(null)}
          woId={terbit.id}
          docNumber={terbit.docNumber}
          onSelesai={() => void fetchWorkOrders()}
        />
      ) : null}
      {batal ? (
        <DialogBatalWo
          open
          onOpenChange={(buka) => !buka && setBatal(null)}
          woId={batal.id}
          docNumber={batal.docNumber}
          onSelesai={() => void fetchWorkOrders()}
        />
      ) : null}
    </div>
  );
}
