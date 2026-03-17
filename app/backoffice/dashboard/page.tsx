'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
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
  ShoppingCart,
  Package,
  ClipboardList,
  Users,
  TrendingUp,
  Clock,
  Loader2,
  AlertTriangle,
  Wallet,
  Calendar,
  Download,
} from 'lucide-react';
import { Role } from '@/lib/constants/enums';
import { getDashboardStats, getRawMaterialShortage, getWorkOrderCountByStatus, type DashboardStats, type RawMaterialShortageRow, type WorkOrderStatusCount } from '@/app/actions/dashboard';
import { getOverduePOs } from '@/app/actions/purchase-orders';
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
  getCOGSRawVsFinished,
} from '@/app/actions/reports/inventory';
import { getSuppliersForReportFilter } from '@/app/actions/reports/index';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

function getCurrentMonthDateRange(): { from: string; to: string } {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    ADMIN: 'Administrator',
    PURCHASER: 'Purchaser',
    WAREHOUSE: 'Warehouse Staff',
    PRODUCTION: 'Production Manager',
    USER: 'User',
  };
  return labels[role] || role;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function formatIdr(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelative(date: Date): string {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return '';
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const WO_STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  ISSUED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  IN_PRODUCTION: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  PARTIAL: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const WO_STATUS_LABEL_KEY: Record<string, string> = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  IN_PRODUCTION: 'inProduction',
  PARTIAL: 'partial',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const tDashboard = useTranslations('dashboard');
  const tWO = useTranslations('workOrders');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overduePOs, setOverduePOs] = useState<Awaited<ReturnType<typeof getOverduePOs>>>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; code: string }[]>([]);
  const [cogsRawVsFinished, setCogsRawVsFinished] = useState<Awaited<ReturnType<typeof getCOGSRawVsFinished>> | null>(null);
  const [rawMaterialShortage, setRawMaterialShortage] = useState<RawMaterialShortageRow[]>([]);
  const [woStatusCounts, setWoStatusCounts] = useState<WorkOrderStatusCount[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [dashboardData, overdueData, suppliersList, cogsData, shortageData, woStatusData] = await Promise.all([
          getDashboardStats(),
          getOverduePOs(),
          getSuppliersForReportFilter(),
          getCOGSRawVsFinished(),
          getRawMaterialShortage(),
          getWorkOrderCountByStatus(),
        ]);
        if (!cancelled) {
          setStats(dashboardData);
          setOverduePOs(overdueData);
          setSuppliers(suppliersList);
          setCogsRawVsFinished(cogsData);
          setRawMaterialShortage(shortageData);
          setWoStatusCounts(woStatusData);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load dashboard');
          toast.error('Failed to load dashboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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
      toast.error('Failed to load procurement report');
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
      toast.success('Download started');
    } catch {
      toast.error('Export failed');
    } finally {
      setRp1Exporting(null);
    }
  };

  const loadRp2 = async () => {
    if (!rp2VendorId || !rp2From || !rp2To) {
      toast.error('Select vendor and date range');
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
      toast.error('Failed to load vendor performance report');
    } finally {
      setRp2Loading(false);
    }
  };

  const exportRp2 = async (format: 'csv' | 'excel') => {
    if (!rp2VendorId || !rp2From || !rp2To) {
      toast.error('Select vendor and date range first');
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
      toast.success('Download started');
    } catch {
      toast.error('Export failed');
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
      toast.error('Failed to load inventory snapshot');
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
      toast.success('Download started');
    } catch {
      toast.error('Export failed');
    } finally {
      setRp3Exporting(null);
    }
  };

  if (!session) {
    return null;
  }

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">{tDashboard('loading')}</p>
          </div>
          <Badge variant="secondary" className="w-fit">
            {getRoleLabel(session.user.role as Role)}
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">{tDashboard('somethingWentWrong')}</p>
          </div>
          <Badge variant="secondary" className="w-fit">
            {getRoleLabel(session.user.role as Role)}
          </Badge>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertTriangle className="h-10 w-10 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">{error}</p>
              <p className="text-sm text-muted-foreground">
                Check your connection and try again, or refresh the page.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = stats!;
  const statsCards = [
    {
      title: tDashboard('purchaseOrders'),
      value: formatNumber(s.po.submitted),
      description: tDashboard('pendingApproval'),
      icon: ShoppingCart,
      trend:
        s.po.overdue > 0
          ? tDashboard('overdue', { count: s.po.overdue })
          : s.po.thisWeek > 0
            ? tDashboard('thisWeek', { count: s.po.thisWeek })
            : tDashboard('noNewThisWeek'),
      trendWarning: s.po.overdue > 0,
    },
    {
      title: tDashboard('inventoryItems'),
      value: formatNumber(s.items.activeCount),
      description: tDashboard('activeSkus'),
      icon: Package,
      trend:
        s.items.lowStockCount > 0
          ? tDashboard('lowStock', { count: s.items.lowStockCount })
          : tDashboard('allStocked'),
      trendWarning: s.items.lowStockCount > 0,
    },
    {
      title: tDashboard('workOrders'),
      value: formatNumber(s.workOrders.inProduction),
      description: tDashboard('inProduction'),
      icon: ClipboardList,
      trend:
        s.workOrders.completedToday > 0
          ? tDashboard('completedToday', { count: s.workOrders.completedToday })
          : tDashboard('noneCompletedToday'),
      trendWarning: false,
    },
    {
      title: tDashboard('suppliers'),
      value: formatNumber(s.suppliers.activeCount),
      description: tDashboard('activeVendors'),
      icon: Users,
      trend: tDashboard('grnsThisWeek', { count: s.grnsThisWeek }),
      trendWarning: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tDashboard('title')}</h1>
          <p className="text-muted-foreground">
            {tDashboard('welcomeSubtitle')}
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          {getRoleLabel(session.user.role as Role)}
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statsCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
                <div
                  className={`flex items-center gap-1 mt-2 text-xs ${stat.trendWarning ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}
                >
                  <TrendingUp className="h-3 w-3" />
                  {stat.trend}
                </div>
              </CardContent>
            </Card>
          );
        })}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{tDashboard('inventoryValue')}</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatIdr(s.inventory.totalValue)}</div>
            <p className="text-xs text-muted-foreground">{tDashboard('totalOnHand')}</p>
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              {tDashboard('movementsToday', { count: s.movementsToday })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* COGS: Raw vs Finished */}
      {cogsRawVsFinished && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{tDashboard('cogsRawMaterials')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatIdr(cogsRawVsFinished.rawValue)}</div>
              <p className="text-xs text-muted-foreground">{tDashboard('skuCountFabricAccessories', { count: cogsRawVsFinished.rawCount })}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{tDashboard('cogsFinishedGoods')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{formatIdr(cogsRawVsFinished.finishedValue)}</div>
              <p className="text-xs text-muted-foreground">{tDashboard('skuCountSkus', { count: cogsRawVsFinished.finishedCount })}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs: Overview + Reports */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="overview">{tDashboard('overview')}</TabsTrigger>
          <TabsTrigger value="production">{tDashboard('productionTab')}</TabsTrigger>
          <TabsTrigger value="overdue">{tDashboard('overduePOs')}</TabsTrigger>
          <TabsTrigger value="rp1">{tDashboard('procurementRp1')}</TabsTrigger>
          <TabsTrigger value="rp2">{tDashboard('reportsSetoranCmt')}</TabsTrigger>
          <TabsTrigger value="rp3">{tDashboard('inventoryRp3')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  {tDashboard('recentActivity')}
                </CardTitle>
                <CardDescription>{tDashboard('latestActionsInSystem')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {s.recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">{tDashboard('noRecentActivity')}</p>
                  ) : (
                    s.recentActivity.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {tDashboard('byUser', { name: item.userName ?? tDashboard('system') })}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {formatRelative(item.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="production" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Raw material shortage (active WOs)
              </CardTitle>
              <CardDescription>Deficit vs on-hand for materials planned in work orders in production.</CardDescription>
            </CardHeader>
            <CardContent>
              {rawMaterialShortage.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shortage. All active WO material needs are covered.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead className="text-right">Planned</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Deficit</TableHead>
                      <TableHead>UOM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawMaterialShortage.map((row) => (
                      <TableRow key={row.itemId}>
                        <TableCell className="font-medium">{row.itemName}</TableCell>
                        <TableCell className="text-right">{formatNumber(row.totalPlanned)}</TableCell>
                        <TableCell className="text-right">{formatNumber(row.qtyOnHand)}</TableCell>
                        <TableCell className="text-right text-destructive font-medium">{formatNumber(row.deficit)}</TableCell>
                        <TableCell>{row.uomCode}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Work orders by status
              </CardTitle>
              <CardDescription>Count and total planned qty per status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {(() => {
                const totalPlanned = woStatusCounts.reduce((s, r) => s + Number(r.totalPlannedQty), 0);
                const totalCount = woStatusCounts.reduce((s, r) => s + Number(r.count), 0);
                return (
                  <>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{formatNumber(totalCount)}</span>
                      <span>work orders</span>
                      <span className="text-muted-foreground/70">·</span>
                      <span className="font-medium text-foreground">{formatNumber(totalPlanned)}</span>
                      <span>total planned qty</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {woStatusCounts.map((row) => {
                        const pct = totalPlanned > 0 ? (Number(row.totalPlannedQty) / totalPlanned) * 100 : 0;
                        const label = WO_STATUS_LABEL_KEY[row.status] ? tWO(WO_STATUS_LABEL_KEY[row.status] as 'draft' | 'issued' | 'inProduction' | 'partial' | 'completed' | 'cancelled') : row.status;
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
                                {formatNumber(row.count)} WO{Number(row.count) !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-xl font-semibold tabular-nums">{formatNumber(row.totalPlannedQty)}</p>
                            <p className="text-xs text-muted-foreground">planned qty</p>
                            <Progress value={pct} className="h-1.5" />
                            <p className="text-xs text-muted-foreground">{pct.toFixed(0)}% of total</p>
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
                <Calendar className="h-5 w-5" />
                Overdue Purchase Orders
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overduePOs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{tDashboard('noOverduePOs')}</p>
              ) : (
                <div className="space-y-4">
                  {overduePOs.map((po) => (
                    <div
                      key={po.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{po.docNumber}</p>
                          <Badge variant="destructive">{po.daysOverdue} days overdue</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{po.supplier.name}</p>
                        <p className="text-sm text-muted-foreground">
                          ETA: {po.etaDate ? new Date(po.etaDate).toLocaleDateString('id-ID') : '-'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">Rp {Number(po.grandTotal).toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">
                          {po.pendingQty?.toLocaleString() ?? 0} units pending
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rp1" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Procurement Report (RP1)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Outstanding POs with ETA alerts. Default status: SUBMITTED, PARTIAL.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={rp1Filters.fromDate}
                    onChange={(e) => setRp1Filters((f) => ({ ...f, fromDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={rp1Filters.toDate}
                    onChange={(e) => setRp1Filters((f) => ({ ...f, toDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <SearchableCombobox
                    options={[
                      { value: 'all', label: 'All' },
                      ...suppliers.map((sup) => ({ value: sup.id, label: sup.name })),
                    ]}
                    value={rp1Filters.supplierId || 'all'}
                    onValueChange={(v) =>
                      setRp1Filters((f) => ({ ...f, supplierId: v === 'all' ? '' : v }))
                    }
                    placeholder="All"
                    triggerClassName="w-[200px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
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
                      <SelectItem value="SUBMITTED,PARTIAL">SUBMITTED, PARTIAL</SelectItem>
                      <SelectItem value="SUBMITTED">SUBMITTED</SelectItem>
                      <SelectItem value="PARTIAL">PARTIAL</SelectItem>
                      <SelectItem value="DRAFT">DRAFT</SelectItem>
                      <SelectItem value="CLOSED">CLOSED</SelectItem>
                      <SelectItem value="OVER">OVER</SelectItem>
                      <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={loadRp1} disabled={rp1Loading}>
                  {rp1Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
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
                    Total outstanding: Rp {rp1Data.summary.totalOutstanding.toLocaleString()} · Overdue: {rp1Data.summary.overdueCount} · Due soon: {rp1Data.summary.dueSoonCount}
                  </p>
                  <div className="border rounded-md overflow-auto max-h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Doc #</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>ETA</TableHead>
                          <TableHead>ETA Alert</TableHead>
                          <TableHead className="text-right">Outstanding Qty</TableHead>
                          <TableHead className="text-right">Outstanding Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rp1Data.report.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.docNumber}</TableCell>
                            <TableCell>{r.supplier.name}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>
                              {r.etaDate ? new Date(r.etaDate).toLocaleDateString() : '-'}
                            </TableCell>
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
                              Rp {r.outstandingValue.toLocaleString()}
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
              <CardTitle>{tDashboard('setoranCmtTitle')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {tDashboard('setoranCmtDescription')}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <SearchableCombobox
                    options={suppliers.map((sup) => ({ value: sup.id, label: `${sup.name} (${sup.code})` }))}
                    value={rp2VendorId}
                    onValueChange={setRp2VendorId}
                    placeholder="Select vendor"
                    triggerClassName="w-[220px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input type="date" value={rp2From} onChange={(e) => setRp2From(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input type="date" value={rp2To} onChange={(e) => setRp2To(e.target.value)} />
                </div>
                <Button onClick={loadRp2} disabled={rp2Loading}>
                  {rp2Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
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
                        <TableHead>Doc #</TableHead>
                        <TableHead>Finished Good</TableHead>
                        <TableHead className="text-right">Planned</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">Efficiency %</TableHead>
                        <TableHead className="text-right">Material Cost</TableHead>
                        <TableHead className="text-right">Return Value</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Completion (days)</TableHead>
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
                          <TableCell className="text-right">Rp {r.materialCost.toLocaleString()}</TableCell>
                          <TableCell className="text-right">Rp {r.returnValue.toLocaleString()}</TableCell>
                          <TableCell>{r.status}</TableCell>
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
              <CardTitle>Inventory Snapshot (RP3)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Current inventory value by type, value distribution, low stock alerts.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-center">
                <Button onClick={loadRp3} disabled={rp3Loading}>
                  {rp3Loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load Snapshot'}
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
                        <CardTitle className="text-sm">Total SKUs</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{rp3Data.summary.totalSKUs}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Total Quantity</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{rp3Data.summary.totalQuantity.toLocaleString()}</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Total Value</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          Rp {rp3Data.summary.totalValue.toLocaleString()}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Avg Value/Item</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          Rp {Math.round(rp3Data.summary.avgValuePerItem).toLocaleString()}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Low Stock Alerts</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold text-destructive">
                          {rp3Data.lowStockAlerts.length}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Value distribution by type</h4>
                    <div className="space-y-2">
                      {Object.entries(rp3Data.categories).map(([type, { totalValue, count }]) => {
                        const pct = rp3Data.summary.totalValue > 0 ? (totalValue / rp3Data.summary.totalValue) * 100 : 0;
                        return (
                          <div key={type} className="flex items-center gap-2">
                            <span className="w-24 text-sm">{type}</span>
                            <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                              <div
                                className="h-full bg-primary rounded"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="text-sm tabular-nums w-28">
                              Rp {totalValue.toLocaleString()} ({pct.toFixed(1)}%)
                            </span>
                            <span className="text-muted-foreground text-sm">{count} items</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {rp3Data.lowStockAlerts.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        Low stock alerts
                      </h4>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        {rp3Data.lowStockAlerts.map((a) => (
                          <li key={a.itemId}>
                            {a.sku} – {a.name}: qty {a.qtyOnHand} (reorder: {a.reorderPoint})
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
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Total Value</TableHead>
                          <TableHead className="text-right">% of Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rp3Data.details.map((d) => (
                          <TableRow key={d.itemId}>
                            <TableCell className="font-medium">{d.sku}</TableCell>
                            <TableCell>{d.name}</TableCell>
                            <TableCell>{d.type}</TableCell>
                            <TableCell className="text-right">{d.qtyOnHand}</TableCell>
                            <TableCell className="text-right">Rp {d.totalValue.toLocaleString()}</TableCell>
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
