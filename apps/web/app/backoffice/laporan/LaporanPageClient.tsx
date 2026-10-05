'use client';

import { useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { formatDateOnly, formatDisplayDate, parseDateOnly } from '@/lib/date-only';
import { getStatusMeta } from '@/lib/ui/status-map';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  AlertTriangle,
  Download,
  ChevronDown,
  PackageX,
  Factory,
  CalendarClock,
  ShoppingCart,
  Scissors,
  Warehouse,
} from 'lucide-react';
import type { RawMaterialShortageRow, WorkOrderStatusCount } from '@/lib/dashboard/queries';
import {
  getProcurementReport,
  exportProcurementReport,
  type ProcurementReportFilters,
} from '@/app/actions/reports/procurement';
import {
  getVendorPerformanceReport,
  exportVendorPerformanceReport,
} from '@/app/actions/reports/production';
import {
  getInventoryValueSnapshot,
  exportInventorySnapshotReport,
} from '@/app/actions/reports/inventory';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { PipelineBar } from '@/components/dashboard/PipelineBar';
import {
  WO_STATUS_BADGE_CLASS,
  WO_STATUS_BAR_CLASS,
  WO_STATUS_LABEL_KEY,
} from '@/components/dashboard/warna-status-wo';
import { formatRupiah as formatIdr } from '@/lib/format/rupiah';

/**
 * Laporan operasional — dipindah utuh dari tab-tab di bawah beranda
 * (Produksi, PO terlambat, Pengadaan, Setoran CMT, Inventori).
 *
 * Beranda menjawab "apa yang menunggu saya dan bagaimana keadaan kita";
 * laporan menjawab "tunjukkan rinciannya". Dua pertanyaan itu tadinya berbagi
 * satu halaman dan beranda jadi dua kali lebih panjang dari yang dibaca orang.
 * Isi dan pemuatan datanya tidak ditulis ulang — hanya rumahnya yang pindah.
 */

const LAPORAN_TABS = [
  'production',
  'overdue',
  'rp1',
  'rp2',
  'rp3',
] as const;
type LaporanTab = (typeof LAPORAN_TABS)[number];

function isLaporanTab(value: string | null): value is LaporanTab {
  return value != null && (LAPORAN_TABS as readonly string[]).includes(value);
}

