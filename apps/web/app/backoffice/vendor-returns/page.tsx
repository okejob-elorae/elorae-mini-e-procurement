'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  Plus,
  Loader2,
  CheckCircle,
  Clock,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Search,
  Package,
  PlayCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { getVendorReturns, processReturn, deleteVendorReturn } from '@/app/actions/vendor-returns';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { PageHeader } from '@/components/ui/page-header';
import { formatDisplayDate } from '@/lib/date-only';

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

type VendorReturnRow = Extract<
  Awaited<ReturnType<typeof getVendorReturns>>,
  { items: unknown[] }
>['items'][number];

export default function VendorReturnsPage() {
  const tUi = useTranslations('ui');
  const tTable = useTranslations('tableHeaders');
  const t = useTranslations('vendorReturnsList');
  const locale = useLocale();
  const statusLabel = (status: string) =>
    status === 'DRAFT' ? t('statusDraft')
    : status === 'PROCESSED' ? t('statusProcessed')
    : status === 'COMPLETED' ? t('statusCompleted')
    : status;
  const { data: session } = useSession();
  const [returns, setReturns] = useState<VendorReturnRow[]>([]);
  const [vendors, setVendors] = useState<SupplierOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  /* Seeded from ?vendorId so the archive folder lands on that vendor's returns
     rather than the unfiltered list — the link was decorative before. */
  const searchParams = useSearchParams();
  const [vendorFilter, setVendorFilter] = useState<string>(
    () => searchParams.get('vendorId') ?? '__all__',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const fetchReturns = async () => {
    setIsLoading(true);
    try {
      const result = await getVendorReturns(
        {
          status: statusFilter === '__all__' ? undefined : statusFilter,
          vendorId: vendorFilter === '__all__' ? undefined : vendorFilter,
          search: searchQuery.trim() || undefined
        },
        { page, pageSize }
      );
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        setReturns((result as { items: VendorReturnRow[] }).items);
        setTotalCount((result as { totalCount: number }).totalCount);
      } else {
        const list = (result as VendorReturnRow[]) ?? [];
        setReturns(list);
        setTotalCount(list.length);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadVendors = async () => {
      try {
        const { getSuppliersForSelect } = await import('@/app/actions/suppliers');
        const data = await getSuppliersForSelect({ approvedOnly: true });
        const list = Array.isArray(data) ? data : [];
        setVendors((list as SupplierOption[]) || []);
      } catch {
        // non-blocking
      }
    };
    loadVendors();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, vendorFilter, searchQuery]);

  useEffect(() => {
    fetchReturns();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchReturns depends on filters
  }, [statusFilter, vendorFilter, searchQuery, page, pageSize]);

  const handleProcess = async (id: string) => {
    if (!session?.user?.id) return;
    setProcessingId(id);
    try {
      await processReturn(id, session.user.id);
      toast.success(t('processed'));
      fetchReturns();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('processFailed'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!session?.user?.id) return;
    if (!confirm(t('confirmDelete'))) return;
    setDeletingId(id);
    try {
      await deleteVendorReturn(id, session.user.id);
      toast.success(t('deleted'));
      fetchReturns();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('pageTitle')}
        actions={
          <Link href="/backoffice/vendor-returns/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('newReturn')}
            </Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col flex-wrap sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <SearchableCombobox
          options={[
            { value: '__all__', label: t('allVendors') },
            ...vendors.map((v) => ({ value: v.id, label: `${v.code} – ${v.name}` })),
          ]}
          value={vendorFilter}
          onValueChange={setVendorFilter}
          placeholder={t('vendorPlaceholder')}
          triggerClassName="w-[180px]"
        />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={tTable('status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tUi('allStatus')}</SelectItem>
            <SelectItem value="DRAFT">{t('statusDraft')}</SelectItem>
            <SelectItem value="PROCESSED">{t('statusProcessed')}</SelectItem>
            <SelectItem value="COMPLETED">{t('statusCompleted')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Vendor Return List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('listTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : returns.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{t('noVendorReturnsFound')}</p>
              </div>
            ) : (
              <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colDoc')}</TableHead>
                      <TableHead className="min-w-[160px]">{t('colVendor')}</TableHead>
                      <TableHead>{t('colWorkOrder')}</TableHead>
                      <TableHead className="text-right">{tUi('totalValue')}</TableHead>
                      <TableHead>{tTable('status')}</TableHead>
                      <TableHead>{t('colCreated')}</TableHead>
                      <TableHead className="sticky right-0 w-[100px] bg-card">{tUi('actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.docNumber}</TableCell>
                          <TableCell className="whitespace-normal">
                            {(r.vendor as { name?: string; code?: string })?.name ?? r.vendorId}
                          </TableCell>
                          <TableCell>
                            {r.wo
                              ? (
                                  <Link
                                    href={`/backoffice/work-orders/${(r.wo as { id: string }).id}`}
                                    className="text-primary hover:underline"
                                  >
                                    {(r.wo as { docNumber?: string }).docNumber}
                                  </Link>
                                )
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(r.totalValue).toLocaleString(undefined, {
                              minimumFractionDigits: 2
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                r.status === 'COMPLETED'
                                  ? 'default'
                                  : r.status === 'PROCESSED'
                                    ? 'secondary'
                                    : 'outline'
                              }
                            >
                              {r.status === 'COMPLETED' || r.status === 'PROCESSED' ? (
                                <CheckCircle className="mr-1 h-3 w-3" />
                              ) : (
                                <Clock className="mr-1 h-3 w-3" />
                              )}
                              {statusLabel(r.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDisplayDate(r.createdAt, locale)}
                          </TableCell>
                          <TableCell className="sticky right-0 bg-card">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t('actionsFor', { docNumber: r.docNumber })}
                                  title={t('actionsFor', { docNumber: r.docNumber })}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/backoffice/vendor-returns/${r.id}`}>
                                    <Eye className="mr-2 h-4 w-4" />
                                    {t('view')}
                                  </Link>
                                </DropdownMenuItem>
                                {r.status === 'DRAFT' && (
                                  <>
                                    <DropdownMenuItem asChild>
                                      <Link href={`/backoffice/vendor-returns/${r.id}/edit`}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        {t('edit')}
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleProcess(r.id)}
                                      disabled={processingId === r.id}
                                    >
                                      {processingId === r.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <PlayCircle className="mr-2 h-4 w-4" />
                                      )}
                                      {processingId === r.id ? t('processing') : t('process')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive"
                                      onClick={() => handleDelete(r.id)}
                                      disabled={deletingId === r.id}
                                    >
                                      {deletingId === r.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="mr-2 h-4 w-4" />
                                      )}
                                      {deletingId === r.id ? t('deleting') : t('delete')}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
