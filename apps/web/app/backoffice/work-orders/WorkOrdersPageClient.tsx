'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  ClipboardList, 
  Eye,
  Pencil,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  Play,
  Package
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
import { getWorkOrders, terbitkanWorkOrder, cancelWorkOrder } from '@/app/actions/production';
import { WOStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { isAwaitingApproval } from '@/lib/leadtime/awaiting-acc';
import type { SnapshotStep } from '@/lib/leadtime/calculations';

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
  _count: {
    issues: number;
    receipts: number;
  };
}

const statusLabels: Record<WOStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  IN_PRODUCTION: 'In Production',
  PARTIAL: 'Partial',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

const statusColors: Record<WOStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  ISSUED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  IN_PRODUCTION: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  PARTIAL: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

const statusIcons: Record<WOStatus, React.ReactNode> = {
  DRAFT: <Clock className="h-4 w-4" />,
  ISSUED: <Play className="h-4 w-4" />,
  IN_PRODUCTION: <Package className="h-4 w-4" />,
  PARTIAL: <CheckCircle className="h-4 w-4" />,
  COMPLETED: <CheckCircle className="h-4 w-4" />,
  CANCELLED: <XCircle className="h-4 w-4" />
};

export function WorkOrdersPageClient() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<WOStatus | ''>('');
  /* listWorkOrders already filters by vendorId server-side; the page simply
     never passed it, which left the archive folder link decorative. */
  const searchParams = useSearchParams();
  const vendorIdFilter = searchParams.get('vendorId') ?? undefined;
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const tWO = useTranslations('workOrders');
  const tTolak = useTranslations('productionErrors');
  const tStatus = useTranslations('statuses');
  const tTable = useTranslations('tableHeaders');
  const locale = useLocale();

  const fetchWorkOrders = async () => {
    setIsLoading(true);
    try {
      const result = await getWorkOrders(
        { status: statusFilter || undefined, vendorId: vendorIdFilter },
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
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchWorkOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchWorkOrders depends on filters
  }, [statusFilter, vendorIdFilter, page, pageSize]);

  const handleIssue = async (id: string) => {
    try {
      // Pelaku dibaca dari sesi di server; penolakan dikembalikan sebagai kode
      // (pesan galat yang dilempar disamarkan di build produksi).
      const hasil = await terbitkanWorkOrder(id);
      if (!hasil.ok) {
        toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : tWO('issueFailed'));
        fetchWorkOrders();
        return;
      }
      toast.success(tWO('toastIssued'));
      fetchWorkOrders();
    } catch {
      toast.error(tWO('issueFailed'));
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm(tWO('confirmCancelWO'))) return;
    
    try {
      // Pelaku dibaca dari sesi di server; penolakan dikembalikan sebagai kode.
      const hasil = await cancelWorkOrder(id, '');
      if (!hasil.ok) {
        toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : tWO('cancelFailed'));
        fetchWorkOrders(); // tampilkan keadaan WO yang sebenarnya
        return;
      }
      toast.success(tWO('toastCancelled'));
      fetchWorkOrders();
    } catch (error: any) {
      toast.error(error.message || tWO('cancelFailed'));
    }
  };

  const getCompletionPercent = (wo: WorkOrder) => {
    if (!wo.actualQty || Number(wo.plannedQty) === 0) return 0;
    return Math.min(100, Math.round((Number(wo.actualQty) / Number(wo.plannedQty)) * 100));
  };

  const filteredWOs = workOrders.filter(wo => 
    wo.docNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wo.vendor.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={tWO('pageTitle')}
        actions={
          <Link href="/backoffice/work-orders/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {tWO('newWO')}
            </Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tWO('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : (v as WOStatus))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={tWO('allStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tWO('allStatus')}</SelectItem>
            {(Object.keys(statusLabels) as WOStatus[]).map((status) => (
              <SelectItem key={status} value={status}>
                {tStatus(getStatusMeta('workOrder', status).labelKey as never)}
              </SelectItem>
            ))}
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
          ) : filteredWOs.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={tWO('emptyTitle')}
              description={tWO('emptyDescription')}
            />
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable('woNumber')}</TableHead>
                    <TableHead className="min-w-[160px]">{tTable('vendor')}</TableHead>
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
                  {filteredWOs.map((wo) => (
                    <TableRow key={wo.id}>
                      <TableCell className="font-medium">{wo.docNumber}</TableCell>
                      <TableCell className="whitespace-normal">
                        <div>
                          <p className="font-medium">{wo.vendor.name}</p>
                          <p className="text-sm text-muted-foreground">{wo.vendor.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {(() => {
                            const meta = getStatusMeta('workOrder', wo.status);
                            return <StatusPill tone={meta.tone}>{tStatus(meta.labelKey as never)}</StatusPill>;
                          })()}
                          {isAwaitingApproval(
                            wo.chainSnapshot as SnapshotStep[] | null,
                            wo.chainConfirmedStepIndex ?? null
                          ) &&
                            wo.status !== 'DRAFT' &&
                            wo.status !== 'CANCELLED' &&
                            wo.status !== 'COMPLETED' && (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-700 dark:text-amber-400"
                              >
                                ✋ Menunggu ACC
                              </Badge>
                            )}
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
                      <TableCell>
                        <div className="w-32">
                          <div className="flex justify-between text-xs mb-1">
                            <span>{getCompletionPercent(wo)}%</span>
                            <span className="text-muted-foreground">
                              {Number(wo.actualQty || 0).toLocaleString('id-ID')} / {Number(wo.plannedQty).toLocaleString('id-ID')}
                            </span>
                          </div>
                          <Progress value={getCompletionPercent(wo)} className="h-2" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right 2xl:table-cell">{wo._count.issues}</TableCell>
                      <TableCell className="hidden text-right 2xl:table-cell">{wo._count.receipts}</TableCell>
                      <TableCell className="sticky right-0 bg-card">
                        <div className="flex items-center gap-1">
                          <Link href={`/backoffice/work-orders/${wo.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={tWO('viewWO', { docNumber: wo.docNumber })}
                              aria-label={tWO('viewWO', { docNumber: wo.docNumber })}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {wo.status === 'DRAFT' && (
                            <>
                              <Link href={`/backoffice/work-orders/${wo.id}/edit`}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title={tWO('editWO', { docNumber: wo.docNumber })}
                                  aria-label={tWO('editWO', { docNumber: wo.docNumber })}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleIssue(wo.id)}
                                aria-label={`${tWO('issue')} — ${wo.docNumber}`}
                                title={tWO('issue')}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {(wo.status === 'DRAFT' || wo.status === 'ISSUED') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => handleCancel(wo.id)}
                              aria-label={`${tWO('cancelWO')} — ${wo.docNumber}`}
                              title={tWO('cancelWO')}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
              onPageChange={setPage}
              totalCount={totalCount}
              pageSize={pageSize}
            />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
