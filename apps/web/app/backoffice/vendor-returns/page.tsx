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
import { hasPermission, PERMISSIONS } from '@/lib/rbac';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { getVendorReturns, processReturn, hapusReturPemasok } from '@/app/actions/vendor-returns';
import { getPemasokPilihan } from '@/app/actions/purchase-orders';
import { TAUTAN_DOKUMEN } from '@/app/backoffice/purchase-orders/tautan-dokumen';
import { pesanTolakRetur, tolakReturBasi } from './pesan-tolak-retur';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { PageHeader } from '@/components/ui/page-header';
import { formatDisplayDate } from '@/lib/date-only';

interface SupplierOption {
  id: string;
  code: string;
  name: string;
  disetujui: boolean;
}

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

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
  const canManage = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.VENDOR_RETURNS_MANAGE);
  const canCreate = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.VENDOR_RETURNS_CREATE);
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
  // Proses dan hapus lewat dialog aplikasi (dulu proses tanpa konfirmasi, hapus lewat dialog bawaan peramban).
  const [konfirmasi, setKonfirmasi] = useState<{ jenis: 'proses' | 'hapus'; id: string; docNumber: string } | null>(null);
  const tUmum = useTranslations('common');
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
        // Pemasok disetujui ATAU yang punya dokumen — saringan harus bisa memilih pemasok retur lama.
        setVendors(await getPemasokPilihan());
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
      // Penolakan datang sebagai kode (pesan lemparan disamarkan di produksi).
      const hasil = await processReturn(id, session.user.id);
      if (!hasil.ok) {
        toast.error(pesanTolakRetur(hasil, t, t('processFailed'), locale));
        if (tolakReturBasi(hasil)) fetchReturns();
        return;
      }
      toast.success(t('processed'));
      fetchReturns();
    } catch {
      toast.error(t('processFailed'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!session?.user?.id) return;
    setDeletingId(id);
    try {
      // Penolakan datang sebagai kode (pesan lemparan disamarkan di produksi).
      const hasil = await hapusReturPemasok(id);
      if (!hasil.ok) {
        toast.error(hasil.code === 'GAGAL' ? t('deleteFailed') : t(`err.${hasil.code}` as never));
        if (hasil.code !== 'GAGAL') fetchReturns();
        return;
      }
      toast.success(t('deleted'));
      fetchReturns();
    } catch {
      toast.error(t('deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  const jalankanKonfirmasi = async () => {
    const k = konfirmasi;
    setKonfirmasi(null);
    if (!k) return;
    if (k.jenis === 'proses') await handleProcess(k.id);
    else await handleDelete(k.id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('judul')}
        actions={
          canCreate ? (
            <Link href="/backoffice/vendor-returns/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {t('buatRetur')}
              </Button>
            </Link>
          ) : undefined
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
            ...vendors.map((v) => ({
              value: v.id,
              label: `${v.code} – ${v.name}${v.disetujui ? '' : ` · ${t('belumDisetujui')}`}`,
            })),
          ]}
          value={vendorFilter}
          onValueChange={setVendorFilter}
          placeholder={t('vendorPlaceholder')}
          searchPlaceholder={t('cariPemasok')}
          triggerClassName="w-[220px]"
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
            {t('judulDaftar')}
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
                      <TableHead>{t('colTerkait')}</TableHead>
                      <TableHead className="text-right">{tUi('totalValue')}</TableHead>
                      <TableHead>{tTable('status')}</TableHead>
                      <TableHead>{t('colCreated')}</TableHead>
                      <TableHead className="sticky right-0 w-[100px] bg-card">{t('colAksi')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returns.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Link href={`/backoffice/vendor-returns/${r.id}`} className={TAUTAN_DOKUMEN}>
                              {r.docNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {(r.vendor as { name?: string; code?: string })?.name ?? r.vendorId}
                          </TableCell>
                          <TableCell className="text-sm">
                            {!r.wo && !r.po ? (
                              '—'
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {r.wo && (
                                  <span>
                                    <Link
                                      href={`/backoffice/work-orders/${(r.wo as { id: string }).id}`}
                                      className={TAUTAN_DOKUMEN}
                                    >
                                      {(r.wo as { docNumber?: string }).docNumber}
                                    </Link>
                                  </span>
                                )}
                                {r.po && (
                                  <span>
                                    <Link href={`/backoffice/purchase-orders/${r.po.id}`} className={TAUTAN_DOKUMEN}>
                                      {r.po.docNumber}
                                    </Link>
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {rp(Number(r.totalValue))}
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
                                {r.status === 'DRAFT' && canManage && (
                                  <>
                                    <DropdownMenuItem asChild>
                                      <Link href={`/backoffice/vendor-returns/${r.id}/edit`}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        {t('edit')}
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setKonfirmasi({ jenis: 'proses', id: r.id, docNumber: r.docNumber })}
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
                                      onClick={() => setKonfirmasi({ jenis: 'hapus', id: r.id, docNumber: r.docNumber })}
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

      <AlertDialog open={konfirmasi !== null} onOpenChange={(buka) => !buka && setKonfirmasi(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {konfirmasi?.jenis === 'hapus'
                ? t('hapusJudul', { doc: konfirmasi?.docNumber ?? '' })
                : t('prosesJudul', { doc: konfirmasi?.docNumber ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {konfirmasi?.jenis === 'hapus' ? t('hapusIsi') : t('prosesIsi')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tUmum('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant={konfirmasi?.jenis === 'hapus' ? 'destructive' : 'default'}
              onClick={() => void jalankanKonfirmasi()}
            >
              {konfirmasi?.jenis === 'hapus' ? t('delete') : t('process')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
