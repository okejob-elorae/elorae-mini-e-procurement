'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { getStockCard } from '@/app/actions/stock-card';
import { getCurrentStockSummary } from '@/app/actions/stock-card';
import { toast } from 'sonner';

const defaultFrom = startOfDay(subDays(new Date(), 30));
const defaultTo = endOfDay(new Date());

export default function StockCardPage() {
  const [itemId, setItemId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(format(defaultFrom, 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(defaultTo, 'yyyy-MM-dd'));
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getCurrentStockSummary>>>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getStockCard>> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const list = await getCurrentStockSummary();
      setSummary(list);
    } catch {
      toast.error('Failed to load items');
    }
  }, []);

  const loadStockCard = useCallback(async () => {
    if (!itemId) {
      toast.error('Select an item');
      return;
    }
    setIsLoading(true);
    try {
      const from = startOfDay(new Date(dateFrom));
      const to = endOfDay(new Date(dateTo));
      const result = await getStockCard(itemId, { from, to });
      setData(result);
      setLoadedOnce(true);
    } catch {
      toast.error('Failed to load stock card');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [itemId, dateFrom, dateTo]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleExport = () => {
    if (!data) return;
    const headers = [
      'Tanggal',
      'Dokumen',
      'Keterangan',
      'Masuk',
      'Keluar',
      'Sisa',
      'Harga Satuan',
      'Nilai Persediaan',
    ];
    const rows = data.movements.map((m) => [
      format(new Date(m.date), 'yyyy-MM-dd HH:mm'),
      m.docNumber,
      m.description,
      m.in ?? '',
      m.out ?? '',
      m.balance,
      m.unitCost ?? '',
      m.balanceValue,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-card-${data.item?.sku ?? itemId}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Card</h1>
          <p className="text-muted-foreground">
            Movement history and running balance by item
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Item</Label>
              <Select
                value={itemId}
                onValueChange={(v) => {
                  setItemId(v);
                  setData(null);
                }}
              >
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {summary.map((s) => (
                    <SelectItem key={s.itemId} value={s.itemId}>
                      {s.item?.sku ?? '-'} – {s.item?.nameId ?? '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>From date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>To date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={loadStockCard}
                disabled={isLoading || !itemId}
                className="min-h-[44px] w-full"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Load'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {data.item?.sku} – {data.item?.nameId}
              {data.item?.uom && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({data.item.uom.code})
                </span>
              )}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleExport} className="min-h-[44px]">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Opening balance</p>
                <p className="text-lg font-semibold">
                  {data.openingBalance.toLocaleString()} {data.item?.uom?.code ?? ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  Rp {data.openingValue.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Closing balance</p>
                <p className="text-lg font-semibold">
                  {data.closingBalance.toLocaleString()} {data.item?.uom?.code ?? ''}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Dokumen</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead className="text-right text-green-600 dark:text-green-400">Masuk</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">Keluar</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="text-right">Nilai Persediaan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{format(new Date(m.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                      <TableCell className="font-medium">{m.docNumber}</TableCell>
                      <TableCell>{m.description}</TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {m.in != null ? m.in.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400">
                        {m.out != null ? m.out.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.balance.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.unitCost != null
                          ? `Rp ${m.unitCost.toLocaleString()}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {m.balanceValue.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {loadedOnce && data && data.movements.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No movements in the selected date range.
        </p>
      )}
    </div>
  );
}
