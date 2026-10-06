'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import Link from 'next/link';
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  ChevronDown,
  ChevronRight,
  Printer,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDate } from '@/lib/date-only';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { getInventorySnapshot } from '@/app/actions/nilai-persediaan';
import {
  getGRNs,
  getRollsByGrnId,
  getFabricRolls,
  getFabricRollFilterOptions,
  approveGRNByOwner,
  declineGRNByOwner,
  getGrnJournalState,
  postGrnReceiptJournalAction,
  postGrnReversalJournalAction,
} from '@/app/actions/grn';
import { hasPermission } from "@/lib/rbac";
import { getStockAdjustments } from '@/app/actions/inventory';
import {
  SARINGAN_SUMBER_BAWAAN,
  SARINGAN_SUMBER_OTOMATIS,
  SARINGAN_SUMBER_SEMUA,
  SUMBER_PENYESUAIAN,
  labelJenisGerakan,
} from '@/lib/inventory/jenis-gerakan-stok';
import { getInventoryValueSnapshot } from '@/app/actions/reports/inventory';
import { buildInventoryReportPrintHtml } from '@/lib/print/inventory-report-html';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { StockHealthKpis } from '@/components/inventory/StockHealthKpis';
import { StockItemCard } from '@/components/inventory/StockItemCard';
import type { StockSort, StockStatus } from '@/lib/inventory/stock-status';

interface InventoryItem {
  itemId: string;
  qtyOnHand: number;
  reservedQty: number;
  available: number;
  avgCost: number;
  totalValue: number;
  variants?: Array<{
    variantSku: string;
    qtyOnHand: number;
    reservedQty: number;
    available: number;
    label: string;
  }>;
  item: {
    sku: string;
    nameId: string;
    nameEn: string;
    type: string;
    reorderPoint: number | null;
    uom: {
      code: string;
      nameId: string;
    };
  };
}

interface GRN {
  id: string;
  docNumber: string;
  grnDate: string;
  totalAmount: string;
  requiresOwnerApproval?: boolean;
  ownerApprovedAt?: string | Date | null;
  ownerDeclinedAt?: string | Date | null;
  supplier: {
    name: string;
  };
  po?: {
    docNumber: string;
  };
}

interface Adjustment {
  id: string;
  docNumber: string;
  type: 'POSITIVE' | 'NEGATIVE';
  qtyChange: string;
  reason: string;
  /** Kode sumber StockAdjustment (ERP, FULFILLMENT_CONSUME, VAN_LOAD, …); label lewat i18n. */
  source: string;
  createdAt: string;
  evidenceUrl?: string | null;
  item: {
    sku: string;
    nameId: string;
  };
  createdBy?: { name: string | null; email: string | null } | null;
  approvedBy?: { name: string | null } | null;
}

type InventorySummary = {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  totalAvailable: number;
  menipisCount: number;
  habisCount: number;
  negatifCount: number;
};

type InventoryPageClientProps = {
  initialInventory: InventoryItem[];
  initialSummary: InventorySummary;
  initialStockTotalCount: number;
  initialGrns: GRN[];
  initialGrnTotalCount: number;
  initialAdjustments: Adjustment[];
  initialAdjTotalCount: number;
  initialAdjustmentItemList: Array<{ itemId: string; item: { sku: string; nameId: string } }>;
};

const STOCK_STATUS_VALUES: StockStatus[] = ["OK", "MENIPIS", "HABIS", "NEGATIF"];

function isStockStatus(v: string): v is StockStatus {
  return (STOCK_STATUS_VALUES as string[]).includes(v);
}

