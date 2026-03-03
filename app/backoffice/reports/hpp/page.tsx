'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, Calculator, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getHPPList } from '@/app/actions/hpp';

export default function HPPPage() {
  const t = useTranslations('hpp');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getHPPList>>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getHPPList()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setIsLoading(false));
  }, []);

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
                <p>{t('helpWhenStored')}</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>{t('helpMaterialCost')}</li>
                  <li>{t('helpAvgCostPerUnit')}</li>
                </ul>
                <p>{t('helpTableExplanation')}</p>
                <p>{t('helpFuture')}</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
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
              <p>{t('noFinishedGoods')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sku')}</TableHead>
                    <TableHead>{t('name')}</TableHead>
                    <TableHead className="text-right">{t('receiptCount')}</TableHead>
                    <TableHead className="text-right">{t('lastAvgCostPerUnit')}</TableHead>
                    <TableHead className="text-right">{t('lastMaterialCost')}</TableHead>
                    <TableHead>{t('lastReceipt')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.itemId}>
                      <TableCell className="font-medium">{row.sku}</TableCell>
                      <TableCell>{row.nameId}</TableCell>
                      <TableCell className="text-right">{row.receiptCount}</TableCell>
                      <TableCell className="text-right">
                        {row.lastAvgCostPerUnit != null
                          ? `Rp ${row.lastAvgCostPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.lastMaterialCost != null
                          ? `Rp ${row.lastMaterialCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {row.lastReceiptAt
                          ? new Date(row.lastReceiptAt).toLocaleDateString('id-ID')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
