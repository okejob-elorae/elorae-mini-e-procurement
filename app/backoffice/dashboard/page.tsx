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
import { getDashboardStats, type DashboardStats } from '@/app/actions/dashboard';
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
} from '@/app/actions/reports/inventory';
import { getSuppliersForReportFilter } from '@/app/actions/reports/index';
import { toast } from 'sonner';

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

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overduePOs, setOverduePOs] = useState<Awaited<ReturnType<typeof getOverduePOs>>>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; code: string }[]>([]);

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
  const [rp2From, setRp2From] = useState('');
  const [rp2To, setRp2To] = useState('');
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
        const [dashboardData, overdueData, suppliersList] = await Promise.all([
          getDashboardStats(),
          getOverduePOs(),
          getSuppliersForReportFilter(),
        ]);
        if (!cancelled) {
          setStats(dashboardData);
          setOverduePOs(overdueData);
          setSuppliers(suppliersList);
        }
      } catch (e) {
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
            <p className="text-muted-foreground">Loading...</p>
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
            <p className="text-muted-foreground">Something went wrong.</p>
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
      title: 'Purchase Orders',
      value: formatNumber(s.po.submitted),
      description: 'Pending approval',
      icon: ShoppingCart,
      trend:
        s.po.overdue > 0
          ? `${s.po.overdue} overdue`
          : s.po.thisWeek > 0
            ? `${s.po.thisWeek} this week`
            : 'No new this week',
      trendWarning: s.po.overdue > 0,
    },
    {
      title: 'Inventory Items',
      value: formatNumber(s.items.activeCount),
      description: 'Active SKUs',
      icon: Package,
      trend:
        s.items.lowStockCount > 0
          ? `${s.items.lowStockCount} low stock`
          : 'All stocked',
      trendWarning: s.items.lowStockCount > 0,
    },
    {
      title: 'Work Orders',
      value: formatNumber(s.workOrders.inProduction),
      description: 'In production',
      icon: ClipboardList,
      trend:
        s.workOrders.completedToday > 0
          ? `${s.workOrders.completedToday} completed today`
          : 'None completed today',
      trendWarning: false,
    },
    {
      title: 'Suppliers',
      value: formatNumber(s.suppliers.activeCount),
      description: 'Active vendors',
      icon: Users,
      trend: `${s.grnsThisWeek} GRNs this week`,
      trendWarning: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome to Elorae ERP. Here&apos;s what&apos;s happening today.
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
            <CardTitle className="text-sm font-medium">Inventory Value</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatIdr(s.inventory.totalValue)}</div>
            <p className="text-xs text-muted-foreground">Total on hand</p>
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              {s.movementsToday} movements today
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Overview + Reports */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="overdue">Overdue POs</TabsTrigger>
          <TabsTrigger value="rp1">Procurement (RP1)</TabsTrigger>
          <TabsTrigger value="rp2">Production (RP2)</TabsTrigger>
          <TabsTrigger value="rp3">Inventory (RP3)</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
                <CardDescription>Latest actions in the system</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {s.recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No recent activity.</p>
                  ) : (
                    s.recentActivity.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            by {item.userName ?? 'System'}
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
                <p className="text-muted-foreground text-center py-8">No overdue purchase orders</p>
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
                  <Select
                    value={rp1Filters.supplierId || 'all'}
                    onValueChange={(v) =>
                      setRp1Filters((f) => ({ ...f, supplierId: v === 'all' ? '' : v }))
                    }
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {suppliers.map((sup) => (
                        <SelectItem key={sup.id} value={sup.id}>
                          {sup.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <CardTitle>Vendor Performance (RP2)</CardTitle>
              <p className="text-sm text-muted-foreground">
                Work orders by vendor: efficiency, material cost, completion time.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={rp2VendorId} onValueChange={setRp2VendorId}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Select vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((sup) => (
                        <SelectItem key={sup.id} value={sup.id}>
                          {sup.name} ({sup.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <p className="text-muted-foreground text-center py-8">No work orders in range</p>
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