export function InventoryPageClient({
  initialInventory,
  initialSummary,
  initialStockTotalCount,
  initialGrns,
  initialGrnTotalCount,
  initialAdjustments,
  initialAdjTotalCount,
  initialAdjustmentItemList,
}: InventoryPageClientProps) {
  const tTable = useTranslations('tableHeaders');
  const t = useTranslations("inventory");
  const tWall = useTranslations("inventory.wallboard");
  const tp = useTranslations("inventory.page");
  const tKind = useTranslations("inventory.stockMoveKind");
  const tToasts = useTranslations("toasts");
  const locale = useLocale();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [inventory, setInventory] = useState<InventoryItem[]>(initialInventory);
  const [grns, setGRNs] = useState<GRN[]>(initialGrns);
  const [approvingGrnId, setApprovingGrnId] = useState<string | null>(null);
  const [decliningGrnId, setDecliningGrnId] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initialAdjustments);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [grnSearchQuery, setGrnSearchQuery] = useState('');
  const [adjustmentSearchQuery, setAdjustmentSearchQuery] = useState('');
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState<string | null>(null);
  const [expandedGrnId, setExpandedGrnId] = useState<string | null>(null);
  const [grnRolls, setGrnRolls] = useState<Array<{ id: string; rollCode: string; rollRef: string; initialLength: number; remainingLength: number; isClosed: boolean; item: { sku: string; nameId: string }; uom: { code: string } }>>([]);
  const [grnJournal, setGrnJournal] = useState<Awaited<ReturnType<typeof getGrnJournalState>> | null>(null);
  const [postingJournal, setPostingJournal] = useState(false);
  const [rolls, setRolls] = useState<
    Array<{
      id: string;
      rollCode: string;
      rollRef: string;
      initialLength: number | null;
      remainingLength: number | null;
      isClosed: boolean;
      item: { sku: string; nameId: string };
      uom: { code: string };
      grn?: { docNumber: string; grnDate: Date };
    }>
  >([]);
  const [rollsPage, setRollsPage] = useState(1);
  const [rollsPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [rollsTotalCount, setRollsTotalCount] = useState(0);
  const [rollsLoading, setRollsLoading] = useState(false);
  const ROLLS_FILTER_ALL = '';
  const [rollsFilterGrnId, setRollsFilterGrnId] = useState(ROLLS_FILTER_ALL);
  const [rollsFilterItemId, setRollsFilterItemId] = useState(ROLLS_FILTER_ALL);
  const [rollGrnOptions, setRollGrnOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [rollItemOptions, setRollItemOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [rollsSearchQuery, setRollsSearchQuery] = useState('');
  const [rollsSearchDebounced, setRollsSearchDebounced] = useState('');
  const rollsSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") ?? "stock");
  const [stockStatus, setStockStatus] = useState<StockStatus | null>(() =>
    searchParams.get("oversold") === "1" ? "NEGATIF" : null,
  );
  const [stockSort, setStockSort] = useState<StockSort>("stock_desc");
  const [summary, setSummary] = useState<InventorySummary>(initialSummary);
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [stockTotalCount, setStockTotalCount] = useState(initialStockTotalCount);
  const [stockSearchDebounced, setStockSearchDebounced] = useState('');
  const stockSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [grnPage, setGrnPage] = useState(1);
  const [grnPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [grnTotalCount, setGrnTotalCount] = useState(initialGrnTotalCount);
  const [adjPage, setAdjPage] = useState(1);
  const [adjPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [adjTotalCount, setAdjTotalCount] = useState(initialAdjTotalCount);
  const ADJ_FILTER_ALL = '__all__';
  const [adjItemFilter, setAdjItemFilter] = useState<string>('__all__');
  // Saringan sumber + pencarian dijalankan di server; bawaan menyembunyikan sumber otomatis.
  const [adjSumber, setAdjSumber] = useState<string>(SARINGAN_SUMBER_BAWAAN);
  const [adjSearchDebounced, setAdjSearchDebounced] = useState('');
  const [adjustmentItemList] = useState(initialAdjustmentItemList);
  const skipInitialListFetch = useRef(true);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [invData, grnData, adjData] = await Promise.all([
        getInventorySnapshot({
          page: stockPage,
          pageSize: stockPageSize,
          search: stockSearchDebounced.trim() || undefined,
          status: stockStatus ?? undefined,
          sort: stockSort,
        }),
        getGRNs(undefined, { page: grnPage, pageSize: grnPageSize }),
        getStockAdjustments(adjItemFilter === ADJ_FILTER_ALL ? undefined : adjItemFilter, {
          page: adjPage,
          pageSize: adjPageSize,
          sumber: adjSumber,
          cari: adjSearchDebounced.trim() || undefined,
        })
      ]);

      if (invData != null && typeof invData === 'object' && 'items' in invData) {
        const snap = invData as {
          items: unknown[];
          totalCount?: number;
          totalItems?: number;
          totalValue?: number;
          lowStockItems?: number;
          totalAvailable?: number;
          menipisCount?: number;
          habisCount?: number;
          negatifCount?: number;
        };
        setInventory((snap.items ?? []) as unknown as InventoryItem[]);
        setSummary({
          totalItems: snap.totalItems ?? 0,
          totalValue: snap.totalValue ?? 0,
          lowStockItems: snap.lowStockItems ?? 0,
          totalAvailable: snap.totalAvailable ?? 0,
          menipisCount: snap.menipisCount ?? 0,
          habisCount: snap.habisCount ?? 0,
          negatifCount: snap.negatifCount ?? 0,
        });
        setStockTotalCount(snap.totalCount ?? snap.items.length);
      }
      if (grnData != null && typeof grnData === 'object' && 'items' in grnData && 'totalCount' in grnData) {
        setGRNs((grnData as unknown as { items: GRN[] }).items);
        setGrnTotalCount((grnData as unknown as { totalCount: number }).totalCount);
      } else {
        const grnList = (grnData as unknown as GRN[]) ?? [];
        setGRNs(grnList);
        setGrnTotalCount(grnList.length);
      }
      if (adjData != null && typeof adjData === 'object' && 'items' in adjData && 'totalCount' in adjData) {
        setAdjustments((adjData as unknown as { items: Adjustment[] }).items);
        setAdjTotalCount((adjData as unknown as { totalCount: number }).totalCount);
      } else {
        const adjList = (adjData as unknown as Adjustment[]) ?? [];
        setAdjustments(adjList);
        setAdjTotalCount(adjList.length);
      }
    } catch {
      toast.error(tToasts('failedToLoadInventoryData'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Skip first paint fetch when SSR already matches current filters (incl. oversold→NEGATIF).
    if (
      skipInitialListFetch.current &&
      stockPage === 1 &&
      grnPage === 1 &&
      adjPage === 1 &&
      adjItemFilter === ADJ_FILTER_ALL &&
      adjSumber === SARINGAN_SUMBER_BAWAAN &&
      !adjSearchDebounced &&
      stockSort === "stock_desc" &&
      !stockSearchDebounced
    ) {
      skipInitialListFetch.current = false;
      return;
    }
    skipInitialListFetch.current = false;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchData depends on pagination/filters above
  }, [stockPage, grnPage, adjPage, adjItemFilter, adjSumber, adjSearchDebounced, stockSearchDebounced, stockStatus, stockSort]);

  // Pencarian penyesuaian dikirim ke server setelah jeda mengetik.
  useEffect(() => {
    const id = setTimeout(() => {
      setAdjSearchDebounced(adjustmentSearchQuery);
      setAdjPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [adjustmentSearchQuery]);

  useEffect(() => {
    if (!expandedGrnId) {
      setGrnRolls([]);
      setGrnJournal(null);
      return;
    }
    getRollsByGrnId(expandedGrnId)
      .then(setGrnRolls)
      .catch(() => setGrnRolls([]));
    getGrnJournalState(expandedGrnId)
      .then(setGrnJournal)
      .catch(() => setGrnJournal(null));
  }, [expandedGrnId]);

  const canPostJournal = hasPermission(session?.user?.permissions ?? [], "journals:manage");

  const handlePostJournal = async (grnId: string, kind: "receipt" | "reversal") => {
    setPostingJournal(true);
    try {
      const res =
        kind === "receipt"
          ? await postGrnReceiptJournalAction(grnId)
          : await postGrnReversalJournalAction(grnId);
      if (res.ok) {
        toast.success(t(res.created ? "grnJournal.postedToast" : "grnJournal.alreadyPostedToast"));
      } else {
        switch (res.code) {
          case "UNMAPPED_ROLE":
            toast.error(t("grnJournal.errUNMAPPED_ROLE", { role: res.role ?? "" }));
            break;
          case "UNBALANCED":
            toast.error(t("grnJournal.errUNBALANCED"));
            break;
          case "NOTHING_TO_POST":
            toast.error(t("grnJournal.errNOTHING_TO_POST"));
            break;
          case "BAD_STATE":
            toast.error(t("grnJournal.errBAD_STATE"));
            break;
          case "FORBIDDEN":
            toast.error(t("grnJournal.errFORBIDDEN"));
            break;
          default:
            toast.error(t("grnJournal.errBAD_STATE"));
        }
      }
      await getGrnJournalState(grnId)
        .then(setGrnJournal)
        .catch(() => setGrnJournal(null));
    } catch {
      toast.error(t("grnJournal.errUnexpected"));
    } finally {
      setPostingJournal(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'rolls') return;
    getFabricRollFilterOptions()
      .then(({ grnOptions, itemOptions }) => {
        setRollGrnOptions(grnOptions);
        setRollItemOptions(itemOptions);
      })
      .catch(() => {
        setRollGrnOptions([]);
        setRollItemOptions([]);
      });
  }, [activeTab]);

  useEffect(() => {
    if (rollsSearchDebounceRef.current) clearTimeout(rollsSearchDebounceRef.current);
    rollsSearchDebounceRef.current = setTimeout(() => {
      setRollsSearchDebounced(rollsSearchQuery);
      setRollsPage(1);
      rollsSearchDebounceRef.current = null;
    }, 400);
    return () => {
      if (rollsSearchDebounceRef.current) clearTimeout(rollsSearchDebounceRef.current);
    };
  }, [rollsSearchQuery]);

  useEffect(() => {
    if (stockSearchDebounceRef.current) clearTimeout(stockSearchDebounceRef.current);
    stockSearchDebounceRef.current = setTimeout(() => {
      setStockSearchDebounced(searchQuery);
      setStockPage(1);
      stockSearchDebounceRef.current = null;
    }, 400);
    return () => {
      if (stockSearchDebounceRef.current) clearTimeout(stockSearchDebounceRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab !== 'rolls') return;
    setRollsLoading(true);
    getFabricRolls({
      page: rollsPage,
      pageSize: rollsPageSize,
      ...(rollsFilterGrnId ? { grnId: rollsFilterGrnId } : {}),
      ...(rollsFilterItemId ? { itemId: rollsFilterItemId } : {}),
      ...(rollsSearchDebounced.trim() ? { search: rollsSearchDebounced.trim() } : {}),
    })
      .then((res) => {
        if (Array.isArray(res)) {
          setRolls(res);
          setRollsTotalCount(res.length);
        } else {
          setRolls(res.items);
          setRollsTotalCount(res.totalCount);
        }
      })
      .catch(() => {
        setRolls([]);
        setRollsTotalCount(0);
      })
      .finally(() => setRollsLoading(false));
  }, [activeTab, rollsPage, rollsPageSize, rollsFilterGrnId, rollsFilterItemId, rollsSearchDebounced]);

  const q = (s: string) => s.toLowerCase().trim();
  const filteredGrns = grns.filter(
    (grn) =>
      !grnSearchQuery ||
      q(grn.docNumber).includes(q(grnSearchQuery)) ||
      q(grn.supplier.name).includes(q(grnSearchQuery)) ||
      q(grn.po?.docNumber ?? '').includes(q(grnSearchQuery))
  );

  // Penyesuaian sudah disaring (sumber + pencarian) dan dipaginasi di server.
  const filteredAdjustments = adjustments;
  const opsiSumberPenyesuaian = [
    { value: SARINGAN_SUMBER_BAWAAN, label: tp('adjSourceManual') },
    { value: SARINGAN_SUMBER_OTOMATIS, label: tp('adjSourceAuto') },
    { value: SARINGAN_SUMBER_SEMUA, label: tp('adjSourceAll') },
    ...SUMBER_PENYESUAIAN.map((kode) => ({ value: kode, label: labelJenisGerakan(tKind, kode) })),
  ];

  const setStatusFilter = (status: StockStatus | null) => {
    setStockStatus(status);
    setStockPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <TombolBantuan judul={t("pageTitle")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/backoffice/inventory/grn/new">
            <Button variant="outline" className="min-h-[44px]">
              <ArrowDownLeft className="mr-2 h-4 w-4" />
              {tp('receiveGoods')}
            </Button>
          </Link>
          <Link href="/backoffice/inventory/stock-card">
            <Button variant="outline" className="min-h-[44px]">
              <History className="mr-2 h-4 w-4" />
              {tp('stockCard')}
            </Button>
          </Link>
          <Link href="/backoffice/inventory/adjustment/new">
            <Button className="min-h-[44px]">
              <Plus className="mr-2 h-4 w-4" />
              {tp('adjustment')}
            </Button>
          </Link>
          <Link href="/backoffice/inventory/rejected-goods">
            <Button variant="outline" className="min-h-[44px]">
              {tp('rejectedGoods')}
            </Button>
          </Link>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={async () => {
              try {
                const { logPrint } = await import('@/app/actions/audit');
                await logPrint('InventoryReport', 'snapshot');
                const snap = await getInventoryValueSnapshot();
                const html = buildInventoryReportPrintHtml({
                  generatedAt: snap.generatedAt,
                  asOfDate: snap.asOfDate,
                  summary: snap.summary,
                  details: snap.details,
                  lowStockAlerts: snap.lowStockAlerts,
                });
                const iframe = document.createElement('iframe');
                iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
                iframe.setAttribute('title', tp('printReportFrameTitle'));
                document.body.appendChild(iframe);
                const doc = iframe.contentWindow?.document;
                if (doc) {
                  doc.open();
                  doc.write(html);
                  doc.close();
                  setTimeout(() => {
                    iframe.contentWindow?.print();
                  }, 350);
                }
                setTimeout(() => {
                  document.body.removeChild(iframe);
                }, 1000);
              } catch {
                toast.error(tp('printReportFailed'));
              }
            }}
          >
            <Printer className="mr-2 h-4 w-4" />
            {tp('printReport')}
          </Button>
        </div>
      </div>

      <StockHealthKpis
        summary={summary}
        activeStatus={stockStatus}
        onSelectStatus={setStatusFilter}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="stock">{t("tabStock")}</TabsTrigger>
          <TabsTrigger value="grn">{t("tabGrn")}</TabsTrigger>
          <TabsTrigger value="rolls">{t("tabRolls")}</TabsTrigger>
          <TabsTrigger value="adjustments">{t("tabAdjustments")}</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tWall("searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="w-full sm:w-48">
              <label className="text-xs text-muted-foreground mb-1 block">{tWall("filterStatus")}</label>
              <Select
                value={stockStatus ?? "__all__"}
                onValueChange={(v) => {
                  if (v === "__all__") setStatusFilter(null);
                  else if (isStockStatus(v)) setStatusFilter(v);
                }}
              >
                <SelectTrigger className="w-full min-h-[44px]">
                  <SelectValue placeholder={tWall("filterAllStatuses")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{tWall("filterAllStatuses")}</SelectItem>
                  {STOCK_STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tWall(`status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <label className="text-xs text-muted-foreground mb-1 block">{tWall("sortLabel")}</label>
              <Select
                value={stockSort}
                onValueChange={(v) => {
                  setStockSort(v as StockSort);
                  setStockPage(1);
                }}
              >
                <SelectTrigger className="w-full min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock_desc">{tWall("sortStockDesc")}</SelectItem>
                  <SelectItem value="stock_asc">{tWall("sortStockAsc")}</SelectItem>
                  <SelectItem value="sku">{tWall("sortSku")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {stockStatus && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {tWall("showingFilter", { status: tWall(`status.${stockStatus}`) })}
                {" "}({stockTotalCount})
              </Badge>
              <Link
                href="/backoffice/inventory?tab=stock"
                className="text-sm text-muted-foreground hover:underline"
                onClick={() => setStatusFilter(null)}
              >
                {tWall("clearFilter")}
              </Link>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : inventory.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Package className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="font-medium">{tWall("emptyTitle")}</p>
                <p className="text-sm text-muted-foreground mt-1">{tWall("emptyHint")}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {inventory.map((item) => (
                <StockItemCard key={item.itemId} item={item} />
              ))}
            </div>
          )}

          <Pagination
            page={stockPage}
            totalPages={Math.max(1, Math.ceil(stockTotalCount / stockPageSize))}
            onPageChange={setStockPage}
            totalCount={stockTotalCount}
            pageSize={stockPageSize}
          />
        </TabsContent>

        <TabsContent value="grn" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={tp('grnSearchPlaceholder')}
              value={grnSearchQuery}
              onChange={(e) => setGrnSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>{tp('grnNumber')}</TableHead>
                      <TableHead>{tTable('date')}</TableHead>
                      <TableHead>{tTable('supplier')}</TableHead>
                      <TableHead>{tp('poReference')}</TableHead>
                      <TableHead className="text-right">{tTable('amount')}</TableHead>
                      <TableHead className="min-w-[200px]">{tTable('overReceive')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGrns.map((grn) => (
                      <Fragment key={grn.id}>
                        <TableRow>
                          <TableCell className="w-10">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setExpandedGrnId(expandedGrnId === grn.id ? null : grn.id)
                              }
                              aria-label={tp('toggleRolls', { doc: grn.docNumber })}
                              aria-expanded={expandedGrnId === grn.id}
                            >
                              {expandedGrnId === grn.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{grn.docNumber}</TableCell>
                          <TableCell>
                            {formatDisplayDate(grn.grnDate, locale)}
                          </TableCell>
                          <TableCell className="whitespace-normal min-w-[160px]">{grn.supplier.name}</TableCell>
                          <TableCell>{grn.po?.docNumber || '-'}</TableCell>
                          <TableCell className="text-right">
                            Rp {Number(grn.totalAmount).toLocaleString('id-ID')}
                          </TableCell>
                          <TableCell>
                            {grn.ownerDeclinedAt ? (
                              <Badge variant="outline" className="border-destructive/50 text-destructive w-fit">
                                {tp('declinedByOwner')}
                              </Badge>
                            ) : grn.requiresOwnerApproval && !grn.ownerApprovedAt ? (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400 w-fit">
                                  {tp('awaitingOwnerApproval')}
                                </Badge>
                                {/* Pemilik = admin sistem (izin `*`), sama dengan penjaga server. */}
                                {session?.user?.permissions?.includes('*') && (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="w-fit"
                                      disabled={approvingGrnId === grn.id || decliningGrnId === grn.id}
                                      onClick={async () => {
                                        if (!session?.user?.id) return;
                                        setApprovingGrnId(grn.id);
                                        try {
                                          await approveGRNByOwner(grn.id, session.user.id);
                                          toast.success(tp('grnApprovedToast'));
                                          await fetchData();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error ? err.message : tp('grnApproveFailed')
                                          );
                                        } finally {
                                          setApprovingGrnId(null);
                                        }
                                      }}
                                    >
                                      {tp('approve')}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="w-fit text-destructive hover:text-destructive"
                                      disabled={approvingGrnId === grn.id || decliningGrnId === grn.id}
                                      onClick={async () => {
                                        if (!session?.user?.id) return;
                                        if (
                                          !window.confirm(tp('grnDeclineConfirm'))
                                        ) {
                                          return;
                                        }
                                        setDecliningGrnId(grn.id);
                                        try {
                                          await declineGRNByOwner(grn.id, session.user.id);
                                          toast.success(tp('grnDeclinedToast'));
                                          await fetchData();
                                        } catch (err) {
                                          toast.error(
                                            err instanceof Error ? err.message : tp('grnDeclineFailed')
                                          );
                                        } finally {
                                          setDecliningGrnId(null);
                                        }
                                      }}
                                    >
                                      {tp('decline')}
                                    </Button>
                                  </>
                                )}
                              </div>
                            ) : grn.ownerApprovedAt ? (
                              <span className="text-xs text-muted-foreground">{tp('ownerApproved')}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedGrnId === grn.id && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/30 p-4">
                              <p className="text-sm font-medium mb-2">{tp('rollsInGrn')}</p>
                              {grnRolls.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{tp('noRolls')}</p>
                              ) : (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{tTable('rollCode')}</TableHead>
                                      <TableHead>{tTable('ref')}</TableHead>
                                      <TableHead>{tTable('item')}</TableHead>
                                      <TableHead className="text-right">{tTable('initial')}</TableHead>
                                      <TableHead className="text-right">{tTable('remaining')}</TableHead>
                                      <TableHead>{tTable('uom')}</TableHead>
                                      <TableHead>{tTable('status')}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {grnRolls.map((r) => (
                                      <TableRow key={r.id}>
                                        <TableCell className="font-mono text-sm">{r.rollCode}</TableCell>
                                        <TableCell>{r.rollRef}</TableCell>
                                        <TableCell>{r.item.sku} – {r.item.nameId}</TableCell>
                                        <TableCell className="text-right">{r.initialLength.toLocaleString('id-ID')}</TableCell>
                                        <TableCell className="text-right">{r.remainingLength.toLocaleString('id-ID')}</TableCell>
                                        <TableCell>{r.uom.code}</TableCell>
                                        <TableCell>{r.isClosed ? <Badge variant="secondary">{tp('rollClosed')}</Badge> : <Badge variant="default">{tp('rollOpen')}</Badge>}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              )}

                              {grnJournal && (
                                <div className="flex flex-wrap items-center gap-2 pt-4">
                                  {grnJournal.receiptJournalId ? (
                                    <>
                                      <Badge variant="default">{t("grnJournal.posted")}</Badge>
                                      <Button asChild variant="outline" size="sm">
                                        <Link href={`/backoffice/finance/journals/${grnJournal.receiptJournalId}`}>
                                          {t("grnJournal.viewJournal")}
                                        </Link>
                                      </Button>
                                    </>
                                  ) : grnJournal.hasPostableReceiptJournal && canPostJournal ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={postingJournal}
                                      onClick={() => handlePostJournal(grn.id, "receipt")}
                                    >
                                      {t("grnJournal.postJournal")}
                                    </Button>
                                  ) : null}

                                  {grn.ownerDeclinedAt &&
                                    (grnJournal.reversalJournalId ? (
                                      <>
                                        <Badge variant="secondary">{t("grnJournal.reversalPosted")}</Badge>
                                        <Button asChild variant="outline" size="sm">
                                          <Link href={`/backoffice/finance/journals/${grnJournal.reversalJournalId}`}>
                                            {t("grnJournal.viewJournal")}
                                          </Link>
                                        </Button>
                                      </>
                                    ) : grnJournal.hasPostableReversalJournal && canPostJournal ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={postingJournal}
                                        onClick={() => handlePostJournal(grn.id, "reversal")}
                                      >
                                        {t("grnJournal.postReversal")}
                                      </Button>
                                    ) : null)}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={grnPage}
                totalPages={Math.max(1, Math.ceil(grnTotalCount / grnPageSize))}
                onPageChange={setGrnPage}
                totalCount={grnTotalCount}
                pageSize={grnPageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rolls" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tp('rollsSearchPlaceholder')}
                value={rollsSearchQuery}
                onChange={(e) => setRollsSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{tp('filterByGrn')}</span>
              <SearchableCombobox
                options={[{ value: ROLLS_FILTER_ALL, label: tp('allGrns') }, ...rollGrnOptions]}
                value={rollsFilterGrnId}
                onValueChange={(value) => {
                  setRollsFilterGrnId(value);
                  setRollsPage(1);
                }}
                placeholder={tp('allGrns')}
                searchPlaceholder={tp('searchGrn')}
                triggerClassName="w-[220px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{tp('filterByItem')}</span>
              <SearchableCombobox
                options={[{ value: ROLLS_FILTER_ALL, label: tp('allItems') }, ...rollItemOptions]}
                value={rollsFilterItemId}
                onValueChange={(value) => {
                  setRollsFilterItemId(value);
                  setRollsPage(1);
                }}
                placeholder={tp('allItems')}
                searchPlaceholder={tp('searchItem')}
                triggerClassName="w-[260px]"
              />
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              {rollsLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tTable('rollCode')}</TableHead>
                          <TableHead>{tTable('ref')}</TableHead>
                          <TableHead>{tTable('item')}</TableHead>
                          <TableHead className="text-right">{tTable('initial')}</TableHead>
                          <TableHead className="text-right">{tTable('remaining')}</TableHead>
                          <TableHead>{tTable('uom')}</TableHead>
                          <TableHead>GRN</TableHead>
                          <TableHead>{tTable('status')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rolls.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                              {tp('noFabricRolls')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          rolls.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-sm">{r.rollCode}</TableCell>
                              <TableCell>{r.rollRef}</TableCell>
                              <TableCell className="whitespace-normal min-w-[180px]">{r.item.sku} – {r.item.nameId}</TableCell>
                              <TableCell className="text-right">
                                {(r.initialLength ?? 0).toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell className="text-right">
                                {(r.remainingLength ?? 0).toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell>{r.uom.code}</TableCell>
                              <TableCell>{r.grn ? `${r.grn.docNumber} (${formatDisplayDate(r.grn.grnDate, locale)})` : '-'}</TableCell>
                              <TableCell>{r.isClosed ? <Badge variant="secondary">{tp('rollClosed')}</Badge> : <Badge variant="default">{tp('rollOpen')}</Badge>}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={rollsPage}
                    totalPages={Math.max(1, Math.ceil(rollsTotalCount / rollsPageSize))}
                    onPageChange={setRollsPage}
                    totalCount={rollsTotalCount}
                    pageSize={rollsPageSize}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="adjustments" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tp('adjSearchPlaceholder')}
                value={adjustmentSearchQuery}
                onChange={(e) => setAdjustmentSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{tp('filterByItem')}</span>
              <SearchableCombobox
                options={[
                  { value: ADJ_FILTER_ALL, label: tp('allItems') },
                  ...adjustmentItemList.map((row) => ({
                    value: row.itemId,
                    label: `${row.item?.sku ?? row.itemId} – ${row.item?.nameId ?? ''}`,
                  })),
                ]}
                value={adjItemFilter}
                onValueChange={(value) => {
                  setAdjItemFilter(value);
                  setAdjPage(1);
                }}
                placeholder={tp('allItems')}
                triggerClassName="w-[220px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">{tp('adjSourceFilter')}</span>
              <SearchableCombobox
                options={opsiSumberPenyesuaian}
                value={adjSumber}
                onValueChange={(value) => {
                  setAdjSumber(value || SARINGAN_SUMBER_BAWAAN);
                  setAdjPage(1);
                }}
                placeholder={tp('adjSourceManual')}
                triggerClassName="w-[240px]"
              />
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>{tp('docNumber')}</TableHead>
                      <TableHead>{tTable('date')}</TableHead>
                      <TableHead>{tTable('item')}</TableHead>
                      <TableHead>{tTable('type')}</TableHead>
                      <TableHead className="text-right">{tTable('qty')}</TableHead>
                      <TableHead>{tp('colSource')}</TableHead>
                      <TableHead>{tp('reason')}</TableHead>
                      {/* Pembuat disembunyikan di bawah 2xl supaya kolom Nota
                          tidak terdorong keluar layar 1280 px. */}
                      <TableHead className="hidden 2xl:table-cell">{tp('createdBy')}</TableHead>
                      <TableHead className="w-[100px] sticky right-0 bg-card">{tp('actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAdjustments.map((adj) => (
                      <Fragment key={adj.id}>
                        <TableRow>
                          <TableCell className="w-10">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setExpandedAdjustmentId(expandedAdjustmentId === adj.id ? null : adj.id)
                              }
                              aria-label={tp('toggleDetails', { doc: adj.docNumber })}
                              aria-expanded={expandedAdjustmentId === adj.id}
                            >
                              {expandedAdjustmentId === adj.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">{adj.docNumber}</TableCell>
                          <TableCell>
                            {formatDisplayDate(adj.createdAt, locale)}
                          </TableCell>
                          <TableCell className="whitespace-normal min-w-[160px]">{adj.item.nameId}</TableCell>
                          <TableCell>
                            <Badge variant={adj.type === 'POSITIVE' ? 'default' : 'destructive'}>
                              {adj.type === 'POSITIVE' ? (
                                <ArrowDownLeft className="h-3 w-3 mr-1" />
                              ) : (
                                <ArrowUpRight className="h-3 w-3 mr-1" />
                              )}
                              {adj.type === 'POSITIVE' ? tp('adjPositive') : tp('adjNegative')}
                            </Badge>
                          </TableCell>
                          {/* Tanda qtyChange tidak seragam antar-penulis; arah sudah di lencana Jenis. */}
                          <TableCell className="text-right">
                            {Math.abs(Number(adj.qtyChange)).toLocaleString('id-ID')}
                          </TableCell>
                          <TableCell className="whitespace-normal min-w-[140px] text-sm">
                            {labelJenisGerakan(tKind, adj.source)}
                          </TableCell>
                          <TableCell className="whitespace-normal min-w-[200px] max-w-[320px]">{adj.reason}</TableCell>
                          <TableCell className="hidden 2xl:table-cell text-sm text-muted-foreground">
                            {adj.createdBy?.name || adj.createdBy?.email || '—'}
                          </TableCell>
                          <TableCell className="sticky right-0 bg-card">
                            <Link href={`/backoffice/inventory/adjustment/${adj.id}`}>
                              <Button variant="ghost" size="sm">
                                <Printer className="mr-1 h-3 w-3" />
                                Nota
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                        {expandedAdjustmentId === adj.id && (
                          <TableRow>
                            <TableCell colSpan={10}>
                              <div className="grid gap-4 py-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold">{tp('reason')}</p>
                                  <p className="text-sm text-muted-foreground">{adj.reason}</p>
                                </div>
                                <div className="space-y-1 2xl:hidden">
                                  <p className="text-sm font-semibold">{tp('createdBy')}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {adj.createdBy?.name || adj.createdBy?.email || '—'}
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold">{tp('evidence')}</p>
                                  {adj.evidenceUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- dynamic evidence URL from storage
                                    <img
                                      src={adj.evidenceUrl}
                                      alt={tp('evidenceAlt')}
                                      className="max-h-40 rounded-md border object-cover"
                                    />
                                  ) : (
                                    <p className="text-sm text-muted-foreground">{t('noImageProvided')}</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                    {filteredAdjustments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                          {tp('adjEmpty')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={adjPage}
                totalPages={Math.max(1, Math.ceil(adjTotalCount / adjPageSize))}
                onPageChange={setAdjPage}
                totalCount={adjTotalCount}
                pageSize={adjPageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
