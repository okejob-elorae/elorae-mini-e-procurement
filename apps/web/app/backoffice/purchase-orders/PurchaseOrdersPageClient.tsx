'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { 
  Plus, 
  Search, 
  ShoppingCart, 
  Eye,
  Calendar,
  Send,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { getStatusMeta } from '@/lib/ui/status-map';
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
import { getPOs, submitPO, batalkanPO } from '@/app/actions/purchase-orders';
import { pesanTolakBatalPo } from './pesan-batal-po';
import { BatalPoDialog } from './BatalPoDialog';
import { keadaanBatalPo, tampilStatusBayar } from './aturan-po';
import { TAUTAN_DOKUMEN } from './tautan-dokumen';
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { useSorotBaris } from '@/components/gerak/useSorotBaris';
import { POStatus } from '@/lib/constants/enums';
import { ETABadge } from '@/components/ui/ETABadge';
import { Progress } from '@/components/ui/progress';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { cn } from '@/lib/utils';
import { formatDisplayDate } from '@/lib/date-only';
import { parsePOStatusFilter, type POStatusFilter } from '@/lib/purchase-orders/overdue';

export interface PurchaseOrder {
  id: string;
  docNumber: string;
  status: POStatus;
  etaDate: string | null;
  paymentDueDate?: string | null;
  paidAt?: string | null;
  totalAmount: string;
  grandTotal: string;
  /** Utang setelah sisa yang tidak datang (PO ditutup) dan retur pemasok — dari `listPOs`. */
  utang?: { utang: number; nilaiPo: number };
  closedAt?: string | null;
  createdAt: string;
  supplier: {
    name: string;
    code: string;
  };
  items: Array<{
    qty: string;
    receivedQty: string;
    item: {
      sku: string;
      nameId: string;
    };
  }>;
  _count: {
    grns: number;
  };
  etaAlert?: {
    status: 'normal' | 'warning' | 'danger' | 'completed';
    message: string;
    daysUntil: number;
  };
}

const SEMUA_STATUS: POStatus[] = ['DRAFT', 'SUBMITTED', 'PARTIAL', 'CLOSED', 'OVER', 'CANCELLED'];

