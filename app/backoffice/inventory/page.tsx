'use client';

import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  Package, 
  ArrowDownLeft,
  ArrowUpRight,
  History,
  AlertTriangle,
  TrendingUp,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { getInventorySnapshot } from '@/lib/inventory/costing';
import { getGRNs } from '@/app/actions/grn';
import { getStockAdjustments } from '@/app/actions/inventory';

interface InventoryItem {
  itemId: string;
  qtyOnHand: string;
  avgCost: string;
  totalValue: string;
  item: {
    sku: string;
    nameId: string;
    nameEn: string;
    type: string;
    reorderPoint: string | null;
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
  createdAt: string;
  evidenceUrl?: string | null;
  item: {
    sku: string;
    nameId: string;
  };
  createdBy?: { name: string | null; email: string | null } | null;
  approvedBy?: { name: string | null } | null;
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [grns, setGRNs] = useState<GRN[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [grnSearchQuery, setGrnSearchQuery] = useState('');
  const [adjustmentSearchQuery, setAdjustmentSearchQuery] = useState('');
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    totalItems: 0,
    totalValue: 0,
    lowStockItems: 0
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [invData, grnData, adjData] = await Promise.all([
        getInventorySnapshot(),
        getGRNs(),
        getStockAdjustments()
      ]);
      
      setInventory(invData.items as unknown as InventoryItem[]);
      setSummary({
        totalItems: invData.totalItems,
        totalValue: invData.totalValue,
        lowStockItems: invData.lowStockItems
      });
      setGRNs(grnData as unknown as GRN[]);
      setAdjustments(adjData as unknown as Adjustment[]);
    } catch (_error) {
      toast.error('Failed to load inventory data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const isLowStock = (item: InventoryItem) => {
    if (!item.item.reorderPoint) return false;
    return Number(item.qtyOnHand) <= Number(item.item.reorderPoint);
  };

  const filteredInventory = inventory.filter(item =>
    item.item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.item.nameId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const q = (s: string) => s.toLowerCase().trim();
  const filteredGrns = grns.filter(
    (grn) =>
      !grnSearchQuery ||
      q(grn.docNumber).includes(q(grnSearchQuery)) ||
      q(grn.supplier.name).includes(q(grnSearchQuery)) ||
      q(grn.po?.docNumber ?? '').includes(q(grnSearchQuery))
  );

  const filteredAdjustments = adjustments.filter(
    (adj) =>
      !adjustmentSearchQuery ||
      q(adj.docNumber).includes(q(adjustmentSearchQuery)) ||
      q(adj.item.sku).includes(q(adjustmentSearchQuery)) ||
      q(adj.item.nameId).includes(q(adjustmentSearchQuery)) ||
      q(adj.reason).includes(q(adjustmentSearchQuery))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Track stock levels, movements, and valuations
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/backoffice/inventory/grn/new">
            <Button variant="outline" className="min-h-[44px]">
              <ArrowDownLeft className="mr-2 h-4 w-4" />
              Receive Goods
            </Button>
          </Link>
          <Link href="/backoffice/inventory/stock-card">
            <Button variant="outline" className="min-h-[44px]">
              <History className="mr-2 h-4 w-4" />
              Stock Card
            </Button>
          </Link>
          <Link href="/backoffice/inventory/adjustment/new">
            <Button className="min-h-[44px]">
              <Plus className="mr-2 h-4 w-4" />
              Adjustment
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalItems}</div>
            <p className="text-xs text-muted-foreground">
              Active SKUs in system
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              Rp {summary.totalValue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              Current inventory value
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.lowStockItems}</div>
            <p className="text-xs text-muted-foreground">
              Items below reorder point
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stock" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stock">Stock Levels</TabsTrigger>
          <TabsTrigger value="grn">Goods Receipts</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Avg Cost</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInventory.map((item) => (
                        <TableRow key={item.itemId}>
                          <TableCell className="font-medium">{item.item.sku}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isLowStock(item) && (
                                <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                              )}
                              <div>
                                <p className="font-medium">{item.item.nameId}</p>
                                <p className="text-sm text-muted-foreground">{item.item.nameEn}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{item.item.uom.code}</TableCell>
                          <TableCell className="text-right">
                            {Number(item.qtyOnHand).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            Rp {Number(item.avgCost).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            Rp {Number(item.totalValue).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grn" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search GRN number, supplier, PO..."
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
                      <TableHead>GRN Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>PO Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGrns.map((grn) => (
                      <TableRow key={grn.id}>
                        <TableCell className="font-medium">{grn.docNumber}</TableCell>
                        <TableCell>
                          {new Date(grn.grnDate).toLocaleDateString('id-ID')}
                        </TableCell>
                        <TableCell>{grn.supplier.name}</TableCell>
                        <TableCell>{grn.po?.docNumber || '-'}</TableCell>
                        <TableCell className="text-right">
                          Rp {Number(grn.totalAmount).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="adjustments" className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search doc number, item, reason..."
              value={adjustmentSearchQuery}
              onChange={(e) => setAdjustmentSearchQuery(e.target.value)}
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
                      <TableHead>Doc Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Created by</TableHead>
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
                              aria-label="Toggle details"
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
                            {new Date(adj.createdAt).toLocaleDateString('id-ID')}
                          </TableCell>
                          <TableCell>{adj.item.nameId}</TableCell>
                          <TableCell>
                            <Badge variant={adj.type === 'POSITIVE' ? 'default' : 'destructive'}>
                              {adj.type === 'POSITIVE' ? (
                                <ArrowDownLeft className="h-3 w-3 mr-1" />
                              ) : (
                                <ArrowUpRight className="h-3 w-3 mr-1" />
                              )}
                              {adj.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(adj.qtyChange).toLocaleString()}
                          </TableCell>
                          <TableCell>{adj.reason}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {adj.createdBy?.name || adj.createdBy?.email || '—'}
                          </TableCell>
                        </TableRow>
                        {expandedAdjustmentId === adj.id && (
                          <TableRow>
                            <TableCell colSpan={8}>
                              <div className="grid gap-4 py-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold">Reason</p>
                                  <p className="text-sm text-muted-foreground">{adj.reason}</p>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold">Evidence</p>
                                  {adj.evidenceUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- dynamic evidence URL from storage
                                    <img
                                      src={adj.evidenceUrl}
                                      alt="Adjustment evidence"
                                      className="max-h-40 rounded-md border object-cover"
                                    />
                                  ) : (
                                    <p className="text-sm text-muted-foreground">No image provided</p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
