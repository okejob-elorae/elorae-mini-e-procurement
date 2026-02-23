'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { getWorkOrderById, getReconciliation } from '@/app/actions/production';

type ReconLine = {
  itemId: string;
  itemName: string;
  itemSku: string;
  uomCode: string;
  plannedQty: number;
  issuedQty: number;
  returnedQty: number;
  actualUsed: number;
  theoreticalUsage: number;
  variance: number;
  variancePercent: number;
  varianceValue: number;
  issuedValue: number;
  usedValue: number;
  status: 'OK' | 'OVER' | 'UNDER';
};

type ReconSummary = {
  totalIssuedValue: number;
  totalUsedValue: number;
  netVarianceValue: number;
};

export default function WorkOrderReconciliationPage() {
  const params = useParams();
  const t = useTranslations('production');
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [recon, setRecon] = useState<{
    lines: ReconLine[];
    summary: ReconSummary;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getWorkOrderById(id), getReconciliation(id)])
      .then(([w, r]) => {
        setWO(w);
        setRecon(r);
      })
      .catch(() => toast.error('Failed to load reconciliation'))
      .finally(() => setIsLoading(false));
  }, [id]);

  const efficiencyPercent =
    recon && recon.summary.totalIssuedValue > 0
      ? (recon.summary.totalUsedValue / recon.summary.totalIssuedValue) * 100
      : 0;

  const handleExportPDF = () => {
    window.print();
  };

  if (isLoading || !wo || !recon) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print { .no-print { display: none !important; } }`,
        }}
      />
      <div className="flex items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-4">
          <Link href={`/backoffice/work-orders/${id}`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Reconciliation</h1>
            <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {String(
                Number(wo.actualQty ?? 0) < Number(wo.plannedQty)
                  ? t('setoranSummary', {
                      target: Number(wo.plannedQty).toLocaleString(),
                      actual: Number(wo.actualQty ?? 0).toLocaleString(),
                      shortfall: (Number(wo.plannedQty) - Number(wo.actualQty ?? 0)).toLocaleString(),
                    })
                  : t('setoranSummaryExact', {
                      target: Number(wo.plannedQty).toLocaleString(),
                      actual: Number(wo.actualQty ?? 0).toLocaleString(),
                    })
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportPDF}>
          <FileDown className="mr-2 h-4 w-4" />
          Print / Export PDF
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Material Cost (Used)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {recon.summary.totalUsedValue.toLocaleString(undefined, {
                minimumFractionDigits: 2
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Efficiency %
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {efficiencyPercent.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              Used vs issued value
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cost Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
                recon.summary.netVarianceValue > 0
                  ? 'text-amber-600'
                  : recon.summary.netVarianceValue < 0
                    ? 'text-green-600'
                    : ''
              }`}
            >
              {recon.summary.netVarianceValue >= 0 ? '+' : ''}
              {recon.summary.netVarianceValue.toLocaleString(undefined, {
                minimumFractionDigits: 2
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('selisih')} by material</CardTitle>
          <CardDescription>
            {t('cuttingPlanned')} vs {t('issuedToCmt')} vs {t('setoran')}; {t('selisihFromEstimate')} per line.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right" title={t('cuttingPlanned')}>{t('targetCutting')}</TableHead>
                  <TableHead className="text-right" title={t('issuedToCmt')}>{t('issuedToCmt')}</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">{t('setoran')}</TableHead>
                  <TableHead className="text-right">Theoretical</TableHead>
                  <TableHead className="text-right" title={t('selisihFromEstimate')}>{t('selisih')}</TableHead>
                  <TableHead className="text-right">{t('selisih')} %</TableHead>
                  <TableHead className="text-right">Value Impact</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.lines.map((line) => (
                  <TableRow
                    key={line.itemId}
                    className={
                      line.status === 'OVER'
                        ? 'bg-amber-50 dark:bg-amber-950/20'
                        : line.status === 'UNDER'
                          ? 'bg-green-50 dark:bg-green-950/20'
                          : undefined
                    }
                  >
                    <TableCell>
                      <span className="font-medium">{line.itemName}</span>
                      {line.itemSku && (
                        <span className="ml-1 text-muted-foreground">
                          ({line.itemSku})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.plannedQty.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.issuedQty.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.returnedQty.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.actualUsed.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.theoreticalUsage.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.variance >= 0 ? '+' : ''}
                      {line.variance.toLocaleString()} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.variancePercent >= 0 ? '+' : ''}
                      {line.variancePercent.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {line.varianceValue >= 0 ? '+' : ''}
                      {line.varianceValue.toLocaleString(undefined, {
                        minimumFractionDigits: 2
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          line.status === 'OK'
                            ? 'secondary'
                            : line.status === 'OVER'
                              ? 'destructive'
                              : 'default'
                        }
                      >
                        {line.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
