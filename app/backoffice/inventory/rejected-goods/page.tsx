'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getRejectedGoodsRecap } from '@/app/actions/inventory';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';

export default function RejectedGoodsPage() {
  const [data, setData] = useState<{ items: Awaited<ReturnType<typeof getRejectedGoodsRecap>>['items']; totalCount: number }>({
    items: [],
    totalCount: 0,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag synced to async fetch
    setIsLoading(true);
    getRejectedGoodsRecap({ page, pageSize })
      .then(setData)
      .catch(() => setData({ items: [], totalCount: 0 }))
      .finally(() => setIsLoading(false));
  }, [page, pageSize]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/inventory">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rejected Goods</h1>
          <p className="text-muted-foreground">
            Recap of rejected / waste quantities (not in active inventory)
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rejected goods ledger</CardTitle>
          <CardDescription>
            Items recorded as rejected on FG receipt. These quantities are stored separately from active stock.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : data.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mb-4" />
              <p>No rejected goods recorded yet.</p>
              <p className="text-sm mt-1">Rejected qty is recorded when you receive FG with &quot;Rejected&quot; &gt; 0.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Item (SKU)</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Rejected Qty</TableHead>
                      <TableHead>WO</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {new Date(row.receivedAt).toLocaleDateString('id-ID')}
                        </TableCell>
                        <TableCell className="font-medium">{row.refDocNumber}</TableCell>
                        <TableCell>{row.item.sku}</TableCell>
                        <TableCell>{row.item.nameId}</TableCell>
                        <TableCell className="text-right">
                          {row.qty.toLocaleString()}
                        </TableCell>
                        <TableCell>{row.woId ?? '—'}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-muted-foreground">
                          {row.notes ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={page}
                totalPages={Math.max(1, Math.ceil(data.totalCount / pageSize))}
                onPageChange={setPage}
                totalCount={data.totalCount}
                pageSize={pageSize}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
