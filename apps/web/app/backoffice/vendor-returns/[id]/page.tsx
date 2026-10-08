'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2, Printer, CheckCircle, PackageX } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDateTime } from '@/lib/date-only';
import {
  getVendorReturnById,
  processReturn,
  completeReturn
} from '@/app/actions/vendor-returns';
import { logPrint } from '@/app/actions/audit';
import { buildVendorReturnPrintHtml } from '@/lib/print/vendor-return-html';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { pesanTolakRetur, tolakReturBasi } from '../pesan-tolak-retur';
import { TAUTAN_DOKUMEN } from '@/app/backoffice/purchase-orders/tautan-dokumen';
import { hasPermission, PERMISSIONS } from '@/lib/rbac';

const rp = (n: number) => `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;

export default function VendorReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('vendorReturn');
  const tList = useTranslations('vendorReturnsList');
  const locale = useLocale();
  const statusLabel = (status: string) =>
    status === 'DRAFT' ? tList('statusDraft')
    : status === 'PROCESSED' ? tList('statusProcessed')
    : status === 'COMPLETED' ? tList('statusCompleted')
    : status;
  const lineTypeLabel = (type: string) =>
    type === 'FABRIC' || type === 'ACCESSORIES' || type === 'FG_REJECT'
      ? t(`lineType.${type}`)
      : type;
  const conditionLabel = (condition: string) =>
    condition === 'GOOD' || condition === 'DAMAGED' || condition === 'DEFECTIVE'
      ? t(`condition.${condition}`)
      : condition;
  const id = typeof params.id === 'string' ? params.id : '';
  const printRef = useRef<HTMLDivElement>(null);
  const [ret, setRet] = useState<Awaited<ReturnType<typeof getVendorReturnById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  // Proses retur mengeluarkan stok dan tidak bisa dibatalkan: konfirmasi dulu.
  const [konfirmasiProses, setKonfirmasiProses] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const refresh = () => {
    if (id) getVendorReturnById(id).then(setRet);
    router.refresh();
  };

  useEffect(() => {
    if (!id) return;
    getVendorReturnById(id)
      .then(setRet)
      .catch(() => {
        toast.error(t('loadFailed'));
        router.push('/backoffice/vendor-returns');
      })
      .finally(() => setIsLoading(false));
  }, [id, router, t]);

  const handleProcess = async () => {
    if (!session?.user?.id || !ret) return;
    setIsProcessing(true);
    try {
      // Penolakan datang sebagai kode (pesan lemparan disamarkan di produksi).
      const hasil = await processReturn(ret.id, session.user.id);
      if (!hasil.ok) {
        toast.error(pesanTolakRetur(hasil, tList, tList('processFailed'), locale));
        if (tolakReturBasi(hasil)) refresh();
        return;
      }
      toast.success(tList('processed'));
      refresh();
    } catch {
      toast.error(tList('processFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrint = async () => {
    if (!ret) return;
    await logPrint('VendorReturn', ret.id);
    const vendor = ret.vendor as { name?: string; code?: string } | null;
    const wo = ret.wo as { id: string; docNumber: string } | null;
    const rawLines = ret.lines;
    const printLines = Array.isArray(rawLines)
      ? rawLines
      : typeof rawLines === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(rawLines);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [];
    const html = buildVendorReturnPrintHtml({
      docNumber: ret.docNumber,
      vendorName: vendor?.name ?? vendor?.code ?? ret.vendorId ?? '',
      totalValue: Number(ret.totalValue),
      status: ret.status,
      woDocNumber: wo?.docNumber,
      processedAt: ret.processedAt,
      completedAt: ret.completedAt,
      trackingNumber: ret.trackingNumber ?? undefined,
      lines: printLines,
      poDocNumber: ret.po?.docNumber ?? null,
    });
    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
    iframe.setAttribute('title', t('printNotaRetur'));
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.print();
      }, 350);
    }
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 500);
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompleteError(null);
    if (!session?.user?.id || !ret) return;
    const tn = trackingNumber.trim();
    if (!tn) {
      setCompleteError(t('trackingRequired'));
      return;
    }
    if (!receiptFile) {
      setCompleteError(t('receiptRequired'));
      return;
    }
    setIsCompleting(true);
    try {
      const formData = new FormData();
      formData.append('files', receiptFile);
      const res = await fetch('/api/upload/grn-photo', { method: 'POST', body: formData });
      if (!res.ok) {
        // Pesan server (Inggris, mis. penyimpanan belum disiapkan) tidak ditampilkan mentah.
        throw new Error('UNGGAH_GAGAL');
      }
      const data = await res.json();
      const receiptFileUrl = data.urls?.[0];
      if (!receiptFileUrl) throw new Error('UNGGAH_GAGAL');
      const hasil = await completeReturn(ret.id, session.user.id, {
        trackingNumber: tn,
        receiptFileUrl
      });
      if (!hasil.ok) {
        const pesan = pesanTolakRetur(hasil, tList, t('completeFailed'), locale);
        setCompleteError(pesan);
        toast.error(pesan);
        if (tolakReturBasi(hasil)) refresh();
        return;
      }
      toast.success(t('completedToast'));
      setCompleteOpen(false);
      setTrackingNumber('');
      setReceiptFile(null);
      refresh();
    } catch (err: unknown) {
      const pesan = err instanceof Error && err.message === 'UNGGAH_GAGAL' ? t('uploadFailed') : t('completeFailed');
      setCompleteError(pesan);
      toast.error(pesan);
    } finally {
      setIsCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Id yang tidak ada: dulu pemutar berputar selamanya tanpa pesan atau jalan kembali.
  if (!ret) {
    return (
      <Card className="py-0">
        <CardContent className="p-0">
          <EmptyState
            icon={PackageX}
            title={t('tidakDitemukan')}
            description={t('tidakDitemukanIsi')}
            action={
              <Button asChild variant="outline">
                <Link href="/backoffice/vendor-returns">{t('backToList')}</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const vendor = ret.vendor as { name?: string; code?: string } | null;
  const wo = ret.wo as { id: string; docNumber: string } | null;
  const grn = (ret as { grn?: { id: string; docNumber: string } | null }).grn ?? null;
  // Tautan hanya ke halaman yang boleh dibuka (pembeli biasanya tanpa inventory:view).
  const izin = session?.user?.permissions ?? [];
  const bolehBukaGrn = hasPermission(izin, PERMISSIONS.INVENTORY_VIEW);
  const bolehBukaPo = hasPermission(izin, PERMISSIONS.PURCHASE_ORDERS_VIEW);
  const rawLines = ret.lines;
  const lines: Array<{
    type: string;
    itemId: string;
    itemName?: string;
    rollRef?: string;
    qty: number;
    reason: string;
    condition: string;
    costValue?: number;
  }> = Array.isArray(rawLines)
    ? rawLines
    : typeof rawLines === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(rawLines);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  const statusBadgeVariant =
    ret.status === 'COMPLETED'
      ? 'default'
      : ret.status === 'PROCESSED'
        ? 'secondary'
        : 'outline';

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print { .no-print { display: none !important; } }`
        }}
      />
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-4">
            <Link href="/backoffice/vendor-returns">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('backToList')}
                title={t('backToList')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-2xl font-bold">{ret.docNumber}</h1>
                <TombolBantuan judul={ret.docNumber} />
              </div>
              <p className="text-muted-foreground">
                {vendor?.name ?? vendor?.code ?? ret.vendorId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant}>{statusLabel(ret.status)}</Badge>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              {t('cetakNotaRetur')}
            </Button>
            {ret.status === 'DRAFT' && (
              <Button onClick={() => setKonfirmasiProses(true)} disabled={isProcessing}>
                {isProcessing ? tList('processing') : t('prosesRetur')}
              </Button>
            )}
            {ret.status === 'PROCESSED' && (
              <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {t('completeReturn')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('completeReturn')}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCompleteSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="trackingNumber">{t('trackingNumber')} *</Label>
                      <Input
                        id="trackingNumber"
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder={t('trackingPlaceholder')}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="receiptFile">{t('receiptUpload')} *</Label>
                      <Input
                        id="receiptFile"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                        required={!receiptFile}
                      />
                    </div>
                    {completeError && (
                      <p className="text-sm text-destructive" role="alert">
                        {completeError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCompleteOpen(false)}
                      >
                        {t('cancel')}
                      </Button>
                      <Button type="submit" disabled={isCompleting}>
                        {isCompleting ? t('completing') : t('complete')}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <div ref={printRef}>
          <div className="mb-4 text-center print:block">
            <h2 className="text-lg font-semibold">{t('notaReturTitle')}</h2>
            <p className="text-sm text-muted-foreground">{ret.docNumber}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">{t('nilaiRetur')}</p>
                <p className="text-2xl font-bold tabular-nums">{rp(Number(ret.totalValue))}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('nilaiReturCmtNote')}</p>
              </div>
              {wo && (
                <p>
                  <span className="text-muted-foreground">{t('workOrderLabel')}</span>{' '}
                  <Link
                    href={`/backoffice/work-orders/${wo.id}`}
                    className={`${TAUTAN_DOKUMEN} print:no-underline print:text-inherit`}
                  >
                    {wo.docNumber}
                  </Link>
                </p>
              )}
              {grn && (
                <p>
                  <span className="text-muted-foreground">{t('grnLabel')}</span>{' '}
                  {bolehBukaGrn ? (
                    <Link href={`/backoffice/inventory/grn/${grn.id}`} className={TAUTAN_DOKUMEN}>
                      {grn.docNumber}
                    </Link>
                  ) : (
                    <span>{grn.docNumber}</span>
                  )}
                </p>
              )}
              {ret.po && (
                <p>
                  <span className="text-muted-foreground">{t('poKreditLabel')}</span>{' '}
                  {bolehBukaPo ? (
                    <Link href={`/backoffice/purchase-orders/${ret.po.id}`} className={TAUTAN_DOKUMEN}>
                      {ret.po.docNumber}
                    </Link>
                  ) : (
                    <span>{ret.po.docNumber}</span>
                  )}
                  {ret.poCreditAmount != null && (
                    <span className="text-muted-foreground"> ({rp(ret.poCreditAmount)})</span>
                  )}
                </p>
              )}
              {ret.processedAt && (
                <p className="text-sm text-muted-foreground">
                  {t('processedAt', { date: formatDisplayDateTime(ret.processedAt, locale) })}
                </p>
              )}
              {ret.status === 'COMPLETED' && ret.trackingNumber && (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('trackingLabel')}</span>{' '}
                  {ret.trackingNumber}
                </p>
              )}
              {ret.status === 'COMPLETED' && ret.receiptFileUrl && (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('receiptLabel')}</span>{' '}
                  <a
                    href={ret.receiptFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={TAUTAN_DOKUMEN}
                  >
                    {t('viewReceipt')}
                  </a>
                </p>
              )}
              {ret.completedAt && (
                <p className="text-sm text-muted-foreground">
                  {t('completedAt', { date: formatDisplayDateTime(ret.completedAt, locale) })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('judulBaris')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colType')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="text-right">{t('colQty')}</TableHead>
                    <TableHead>{t('colCondition')}</TableHead>
                    <TableHead>{t('colReason')}</TableHead>
                    <TableHead className="text-right">{t('colValue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{lineTypeLabel(line.type)}</TableCell>
                      <TableCell className="min-w-[200px] whitespace-normal">
                        {line.type === 'FABRIC' && line.rollRef
                          ? `${line.itemName ?? line.itemId} – ${line.rollRef} (${line.qty})`
                          : line.type === 'FG_REJECT'
                            ? t('sourceReject', { name: line.itemName ?? line.itemId })
                            : line.itemName ?? line.itemId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(line.qty).toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{conditionLabel(line.condition)}</TableCell>
                      <TableCell className="min-w-[160px] whitespace-normal">{line.reason}</TableCell>
                      <TableCell className="text-right tabular-nums">{rp(line.costValue ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {ret.evidenceUrls && (
            <Card>
              <CardHeader>
                <CardTitle>{t('evidenceTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc text-sm">
                  {(JSON.parse(ret.evidenceUrls as string) as string[]).map((url, i) => (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${TAUTAN_DOKUMEN} break-all`}
                      >
                        {url}
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AlertDialog open={konfirmasiProses} onOpenChange={setKonfirmasiProses}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tList('prosesJudul', { doc: ret.docNumber })}</AlertDialogTitle>
            <AlertDialogDescription>{tList('prosesIsi')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setKonfirmasiProses(false);
                void handleProcess();
              }}
            >
              {t('prosesRetur')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