export function PurchaseOrdersPageClient({
  initialPOs,
  initialTotalCount,
  initialPage = 1,
  initialStatus = '',
}: {
  initialPOs?: PurchaseOrder[];
  initialTotalCount?: number;
  initialPage?: number;
  initialStatus?: POStatusFilter;
} = {}) {
  const { data: session } = useSession();
  const tToasts = useTranslations('toasts');
  const tSecurity = useTranslations('security');
  const tPO = useTranslations('purchaseOrders');
  const tStatus = useTranslations('statuses');
  const tTable = useTranslations('tableHeaders');
  const locale = useLocale();
  const [pos, setPOs] = useState<PurchaseOrder[]>(initialPOs ?? []);
  // PO yang statusnya baru berubah (dikirim, dibatalkan, atau di halaman rinciannya) menyala sebentar.
  const { sorot, tandai } = useSorotBaris('po', pos.map((po) => ({ id: po.id, tanda: po.status })));
  const [isLoading, setIsLoading] = useState(!initialPOs);
  const [searchQuery, setSearchQuery] = useState('');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilterState] = useState<POStatusFilter>(initialStatus);
  // Saringan ditulis balik ke URL (replace, bukan push): tautannya bisa dibagikan
  // dan "Kembali" tidak berjalan mundur melewati setiap pilihan saringan.
  const setStatusFilter = (next: POStatusFilter) => {
    setStatusFilterState(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('status', next);
    else params.delete('status');
    const qs = params.toString();
    // `history.replaceState`, bukan `router.replace`: Next menyelaraskannya
    // dengan useSearchParams tanpa memuat ulang halaman server — saringan ini
    // bekerja di klien, jadi perjalanan ke server hanya membuang waktu.
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  };
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelTargetDoc, setCancelTargetDoc] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [page, setPage] = useState(initialPage);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(initialTotalCount ?? 0);

  const fetchPOs = async () => {
    setIsLoading(true);
    try {
      const result = await getPOs(
        statusFilter === 'overdue'
          ? { overdue: true }
          : { status: statusFilter || undefined },
        { page, pageSize }
      );
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        setPOs((result as unknown as { items: PurchaseOrder[]; totalCount: number }).items);
        setTotalCount((result as unknown as { items: PurchaseOrder[]; totalCount: number }).totalCount);
      } else {
        const list = (result as unknown as PurchaseOrder[]) ?? [];
        setPOs(list);
        setTotalCount(list.length);
      }
    } catch {
      toast.error(tPO('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchPOs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPOs depends on filters/page
  }, [statusFilter, page, pageSize]);

  const handleSubmit = async (id: string) => {
    if (!session?.user?.id) {
      toast.error(tToasts('youMustBeLoggedIn'));
      return;
    }
    try {
      await submitPO(id, session.user.id);
      toast.success(tToasts('poSubmittedSuccessfully'));
      tandai(id);
      fetchPOs();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : tToasts('failedToSubmitPO');
      toast.error(message);
    }
  };

  /** Batal dari daftar: dialog alasan (wajib) → PIN. Dulu dialog bawaan peramban + alasan Inggris tetap. */
  const handleCancel = (po: PurchaseOrder) => {
    if (!session?.user?.id) {
      toast.error(tToasts('youMustBeLoggedIn'));
      return;
    }
    setCancelTargetId(po.id);
    setCancelTargetDoc(po.docNumber);
    setCancelDialogOpen(true);
  };

  const lanjutBatal = (alasan: string) => {
    setCancelReason(alasan);
    setPinModalOpen(true);
  };

  /*
   * Batal lewat `batalkanPO`, yang MENGEMBALIKAN `{ ok:false, code }`: dulu lewat
   * `cancelPO` yang melempar, dan di build produksi Next menyamarkan pesan
   * lemparan — "sudah ada barang diterima" jadi galat umum. PIN salah/kosong
   * dilempar ke jendela PIN supaya bisa diketik ulang di sana.
   */
  const handlePinConfirm = async (pin: string) => {
    if (!session?.user?.id || !cancelTargetId) return;

    let hasil: Awaited<ReturnType<typeof batalkanPO>>;
    try {
      hasil = await batalkanPO(cancelTargetId, cancelReason, pin);
    } catch {
      // Galat jaringan/server: tampil di jendela PIN, bukan "PIN tidak valid".
      throw new Error(tToasts('failedToCancelPO'));
    }
    if (!hasil.ok) {
      const pesan = pesanTolakBatalPo(hasil);
      const teks =
        pesan.ruang === 'security'
          ? tSecurity.has(pesan.kunci) ? tSecurity(pesan.kunci) : tSecurity('pinInvalid')
          : tPO.has(pesan.kunci) ? tPO(pesan.kunci) : tToasts('failedToCancelPO');
      if (pesan.ulangiPin) throw new Error(teks);
      toast.error(teks);
    } else {
      toast.success(tToasts('poCancelledSuccessfully'));
      tandai(cancelTargetId);
    }
    setPinModalOpen(false);
    setCancelTargetId(null);
    setCancelReason('');
    fetchPOs();
  };

  const getPendingQty = (po: PurchaseOrder) => {
    return po.items.reduce((sum, item) => 
      sum + (Number(item.qty) - Number(item.receivedQty)), 0
    );
  };

  const getReceivedProgress = (po: PurchaseOrder) => {
    const totalOrdered = po.items.reduce((sum, item) => sum + Number(item.qty), 0);
    const totalReceived = po.items.reduce((sum, item) => sum + Number(item.receivedQty), 0);
    if (totalOrdered <= 0) return { ratio: 0, totalOrdered: 0, totalReceived: 0, overReceived: false };
    const ratio = totalReceived / totalOrdered;
    return {
      ratio,
      totalOrdered,
      totalReceived,
      overReceived: ratio > 1,
    };
  };

  const filteredPOs = pos.filter(po => 
    po.docNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    po.supplier.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={tPO('pageTitle')}
        actions={
          <Link href="/backoffice/purchase-orders/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {tPO('newPO')}
            </Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tPO('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : parsePOStatusFilter(v))}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={tPO('allStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tPO('allStatus')}</SelectItem>
            <SelectItem value="overdue">{tPO('filterOverdue')}</SelectItem>
            {SEMUA_STATUS.map((status) => (
              <SelectItem key={status} value={status}>
                {tStatus(getStatusMeta('purchaseOrder', status).labelKey as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* POs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {tPO('listTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredPOs.length === 0 ? (
            searchQuery || statusFilter ? (
              <EmptyState
                icon={ShoppingCart}
                title={tPO('emptyFilteredTitle')}
                description={tPO('emptyFilteredDescription')}
              />
            ) : (
              <EmptyState
                icon={ShoppingCart}
                title={tPO('emptyTitle')}
                description={tPO('emptyDescription')}
              />
            )
          ) : (
            <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tTable('poNumber')}</TableHead>
                    <TableHead className="min-w-[148px]">{tTable('supplier')}</TableHead>
                    <TableHead>{tTable('status')}</TableHead>
                    <TableHead>{tTable('eta')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{tTable('payment')}</TableHead>
                    <TableHead className="text-right">{tPO('colTotal')}</TableHead>
                    <TableHead className="min-w-[120px]">{tTable('progress')}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{tPO('colPending')}</TableHead>
                    <TableHead className="sticky right-0 w-12 bg-card">
                      <span className="sr-only">{tPO('colActions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="baris-berurutan">
                  {filteredPOs.map((po) => (
                    <TableRow key={po.id} {...sorot(po.id)}>
                      <TableCell>
                        <Link href={`/backoffice/purchase-orders/${po.id}`} className={TAUTAN_DOKUMEN}>
                          {po.docNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div>
                          <p className="font-medium">{po.supplier.name}</p>
                          <p className="text-sm text-muted-foreground">{po.supplier.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* Below 2xl the payment state stacks under the status
                            pill instead of taking its own column: at 1280 px
                            the table was ~200 px wider than its card. */}
                        <div className="flex flex-col items-start gap-1">
                          {(() => {
                            const meta = getStatusMeta('purchaseOrder', po.status);
                            return <StatusPill tone={meta.tone}>{tStatus(meta.labelKey as never)}</StatusPill>;
                          })()}
                          {tampilStatusBayar(po.status) && (
                            <span className="2xl:hidden">
                              {po.paidAt ? (
                                <StatusPill tone="settled">{tPO('paid')}</StatusPill>
                              ) : (
                                <StatusPill tone="waiting">{tPO('unpaid')}</StatusPill>
                              )}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {po.etaDate ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {formatDisplayDate(po.etaDate, locale)}
                            </div>
                            <ETABadge etaDate={new Date(po.etaDate)} status={po.status} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {!tampilStatusBayar(po.status) ? (
                          <span className="text-muted-foreground">—</span>
                        ) : po.paidAt ? (
                          <StatusPill tone="settled">{tPO('paid')}</StatusPill>
                        ) : (
                          <StatusPill tone="waiting">{tPO('unpaid')}</StatusPill>
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        Rp {Number(po.grandTotal).toLocaleString('id-ID')}
                        {po.utang && po.utang.utang !== po.utang.nilaiPo && (
                          <div className="text-xs text-muted-foreground">
                            {tPO('ringkasan.utangSingkat', { nilai: `Rp ${po.utang.utang.toLocaleString('id-ID')}` })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const { ratio, totalOrdered, totalReceived, overReceived } = getReceivedProgress(po);
                          if (totalOrdered <= 0) return <span className="text-muted-foreground text-sm">—</span>;
                          const percent = Math.min(100, ratio * 100);
                          return (
                            <div className="space-y-1 min-w-[100px]">
                              <Progress
                                value={percent}
                                className={cn(
                                  overReceived && 'bg-amber-100 dark:bg-amber-900/30 [&_[data-slot=progress-indicator]]:bg-amber-500'
                                )}
                              />
                              <p className={cn(
                                'text-xs tabular-nums',
                                overReceived ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'
                              )}>
                                {totalReceived.toLocaleString('id-ID')} / {totalOrdered.toLocaleString('id-ID')}
                                {overReceived && <span className="ml-1">{tPO('overShort')}</span>}
                              </p>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="hidden text-right 2xl:table-cell">
                        {getPendingQty(po).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="sticky right-0 bg-card">
                        <div className="flex items-center gap-1">
                          <Link href={`/backoffice/purchase-orders/${po.id}`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tPO('viewPO', { docNumber: po.docNumber })}
                              title={tPO('viewPO', { docNumber: po.docNumber })}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {po.status === 'DRAFT' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleSubmit(po.id)}
                              aria-label={`${tPO('submit')} — ${po.docNumber}`}
                              title={tPO('submit')}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}
                          {keadaanBatalPo({ status: po.status, items: po.items, jumlahGrn: po._count?.grns }) === 'boleh' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => handleCancel(po)}
                              aria-label={`${tPO('cancel')} — ${po.docNumber}`}
                              title={tPO('cancel')}
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

      <BatalPoDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        docNumber={cancelTargetDoc}
        onLanjut={lanjutBatal}
      />

      <PinAuthModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setCancelTargetId(null);
          setCancelReason('');
        }}
        onConfirm={handlePinConfirm}
        action={tPO('pinActionCancelPO')}
      />
    </div>
  );
}
