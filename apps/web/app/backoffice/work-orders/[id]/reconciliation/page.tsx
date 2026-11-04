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
import { printHtmlInIframe } from '@/lib/print/print-html-in-iframe';
import { logPrintQuietly } from '@/lib/audit/log-print-quietly';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { formatRupiah } from '@/lib/format/rupiah';
import {
  efisiensiBahan,
  persenBertanda,
  qtyBahan,
  statusTampilRekon,
  type StatusTampilRekon,
} from '@/lib/production/rekonsiliasi-tampil';
import { angkaSetoranWo } from '@/lib/production/setoran-wo';
import { CatatanTanpaDokumen, RingkasSetoran } from '../../RingkasSetoran';
import { WoTidakDitemukan } from '../../WoTidakDitemukan';

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
    // Rekonsiliasi untuk WO yang tidak ada melempar galat; yang menentukan
    // "tidak ditemukan" adalah WO-nya, jadi galat rekonsiliasi ditangkap sendiri.
    Promise.all([getWorkOrderById(id), getReconciliation(id).catch(() => null)])
      .then(([w, r]) => {
        setWO(w);
        setRecon(r);
        if (w && !r) toast.error(tR('loadFailed'));
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

    printHtmlInIframe(html, 'Print reconciliation', { errorMessage: tR('printViewFailed') });
    logPrintQuietly('WorkOrderReconciliation', String(wo.id));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!wo) return <WoTidakDitemukan />;
  if (!recon) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">{tR('loadFailed')}</CardContent>
      </Card>
    );
  }

  const setoran = angkaSetoranWo({
    plannedQty: wo.plannedQty,
    actualQty: wo.actualQty,
    receipts: ((wo as { receipts?: unknown }).receipts as Parameters<typeof angkaSetoranWo>[0]['receipts']) ?? [],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/backoffice/work-orders/${id}`} aria-label={tR('backToWO')} title={tR('backToWO')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold">{tWO('reconciliationTitle')}</h1>
              <TombolBantuan judul={tWO('reconciliationTitle')} />
            </div>
            <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
            <div className="mt-1 space-y-1 text-sm text-muted-foreground">
              <RingkasSetoran angkaWo={setoran} />
              <CatatanTanpaDokumen angkaWo={setoran} />
            </div>
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
