'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDate } from '@/lib/date-only';
import { getWorkOrderById, getReconciliation } from '@/app/actions/production';
import { buildReconciliationPrintHtml } from '@/lib/print/reconciliation-html';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { formatRupiah } from '@/lib/format/rupiah';
import {
  efisiensiBahan,
  persenBertanda,
  qtyBahan,
  statusTampilRekon,
  type StatusTampilRekon,
} from '@/lib/production/rekonsiliasi-tampil';

/** Rupiah bertanda: "+Rp 3.031.250". */
const rupiahBertanda = (n: number) => (n > 0 ? `+${formatRupiah(n)}` : formatRupiah(n));

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
  const tWO = useTranslations('workOrders');
  const tR = useTranslations('workOrders.recon');
  const locale = useLocale();
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
      .catch(() => toast.error(tR('loadFailed')))
      .finally(() => setIsLoading(false));
  }, [id, tR]);

  // Teoretis ÷ terpakai (lib/production/rekonsiliasi-tampil.ts); null = belum ada pemakaian.
  const efficiencyPercent = recon ? efisiensiBahan(recon.lines) : null;
  const labelStatus = (s: StatusTampilRekon) => tR(`status${s}`);

  const handleExportPDF = () => {
    if (!wo || !recon) return;
    const printDate = formatDisplayDate(
      (wo.updatedAt as Date | string | null | undefined) ?? new Date(),
      locale
    );
    const subtitle =
      wo.finishedGood && typeof wo.finishedGood === 'object'
        ? (wo.finishedGood as { nameId?: string }).nameId
        : undefined;

    const html = buildReconciliationPrintHtml({
      docNumber: typeof wo.docNumber === 'string' ? wo.docNumber : '',
      printDate,
      subtitle: subtitle ?? undefined,
      summary: recon.summary,
      efficiencyPercent,
      lines: recon.lines,
      labels: {
        title: tR('cetak.judul'),
        targetCutting: tWO('kebutuhanTotalRencana'),
        issuedToCmt: t('issuedToCmt'),
        returned: tWO('returned'),
        setoran: tR('terpakai'),
        theoretical: tWO('theoretical'),
        selisih: t('selisih'),
        value: tWO('valueImpact'),
        status: tWO('status'),
        varianceByMaterial: tR('byMaterial', { selisih: t('selisih') }),
        varianceByMaterialDesc: tR('cetak.keterangan'),
        totalMaterialCost: tR('totalMaterialCost'),
        efficiencyPct: tR('efficiency'),
        costVariance: tR('costVariance'),
        usedVsIssued: tR('cetak.efisiensiArti'),
        wo: tR('cetak.wo'),
        date: tR('cetak.tanggal'),
        issuedBy: tR('cetak.dibuatOleh'),
        material: tWO('material'),
        statusLabels: {
          OK: labelStatus('OK'),
          OVER: labelStatus('OVER'),
          UNDER: labelStatus('UNDER'),
          BELUM_DIKIRIM: labelStatus('BELUM_DIKIRIM'),
        },
      },
    });

    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'style',
      'position:absolute;width:0;height:0;border:0;visibility:hidden;'
    );
    iframe.setAttribute('title', 'Print reconciliation');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      toast.error(tR('printViewFailed'));
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const removeIframe = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    // Delay so the iframe document is fully parsed and laid out before print
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch {
        toast.error(tR('printFailed'));
      }
      setTimeout(removeIframe, 500);
    }, 350);
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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={`/backoffice/work-orders/${id}`}>
            <Button variant="ghost" size="icon" aria-label={tR('backToWO')} title={tR('backToWO')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold">{tWO('reconciliationTitle')}</h1>
              <TombolBantuan judul={tWO('reconciliationTitle')} />
            </div>
            <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {String(
                Number(wo.actualQty ?? 0) < Number(wo.plannedQty)
                  ? t('setoranSummary', {
                      target: Number(wo.plannedQty).toLocaleString('id-ID'),
                      actual: Number(wo.actualQty ?? 0).toLocaleString('id-ID'),
                      shortfall: (Number(wo.plannedQty) - Number(wo.actualQty ?? 0)).toLocaleString('id-ID'),
                    })
                  : t('setoranSummaryExact', {
                      target: Number(wo.plannedQty).toLocaleString('id-ID'),
                      actual: Number(wo.actualQty ?? 0).toLocaleString('id-ID'),
                    })
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportPDF}>
          <FileDown className="mr-2 h-4 w-4" />
          {tR('exportPdf')}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tR('totalMaterialCost')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatRupiah(recon.summary.totalUsedValue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tR('efficiency')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {efficiencyPercent == null
                ? '—'
                : `${efficiencyPercent.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tR('costVariance')}
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
              {rupiahBertanda(recon.summary.netVarianceValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tR('byMaterial', { selisih: t('selisih') })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tWO('material')}</TableHead>
                  <TableHead>{tWO('status')}</TableHead>
                  <TableHead className="hidden text-right 2xl:table-cell">{tWO('kebutuhanTotalRencana')}</TableHead>
                  <TableHead className="text-right">{t('issuedToCmt')}</TableHead>
                  <TableHead className="hidden text-right 2xl:table-cell">{tWO('returned')}</TableHead>
                  <TableHead className="text-right">{tR('terpakai')}</TableHead>
                  <TableHead className="text-right">{tWO('theoretical')}</TableHead>
                  <TableHead className="text-right">{t('selisih')}</TableHead>
                  <TableHead className="text-right">{t('selisih')} %</TableHead>
                  <TableHead className="text-right">{tWO('valueImpact')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recon.lines.map((line) => {
                  const statusTampil = statusTampilRekon(line);
                  return (
                  <TableRow
                    key={line.itemId}
                    className={statusTampil === 'OVER' ? 'bg-amber-50 dark:bg-amber-950/20' : undefined}
                  >
                    <TableCell className="min-w-[160px] whitespace-normal">
                      <span className="block font-medium">{line.itemName}</span>
                      {line.itemSku && <span className="block text-xs text-muted-foreground">{line.itemSku}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusTampil === 'OVER' ? 'destructive' : 'outline'}
                        className={
                          statusTampil === 'UNDER'
                            ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                            : undefined
                        }
                      >
                        {labelStatus(statusTampil)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-right 2xl:table-cell">
                      {qtyBahan(line.plannedQty)} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {qtyBahan(line.issuedQty)} {line.uomCode}
                    </TableCell>
                    <TableCell className="hidden text-right 2xl:table-cell">
                      {qtyBahan(line.returnedQty)} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {qtyBahan(line.actualUsed)} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {qtyBahan(line.theoreticalUsage)} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">
                      {line.variance > 0 ? '+' : ''}
                      {qtyBahan(line.variance)} {line.uomCode}
                    </TableCell>
                    <TableCell className="text-right">{persenBertanda(line.variancePercent)}</TableCell>
                    <TableCell className="text-right">{rupiahBertanda(line.varianceValue)}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