function getCurrentMonthDateRange(): { from: string; to: string } {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Jenis barang di laporan inventori — enum mentah tidak pernah tampil. */
const ITEM_TYPE_LABEL_KEY: Record<string, 'fabric' | 'accessories' | 'finishedGood'> = {
  FABRIC: 'fabric',
  ACCESSORIES: 'accessories',
  FINISHED_GOOD: 'finishedGood',
};

export type OverduePORow = {
  id: string;
  docNumber: string;
  etaDate: string | null;
  status: string;
  grandTotal: number;
  supplier: { name: string; code: string };
  daysOverdue: number;
  pendingQty: number;
};

export function LaporanPageClient({
  initialOverduePOs,
  initialSuppliers,
  initialRawMaterialShortage,
  initialWoStatusCounts,
}: {
  initialOverduePOs: OverduePORow[];
  initialSuppliers: { id: string; name: string; code: string }[];
  initialRawMaterialShortage: RawMaterialShortageRow[];
  initialWoStatusCounts: WorkOrderStatusCount[];
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tDashboard = useTranslations('dashboard');
  const tTable = useTranslations('tableHeaders');
  const tWO = useTranslations('workOrders');
  const tStatuses = useTranslations('statuses');
  const tItems = useTranslations('items');
  const locale = useLocale();
  const tabFromUrl = searchParams.get('tab');
  const activeTab: LaporanTab = isLaporanTab(tabFromUrl) ? tabFromUrl : 'production';
  const setActiveTab = (value: string) => {
    if (!isLaporanTab(value)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'production') params.delete('tab');
    else params.set('tab', value);
    const qs = params.toString();
    router.replace(qs ? `/backoffice/laporan?${qs}` : '/backoffice/laporan', {
      scroll: false,
    });
  };
  const overduePOs = initialOverduePOs;
  const suppliers = initialSuppliers;
  const rawMaterialShortage = initialRawMaterialShortage;
  const [shortageRowsOpen, setShortageRowsOpen] = useState<Set<string>>(() => new Set());
  const woStatusCounts = initialWoStatusCounts;
  const itemTypeLabel = (type: string) =>
    ITEM_TYPE_LABEL_KEY[type] ? tItems(ITEM_TYPE_LABEL_KEY[type]) : type;

  const toggleShortageRow = (itemId: string) => {
    setShortageRowsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const [rp1Filters, setRp1Filters] = useState<{
    fromDate: string;
    toDate: string;
    supplierId: string;
    status: string[];
  }>({ fromDate: '', toDate: '', supplierId: '', status: ['SUBMITTED', 'PARTIAL'] });
  const [rp1Data, setRp1Data] = useState<Awaited<ReturnType<typeof getProcurementReport>> | null>(null);
  const [rp1Loading, setRp1Loading] = useState(false);
  const [rp1Exporting, setRp1Exporting] = useState<'csv' | 'excel' | null>(null);

  const [rp2VendorId, setRp2VendorId] = useState('');
  const currentMonth = getCurrentMonthDateRange();
  const [rp2From, setRp2From] = useState(currentMonth.from);
  const [rp2To, setRp2To] = useState(currentMonth.to);
  const [rp2Data, setRp2Data] = useState<Awaited<ReturnType<typeof getVendorPerformanceReport>> | null>(null);
  const [rp2Loading, setRp2Loading] = useState(false);
  const [rp2Exporting, setRp2Exporting] = useState<'csv' | 'excel' | null>(null);

  const [rp3Data, setRp3Data] = useState<Awaited<ReturnType<typeof getInventoryValueSnapshot>> | null>(null);
  const [rp3Loading, setRp3Loading] = useState(false);
  const [rp3Exporting, setRp3Exporting] = useState<'csv' | 'excel' | null>(null);

  const loadRp1 = async () => {
    setRp1Loading(true);
    try {
      const filters: ProcurementReportFilters = {};
      if (rp1Filters.fromDate) filters.fromDate = new Date(rp1Filters.fromDate);
      if (rp1Filters.toDate) filters.toDate = new Date(rp1Filters.toDate);
      if (rp1Filters.supplierId) filters.supplierId = rp1Filters.supplierId;
      if (rp1Filters.status.length) filters.status = rp1Filters.status as ProcurementReportFilters['status'];
      const result = await getProcurementReport(filters);
      setRp1Data(result);
    } catch {
      toast.error(tDashboard('toast.loadProcurementFailed'));
    } finally {
      setRp1Loading(false);
    }
  };

  const exportRp1 = async (format: 'csv' | 'excel') => {
    setRp1Exporting(format);
    try {
      const filters: ProcurementReportFilters = {};
      if (rp1Filters.fromDate) filters.fromDate = new Date(rp1Filters.fromDate);
      if (rp1Filters.toDate) filters.toDate = new Date(rp1Filters.toDate);
      if (rp1Filters.supplierId) filters.supplierId = rp1Filters.supplierId;
      if (rp1Filters.status.length) filters.status = rp1Filters.status as ProcurementReportFilters['status'];
      const result = await exportProcurementReport(filters, format);
      if ('data' in result && result.data != null) {
        const blob = new Blob([result.data], { type: 'text/csv;charset=utf-8' });
        downloadBlob(blob, result.filename);
      } else if ('base64' in result) {
        const bin = atob(result.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        downloadBlob(blob, result.filename);
      }
      toast.success(tDashboard('toast.downloadStarted'));
    } catch {
      toast.error(tDashboard('toast.exportFailed'));
    } finally {
      setRp1Exporting(null);
    }
  };

  const loadRp2 = async () => {
    if (!rp2VendorId || !rp2From || !rp2To) {
      toast.error(tDashboard('toast.selectVendorRange'));
      return;
    }
    setRp2Loading(true);
    try {
      const data = await getVendorPerformanceReport(
        rp2VendorId,
        new Date(rp2From),
        new Date(rp2To)
      );
      setRp2Data(data);
    } catch {
      toast.error(tDashboard('toast.loadVendorFailed'));
    } finally {
      setRp2Loading(false);
    }
  };

  const exportRp2 = async (format: 'csv' | 'excel') => {
    if (!rp2VendorId || !rp2From || !rp2To) {
      toast.error(tDashboard('toast.selectVendorRange'));
      return;
    }
    setRp2Exporting(format);
    try {
      const result = await exportVendorPerformanceReport(
        rp2VendorId,
        new Date(rp2From),
        new Date(rp2To),
        format
      );
      if ('data' in result) {
        downloadBlob(new Blob([result.data], { type: 'text/csv;charset=utf-8' }), result.filename);
      } else {
        const bin = atob(result.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        downloadBlob(
          new Blob([arr], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          result.filename
        );
      }
      toast.success(tDashboard('toast.downloadStarted'));
    } catch {
      toast.error(tDashboard('toast.exportFailed'));
    } finally {
      setRp2Exporting(null);
    }
  };

  const loadRp3 = async () => {
    setRp3Loading(true);
    try {
      const data = await getInventoryValueSnapshot();
      setRp3Data(data);
    } catch {
      toast.error(tDashboard('toast.loadSnapshotFailed'));
    } finally {
      setRp3Loading(false);
    }
  };

  const exportRp3 = async (format: 'csv' | 'excel') => {
    setRp3Exporting(format);
    try {
      const result = await exportInventorySnapshotReport(format);
      if ('data' in result) {
        downloadBlob(new Blob([result.data], { type: 'text/csv;charset=utf-8' }), result.filename);
      } else {
        const bin = atob(result.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        downloadBlob(
          new Blob([arr], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          result.filename
        );
      }
      toast.success(tDashboard('toast.downloadStarted'));
    } catch {
      toast.error(tDashboard('toast.exportFailed'));
    } finally {
      setRp3Exporting(null);
    }
  };

  if (!session) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={tDashboard('reportsPageTitle')} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="production">{tDashboard('productionTab')}</TabsTrigger>
          <TabsTrigger value="overdue">{tDashboard('overduePOs')}</TabsTrigger>
          <TabsTrigger value="rp1">{tDashboard('procurementRp1')}</TabsTrigger>
          <TabsTrigger value="rp2">{tDashboard('reportsSetoranCmt')}</TabsTrigger>
          <TabsTrigger value="rp3">{tDashboard('inventoryRp3')}</TabsTrigger>
        </TabsList>

        <TabsContent value="production" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageX aria-hidden className="h-5 w-5" />
                {tDashboard('shortageTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rawMaterialShortage.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tDashboard('noShortage')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 shrink-0 p-2" />
                      <TableHead>{tDashboard('colMaterial')}</TableHead>
                      <TableHead className="text-right">{tDashboard('colStillNeeded')}</TableHead>
                      <TableHead className="text-right">{tDashboard('colAvailable')}</TableHead>
                      <TableHead className="text-right">{tDashboard('colDeficit')}</TableHead>
                      <TableHead>{tTable('uom')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawMaterialShortage.map((row) => {
                      const expanded = shortageRowsOpen.has(row.itemId);
                      const hasVendors = row.vendors.length > 0;
                      return (
                        <Fragment key={row.itemId}>
                          <TableRow>
                            <TableCell className="p-2 align-middle">
                              {hasVendors ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={() => toggleShortageRow(row.itemId)}
                                  aria-expanded={expanded}
                                  aria-label={expanded ? tDashboard('hideVendors') : tDashboard('showVendors')}
                                >
                                  <ChevronDown
                                    className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
                                  />
                                </Button>
                              ) : (
                                <span className="inline-flex h-8 w-8 items-center justify-center" aria-hidden />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{row.itemName}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(row.totalNeeded)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumber(row.available)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums text-destructive">
                              {formatNumber(row.deficit)}
                            </TableCell>
                            <TableCell>{row.uomCode}</TableCell>
                          </TableRow>
                          {expanded && hasVendors ? (
                            <TableRow key={`${row.itemId}-vendors`} className="hover:bg-transparent">
                              <TableCell colSpan={6} className="border-t-0 bg-muted/40 px-4 py-3 align-top">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  {tDashboard('vendorsToSupply')}
                                </p>
                                <ul className="space-y-3 text-sm">
                                  {row.vendors.map((v) => (
                                    <li key={v.vendorId}>
                                      <span className="font-medium">{v.vendorName}</span>
                                      {v.vendorCode ? (
                                        <span className="text-muted-foreground"> ({v.vendorCode})</span>
                                      ) : null}
                                      <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-3 ml-0.5">
                                        {v.workOrders.map((wo) => (
                                          <li key={wo.woId} className="text-muted-foreground">
                                            <Link
                                              href={`/backoffice/work-orders/${wo.woId}`}
                                              className="font-mono text-xs text-primary hover:underline"
                                            >
                                              {wo.docNumber}
                                            </Link>
                                            <span className="tabular-nums">
                                              {' '}
                                              — {tDashboard('neededQtyOf', { qty: formatNumber(wo.neededQty), uom: row.uomCode })}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </li>
                                  ))}
                                </ul>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Factory aria-hidden className="h-5 w-5" />
                {tDashboard('woByStatusTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/*
                Batang komposisi, DI ATAS kartu-kartu angkanya. Yang ditanya
                orang bukan "berapa yang DRAFT" melainkan "di tahap mana
                pekerjaan menumpuk" — itu pertanyaan tentang proporsi, dan
                proporsi tidak terbaca dari enam angka yang harus dijumlah
                sendiri di kepala. Kartu angkanya tetap ada di bawah: ia yang
                menjawab pertanyaan berikutnya, "berapa persisnya".
              */}
              <PipelineBar
                baris={woStatusCounts.map((row) => ({
                  status: row.status,
                  count: Number(row.count),
                  label: WO_STATUS_LABEL_KEY[row.status] ? tWO(WO_STATUS_LABEL_KEY[row.status]) : row.status,
                  // Sewarna lencana statusnya di kartu-kartu di bawah batang.
                  kelas: WO_STATUS_BAR_CLASS[row.status],
                }))}
              />
              {(() => {
                const totalPlanned = woStatusCounts.reduce((s, r) => s + Number(r.totalPlannedQty), 0);
                const totalCount = woStatusCounts.reduce((s, r) => s + Number(r.count), 0);
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{formatNumber(totalCount)}</span>
                      <span>{tDashboard('woCountLabel')}</span>
                      <span className="text-muted-foreground/70">·</span>
                      <span className="font-medium text-foreground">{formatNumber(totalPlanned)}</span>
                      <span>{tDashboard('totalPlannedQtyLabel')}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {woStatusCounts.map((row) => {
                        const pct = totalPlanned > 0 ? (Number(row.totalPlannedQty) / totalPlanned) * 100 : 0;
                        const label = WO_STATUS_LABEL_KEY[row.status] ? tWO(WO_STATUS_LABEL_KEY[row.status]) : row.status;
                        const badgeClass = WO_STATUS_BADGE_CLASS[row.status] ?? 'bg-muted text-muted-foreground';
                        return (
                          <div
                            key={row.status}
                            className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge className={badgeClass}>
                                {label}
                              </Badge>
                              <span className="text-right text-sm tabular-nums text-muted-foreground">
                                {tDashboard('woCount', { count: formatNumber(row.count) })}
                              </span>
                            </div>
                            <p className="text-xl font-semibold tabular-nums">{formatNumber(row.totalPlannedQty)}</p>
                            <p className="text-xs text-muted-foreground">{tDashboard('plannedQtyLabel')}</p>
                            <Progress value={pct} className="h-1.5" />
                            <p className="text-xs text-muted-foreground">{tDashboard('pctOfTotal', { pct: pct.toFixed(0) })}</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overdue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock aria-hidden className="h-5 w-5" />
                {tDashboard('overdueTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overduePOs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{tDashboard('noOverduePOs')}</p>
              ) : (
                <div className="space-y-4">
                  {/* Tiap baris menaut ke PO-nya — angka terlambat tanpa jalan
                      ke dokumennya memaksa orang mencari nomornya sendiri. */}
                  {overduePOs.map((po) => (
                    <Link
                      key={po.id}
                      href={`/backoffice/purchase-orders/${po.id}`}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{po.docNumber}</p>
                          <Badge variant="destructive">{tDashboard('daysOverdue', { count: po.daysOverdue })}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{po.supplier.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {tDashboard('etaLine', { date: formatDisplayDate(po.etaDate, locale) })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatIdr(po.grandTotal)}</p>
                        <p className="text-sm text-muted-foreground">
                          {tDashboard('unitsPending', { count: (po.pendingQty ?? 0).toLocaleString('id-ID') })}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rp1" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart aria-hidden className="h-5 w-5" />
                {tDashboard('procurementReport')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="rp1-date-range">{tDashboard('dateRange')}</Label>
                  <DateRangePicker
                    id="rp1-date-range"
                    triggerClassName="w-[220px]"
                    value={{
                      from: parseDateOnly(rp1Filters.fromDate),
                      to: parseDateOnly(rp1Filters.toDate),
                    }}
                    onChange={(range) =>
                      setRp1Filters((f) => ({
                        ...f,
                        fromDate: range?.from ? formatDateOnly(range.from) : '',
                        toDate: range?.to ? formatDateOnly(range.to) : '',
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{tTable('supplier')}</Label>
                  <SearchableCombobox
                    options={[
                      { value: 'all', label: tDashboard('all') },
                      ...suppliers.map((sup) => ({ value: sup.id, label: sup.name })),
                    ]}
                    value={rp1Filters.supplierId || 'all'}
                    onValueChange={(v) =>
                      setRp1Filters((f) => ({ ...f, supplierId: v === 'all' ? '' : v }))
                    }
                    placeholder={tDashboard('all')}
                    triggerClassName="w-[200px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{tTable('status')}</Label>
                  <Select
                    value={rp1Filters.status.join(',') || 'SUBMITTED,PARTIAL'}
                    onValueChange={(v) =>
                      setRp1Filters((f) => ({ ...f, status: v ? v.split(',') : ['SUBMITTED', 'PARTIAL'] }))
                    }
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SUBMITTED,PARTIAL">
                        {tStatuses('poSubmitted')} + {tStatuses('poPartial')}
                      </SelectItem>
                      {(['SUBMITTED', 'PARTIAL', 'DRAFT', 'CLOSED', 'OVER', 'CANCELLED'] as const).map((st) => (
                        <SelectItem key={st} value={st}>
                          {tStatuses(getStatusMeta('purchaseOrder', st).labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={loadRp1} disabled={rp1Loading}>
                  {rp1Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : tDashboard('show')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp1('csv')}
                    disabled={!!rp1Exporting}
                  >
                    {rp1Exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp1('excel')}
                    disabled={!!rp1Exporting}
                  >
                    {rp1Exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Excel
                  </Button>
                </div>
              </div>
              {rp1Data && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {tDashboard('procurementSummary', {
                      total: formatIdr(rp1Data.summary.totalOutstanding),
                      overdue: rp1Data.summary.overdueCount,
                      soon: rp1Data.summary.dueSoonCount,
                    })}
                  </p>
                  <div className="border rounded-md overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tDashboard('colDocNo')}</TableHead>
                          <TableHead>{tTable('supplier')}</TableHead>
                          <TableHead>{tTable('status')}</TableHead>
                          <TableHead>{tTable('eta')}</TableHead>
                          <TableHead>{tDashboard('colEtaAlert')}</TableHead>
                          <TableHead className="text-right">{tDashboard('colOutstandingQty')}</TableHead>
                          <TableHead className="text-right">{tDashboard('outstandingValue')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rp1Data.report.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.docNumber}</TableCell>
                            <TableCell>{r.supplier.name}</TableCell>
                            <TableCell>{tStatuses(getStatusMeta('purchaseOrder', r.status).labelKey)}</TableCell>
                            <TableCell>{formatDisplayDate(r.etaDate, locale)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.etaStatus === 'danger'
                                    ? 'destructive'
                                    : r.etaStatus === 'warning'
                                      ? 'secondary'
                                      : 'outline'
                                }
                              >
                                {r.etaMessage}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{r.outstandingQty}</TableCell>
                            <TableCell className="text-right">
                              {formatIdr(r.outstandingValue)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rp2" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scissors aria-hidden className="h-5 w-5" />
                {tDashboard('setoranCmtTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>{tTable('vendor')}</Label>
                  <SearchableCombobox
                    options={suppliers.map((sup) => ({ value: sup.id, label: `${sup.name} (${sup.code})` }))}
                    value={rp2VendorId}
                    onValueChange={setRp2VendorId}
                    placeholder={tDashboard('selectVendor')}
                    triggerClassName="w-[220px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rp2-date-range">{tDashboard('dateRange')}</Label>
                  <DateRangePicker
                    id="rp2-date-range"
                    triggerClassName="w-[220px]"
                    value={{
                      from: parseDateOnly(rp2From),
                      to: parseDateOnly(rp2To),
                    }}
                    onChange={(range) => {
                      setRp2From(range?.from ? formatDateOnly(range.from) : '');
                      setRp2To(range?.to ? formatDateOnly(range.to) : '');
                    }}
                  />
                </div>
                <Button onClick={loadRp2} disabled={rp2Loading}>
                  {rp2Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : tDashboard('show')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp2('csv')}
                    disabled={!!rp2Exporting}
                  >
                    {rp2Exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp2('excel')}
                    disabled={!!rp2Exporting}
                  >
                    {rp2Exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Excel
                  </Button>
                </div>
              </div>
              {rp2Data && rp2Data.length > 0 && (
                <div className="border rounded-md overflow-auto max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tDashboard('colDocNo')}</TableHead>
                        <TableHead>{tDashboard('colFinishedGood')}</TableHead>
                        <TableHead className="text-right">{tDashboard('colPlanned')}</TableHead>
                        <TableHead className="text-right">{tDashboard('colActual')}</TableHead>
                        <TableHead className="text-right">{tDashboard('colEfficiency')}</TableHead>
                        <TableHead className="text-right">{tDashboard('colMaterialCost')}</TableHead>
                        <TableHead className="text-right">{tDashboard('returnValue')}</TableHead>
                        <TableHead>{tTable('status')}</TableHead>
                        <TableHead className="text-right">{tDashboard('colCompletionDays')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rp2Data.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{r.docNumber}</TableCell>
                          <TableCell>{r.finishedGood}</TableCell>
                          <TableCell className="text-right">{r.plannedQty}</TableCell>
                          <TableCell className="text-right">{r.actualQty}</TableCell>
                          <TableCell className="text-right">{r.efficiency}</TableCell>
                          <TableCell className="text-right">{formatIdr(r.materialCost)}</TableCell>
                          <TableCell className="text-right">{formatIdr(r.returnValue)}</TableCell>
                          <TableCell>{tStatuses(getStatusMeta('workOrder', r.status).labelKey)}</TableCell>
                          <TableCell className="text-right">{r.completionTimeDays ?? '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {rp2Data && rp2Data.length === 0 && (
                <p className="text-muted-foreground text-center py-8">{tDashboard('noWorkOrdersInRange')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rp3" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Warehouse aria-hidden className="h-5 w-5" />
                {tDashboard('snapshotTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-center">
                <Button onClick={loadRp3} disabled={rp3Loading}>
                  {rp3Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : tDashboard('show')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp3('csv')}
                    disabled={!!rp3Exporting}
                  >
                    {rp3Exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportRp3('excel')}
                    disabled={!!rp3Exporting}
                  >
                    {rp3Exporting === 'excel' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Excel
                  </Button>
                </div>
              </div>
              {rp3Data && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tDashboard('totalSkus')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{rp3Data.summary.totalSKUs}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tDashboard('totalQuantity')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{rp3Data.summary.totalQuantity.toLocaleString('id-ID')}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tDashboard('totalValue')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatIdr(rp3Data.summary.totalValue)}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tDashboard('avgValuePerItem')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {formatIdr(Math.round(rp3Data.summary.avgValuePerItem))}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{tDashboard('lowStockAlerts')}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-destructive">
                          {rp3Data.lowStockAlerts.length}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">{tDashboard('valueDistribution')}</h4>
                    <div className="space-y-2">
                      {Object.entries(rp3Data.categories).map(([type, { totalValue, count }]) => {
                        const pct = rp3Data.summary.totalValue > 0 ? (totalValue / rp3Data.summary.totalValue) * 100 : 0;
                        return (
                          <div key={type} className="flex items-center gap-2">
                            <span className="w-24 text-sm">{itemTypeLabel(type)}</span>
                            <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                              <div
                                className="h-full bg-primary rounded"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-sm tabular-nums w-28">
                              {formatIdr(totalValue)} ({pct.toFixed(1)}%)
                            </span>
                            <span className="text-muted-foreground text-sm">{tDashboard('itemsCount', { count })}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {rp3Data.lowStockAlerts.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        {tDashboard('lowStockAlerts')}
                      </h4>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {rp3Data.lowStockAlerts.map((a) => (
                          <li key={a.itemId}>
                            {tDashboard('lowStockLine', { sku: a.sku, name: a.name, qty: a.qtyOnHand, reorder: a.reorderPoint })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="border rounded-md overflow-auto max-h-[300px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>{tTable('name')}</TableHead>
                          <TableHead>{tTable('type')}</TableHead>
                          <TableHead className="text-right">{tTable('qty')}</TableHead>
                          <TableHead className="text-right">{tDashboard('totalValue')}</TableHead>
                          <TableHead className="text-right">{tDashboard('percentOfTotal')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rp3Data.details.map((d) => (
                          <TableRow key={d.itemId}>
                            <TableCell className="font-medium">{d.sku}</TableCell>
                            <TableCell>{d.name}</TableCell>
                            <TableCell>{itemTypeLabel(d.type)}</TableCell>
                            <TableCell className="text-right">{d.qtyOnHand}</TableCell>
                            <TableCell className="text-right">{formatIdr(d.totalValue)}</TableCell>
                            <TableCell className="text-right">{d.percentageOfTotal.toFixed(2)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
