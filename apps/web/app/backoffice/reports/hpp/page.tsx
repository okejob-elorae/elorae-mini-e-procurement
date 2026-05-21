'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, Calculator, HelpCircle, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Card,
  CardContent,
  CardDescription,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { getHPPList, type HPPBreakdown } from '@/app/actions/hpp';
import { updateWOHppAdjustments } from '@/app/actions/production';
import { getItemsByType } from '@/app/actions/items';
import { ItemType } from '@prisma/client';
import { toast } from 'sonner';

const fmt = (n: number | null | undefined) =>
  n != null ? `Rp ${n.toLocaleString('id-ID', { minimumFractionDigits: 2 })}` : '—';
const fmtNum = (n: number | null | undefined) =>
  n != null ? n.toLocaleString('id-ID', { minimumFractionDigits: 2 }) : '—';

export default function HPPPage() {
  const t = useTranslations('hpp');
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  const [rows, setRows] = useState<HPPBreakdown[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [finishedGoods, setFinishedGoods] = useState<Array<{ value: string; label: string }>>([]);
  const [vendors, setVendors] = useState<Array<{ value: string; label: string }>>([]);

  const [filterFg, setFilterFg] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterVendor, setFilterVendor] = useState('');

  const [detailRow, setDetailRow] = useState<HPPBreakdown | null>(null);
  const [editMargin, setEditMargin] = useState<string>('');
  const [editAdditional, setEditAdditional] = useState<string>('');
  const [savingAdjustments, setSavingAdjustments] = useState(false);
  const [selectedWoIds, setSelectedWoIds] = useState<Set<string>>(new Set());
  const [bulkMarginOpen, setBulkMarginOpen] = useState(false);
  const [bulkMarginValue, setBulkMarginValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const loadData = useCallback(() => {
    setIsLoading(true);
    const dateFrom = filterDateFrom ? new Date(filterDateFrom + 'T00:00:00') : undefined;
    const dateTo = filterDateTo
      ? new Date(filterDateTo + 'T23:59:59.999')
      : undefined;
    getHPPList({
      finishedGoodId: filterFg || undefined,
      dateFrom,
      dateTo,
      vendorId: filterVendor || undefined,
    })
      .then(setRows)
      .catch((err) => {
        setRows([]);
        toast.error(err instanceof Error ? err.message : t('failedToLoadData'));
      })
      .finally(() => setIsLoading(false));
  }, [filterFg, filterDateFrom, filterDateTo, filterVendor, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    Promise.all([
      getItemsByType(ItemType.FINISHED_GOOD),
      fetch('/api/suppliers?approvedOnly=true').then((r) => r.ok ? r.json() : []),
    ]).then(([fgList, supList]) => {
      const fg = (fgList as Array<{ id: string; sku: string; nameId: string }>) ?? [];
      setFinishedGoods(fg.map((x) => ({ value: x.id, label: `${x.nameId} (${x.sku})` })));
      const list = Array.isArray(supList) ? supList : (supList?.data ?? []);
      setVendors(list.map((x: { id: string; name: string; code?: string }) => ({ value: x.id, label: `${x.name} (${x.code ?? ''})` })));
    }).catch(() => {});
  }, []);

  const openDetail = (row: HPPBreakdown) => {
    setDetailRow(row);
    setEditMargin(row.marginPercent != null ? String(row.marginPercent) : '');
    setEditAdditional(row.additionalCost != null ? String(row.additionalCost) : '');
  };

  const toggleSelectWo = (woId: string) => {
    setSelectedWoIds((prev) => {
      const next = new Set(prev);
      if (next.has(woId)) next.delete(woId);
      else next.add(woId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedWoIds.size === rows.length) {
      setSelectedWoIds(new Set());
    } else {
      setSelectedWoIds(new Set(rows.map((r) => r.woId)));
    }
  };

  const handleBulkSetMargin = async () => {
    if (!isAdmin || selectedWoIds.size === 0) return;
    const margin = bulkMarginValue.trim() === '' ? undefined : parseFloat(bulkMarginValue);
    if (margin !== undefined && (Number.isNaN(margin) || margin < 0)) {
      toast.error('Margin must be ≥ 0');
      return;
    }
    setBulkSaving(true);
    try {
      for (const woId of selectedWoIds) {
        await updateWOHppAdjustments(woId, { hppMarginPercent: margin });
      }
      toast.success(`Margin set for ${selectedWoIds.size} work order(s)`);
      setBulkMarginOpen(false);
      setBulkMarginValue('');
      setSelectedWoIds(new Set());
      loadData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to set margin');
    } finally {
      setBulkSaving(false);
    }
  };

  const handleSaveAdjustments = async () => {
    if (!detailRow || !isAdmin) return;
    setSavingAdjustments(true);
    try {
      const margin = editMargin === '' ? undefined : parseFloat(editMargin);
      const additional = editAdditional === '' ? undefined : parseFloat(editAdditional);
      if (margin !== undefined && (Number.isNaN(margin) || margin < 0)) {
        toast.error('Margin must be ≥ 0');
        return;
      }
      if (additional !== undefined && (Number.isNaN(additional) || additional < 0)) {
        toast.error('Additional cost must be ≥ 0');
        return;
      }
      await updateWOHppAdjustments(detailRow.woId, {
        hppMarginPercent: margin,
        hppAdditionalCost: additional,
      });
      toast.success('HPP adjustments saved');
      const updated = await getHPPList({
        finishedGoodId: filterFg || undefined,
        dateFrom: filterDateFrom ? new Date(filterDateFrom) : undefined,
        dateTo: filterDateTo ? new Date(filterDateTo) : undefined,
        vendorId: filterVendor || undefined,
      });
      const found = updated.find((r) => r.woId === detailRow.woId);
      if (found) setDetailRow(found);
      setRows(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingAdjustments(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-start gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 rounded-full h-8 w-8" aria-label={t('helpAriaLabel')}>
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] sm:w-[400px] p-4" align="start">
              <h3 className="font-semibold mb-2">{t('helpTitle')}</h3>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>{t('helpIntro')}</p>
                <p>{t('helpTableExplanation')}</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>{t('finishedGood')}</Label>
              <SearchableCombobox
                options={[{ value: '', label: '—' }, ...finishedGoods]}
                value={filterFg}
                onValueChange={setFilterFg}
                placeholder={t('finishedGood')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('dateFrom')}</Label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('dateTo')}</Label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('vendor')}</Label>
              <SearchableCombobox
                options={[{ value: '', label: '—' }, ...vendors]}
                value={filterVendor}
                onValueChange={setFilterVendor}
                placeholder={t('vendor')}
              />
            </div>
            <Button onClick={loadData} disabled={isLoading}>
              {t('applyFilters')}
            </Button>
          </div>
          <CardTitle className="pt-2">{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Calculator className="h-12 w-12 mb-4" />
              <p>{t('noRows')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {isAdmin && selectedWoIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setBulkMarginOpen(true)}
                  >
                    Set margin ({selectedWoIds.size} selected)
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedWoIds(new Set())}>
                    Clear selection
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {isAdmin && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && selectedWoIds.size === rows.length}
                          onChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    <TableHead>{t('woDocNumber')}</TableHead>
                    <TableHead>{t('articleFg')}</TableHead>
                    <TableHead className="text-right">{t('actualQty')}</TableHead>
                    <TableHead className="text-right">{t('fabricCostPcs')}</TableHead>
                    <TableHead className="text-right">{t('accessoriesCostPcs')}</TableHead>
                    <TableHead className="text-right">{t('serviceCostPcs')}</TableHead>
                    <TableHead className="text-right">{t('hppPcs')}</TableHead>
                    <TableHead>{t('ppnStatus')}</TableHead>
                    <TableHead className="text-right">{t('marginPercent')}</TableHead>
                    <TableHead className="text-right">{t('sellingPrice')}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.woId}>
                      {isAdmin && (
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedWoIds.has(row.woId)}
                            onChange={() => toggleSelectWo(row.woId)}
                            aria-label={`Select ${row.woDocNumber}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{row.woDocNumber}</TableCell>
                      <TableCell>{row.finishedGoodSku} — {row.finishedGoodName}</TableCell>
                      <TableCell className="text-right">{fmtNum((row as { actualQty?: number }).actualQty ?? row.plannedQty)}</TableCell>
                      <TableCell className="text-right">{fmt(row.fabricCostPerPcs)}</TableCell>
                      <TableCell className="text-right">{fmt(row.accessoriesCostPerPcs)}</TableCell>
                      <TableCell className="text-right">{fmt(row.serviceCostPerPcs)}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(row.subtotal)}</TableCell>
                      <TableCell>
                        <Badge variant={row.hasMixedPPN ? 'secondary' : 'outline'}>
                          {row.hasMixedPPN ? t('ppnMixed') : t('ppnOk')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.marginPercent != null ? `${fmtNum(row.marginPercent)}%` : '—'}</TableCell>
                      <TableCell className="text-right">{fmt(row.sellingPrice)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openDetail(row)}
                          className="border-muted-foreground/25 hover:border-muted-foreground/50"
                          aria-label={`${t('detail')} — ${row.woDocNumber}`}
                        >
                          <Eye className="h-4 w-4" />
                          {t('detail')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={bulkMarginOpen} onOpenChange={(open) => !open && setBulkMarginOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set margin for selected work orders</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Margin %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={bulkMarginValue}
                onChange={(e) => setBulkMarginValue(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkMarginOpen(false)}>Cancel</Button>
              <Button onClick={handleBulkSetMargin} disabled={bulkSaving}>
                {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Apply to {selectedWoIds.size} WO(s)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-2xl lg:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('detailTitle')} — {detailRow?.woDocNumber}</DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('category')}</TableHead>
                    <TableHead>{t('itemName')}</TableHead>
                    <TableHead className="text-right">{t('unitCost')}</TableHead>
                    <TableHead className="text-right">{t('qtyPerPcs')}</TableHead>
                    <TableHead className="text-right">{t('costPerPcs')}</TableHead>
                    <TableHead className="text-right">Final Price</TableHead>
                    <TableHead>{t('ppnIncluded')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRow.lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{line.category}</TableCell>
                      <TableCell>{line.itemName}</TableCell>
                      <TableCell className="text-right">{fmt(line.unitCost)}</TableCell>
                      <TableCell className="text-right">{fmtNum(line.qtyPerPcs)}</TableCell>
                      <TableCell className="text-right">{fmt(line.costPerPcs)}</TableCell>
                      <TableCell className="text-right">{fmt((line as { nettCostPerPcs?: number }).nettCostPerPcs ?? line.costPerPcs)}</TableCell>
                      <TableCell>{line.ppnIncluded ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-wrap gap-4 pt-2 border-t">
                <div className="font-medium">
                  Subtotal (HPP/pcs):{' '}
                  {fmt(
                    (detailRow as { nettSubtotal?: number }).nettSubtotal ??
                      detailRow.subtotal
                  )}
                </div>
                {detailRow.hasMixedPPN && (
                  <Badge variant="secondary">{t('ppnMixed')}</Badge>
                )}
              </div>
              {isAdmin && (
                <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t">
                  <div className="space-y-2">
                    <Label>{t('marginPercentEdit')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={editMargin}
                      onChange={(e) => setEditMargin(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('additionalCostEdit')}</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={editAdditional}
                      onChange={(e) => setEditAdditional(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button onClick={handleSaveAdjustments} disabled={savingAdjustments}>
                      {savingAdjustments ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {t('saveAdjustments')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
