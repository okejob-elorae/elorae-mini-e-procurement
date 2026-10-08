'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
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
import { getRejectedGoodsRecap } from '@/app/actions/inventory';
import { Pagination } from '@/components/ui/pagination';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDate } from '@/lib/date-only';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { TAUTAN_DOKUMEN } from '@/app/backoffice/purchase-orders/tautan-dokumen';

export default function RejectedGoodsPage() {
  const t = useTranslations('inventory.rejected');
  const locale = useLocale();
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
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('backToInventory')}
            title={t('backToInventory')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <TombolBantuan judul={t('title')} />
        </div>
        {/* Barang jelek dari retur toko ada di tempat lain — saling ditautkan. */}
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <Link href="/backoffice/gudang-rusak">{t('keGudangRusak')}</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : data.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mb-4" />
              <p>{t('emptyTitle')}</p>
              <p className="text-sm mt-1">{t('emptyHint')}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colDate')}</TableHead>
                      <TableHead>{t('colDoc')}</TableHead>
                      <TableHead>{t('colSku')}</TableHead>
                      <TableHead>{t('colName')}</TableHead>
                      <TableHead className="text-right">{t('colQtyCacat')}</TableHead>
                      <TableHead>{t('colWo')}</TableHead>
                      <TableHead>{t('colNotes')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {formatDisplayDate(row.receivedAt, locale)}
                        </TableCell>
                        <TableCell className="font-medium">{row.refDocNumber}</TableCell>
                        <TableCell>
                          <span className="font-medium">{row.item.sku}</span>
                          {row.variantSku ? (
                            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                              {row.variantSku}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[160px]">
                          <span>{row.item.nameId}</span>
                          {row.variantDetail ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {row.variantDetail}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.qty.toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell>
                          {row.woId && row.woDocNumber ? (
                            <Link href={`/backoffice/work-orders/${row.woId}`} className={TAUTAN_DOKUMEN}>
                              {row.woDocNumber}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal min-w-[160px] max-w-[260px] text-muted-foreground">
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
