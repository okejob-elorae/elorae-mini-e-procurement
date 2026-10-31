'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { getStatusMeta } from '@/lib/ui/status-map';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StoreDeliveryRow } from '@/lib/archive/queries';
import { formatDisplayDate } from '@/lib/date-only';

export function StoreArchiveClient({
  storeId,
  storeName,
  rows,
  totalValue,
  pendingTax,
}: {
  storeId: string;
  storeName: string;
  rows: StoreDeliveryRow[];
  totalValue: number;
  pendingTax: number;
}) {
  const t = useTranslations('archive');
  const tStatus = useTranslations('statuses');
  const tTable = useTranslations('tableHeaders');
  const locale = useLocale();
  const fmtDate = (iso: string) => formatDisplayDate(iso, locale);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/backoffice/archive"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('kembaliKeArsip')}
        </Link>
        <PageHeader
          title={storeName}
          meta={t('storeFolderMeta', {
            docs: rows.length,
            value: `Rp ${Math.round(totalValue).toLocaleString('id-ID')}`,
            pending: pendingTax,
          })}
          actions={
            <Button variant="outline" asChild>
              <Link href={`/backoffice/stores/${storeId}`}>{t('openStore')}</Link>
            </Button>
          }
        />
      </div>

      <Card>
        <CardContent className={rows.length === 0 ? 'p-0' : 'px-0'}>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t('storeFolderEmptyTitle')}
              description={t('storeFolderEmptyBody')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('kolomNoNota')}</TableHead>
                    {/* Tanggal nota tagihan, dengan nama yang sama seperti di antrean Faktur pajak. */}
                    <TableHead>{t('kolomTanggalNota')}</TableHead>
                    <TableHead>{t('kolomJatuhTempo')}</TableHead>
                    <TableHead className="text-right">{tTable('amount')}</TableHead>
                    <TableHead>{t('kolomFakturPajak')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const meta = getStatusMeta('taxInvoice', row.taxStatus);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.docNo}
                          <span className="block text-xs text-muted-foreground">
                            {row.orderNo}
                          </span>
                        </TableCell>
                        <TableCell>{fmtDate(row.invoiceDate)}</TableCell>
                        <TableCell>{fmtDate(row.dueDate)}</TableCell>
                        <TableCell className="text-right">
                          Rp {Math.round(row.total).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={meta.tone}>
                            {tStatus(meta.labelKey as never)}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          {/* Print lives on the order's DeliveriesCard, which already
                              builds both notes and stamps the first print. */}
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/backoffice/field-sales-orders/${row.orderId}`}>
                              {t('openDocument')}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
