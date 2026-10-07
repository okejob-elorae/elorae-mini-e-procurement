'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, PackageX, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { getStockAdjustmentById } from '@/app/actions/inventory';
import { logPrint } from '@/app/actions/audit';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDateTime } from '@/lib/date-only';
import { labelJenisGerakan } from '@/lib/inventory/jenis-gerakan-stok';
import { EmptyState } from '@/components/ui/empty-state';

const angka = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

export default function StockAdjustmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';
  const printRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('inventory');
  const tAdj = useTranslations('adjustment');
  const tKind = useTranslations('inventory.stockMoveKind');
  const tToasts = useTranslations('toasts');
  const locale = useLocale();
  const [adj, setAdj] = useState<Awaited<ReturnType<typeof getStockAdjustmentById>>>(null);
  // Tanpa id tidak ada yang dimuat: langsung keadaan "tidak ditemukan".
  const [isLoading, setIsLoading] = useState(Boolean(id));

  useEffect(() => {
    if (!id) return;
    getStockAdjustmentById(id)
      .then(setAdj)
      .catch(() => {
        toast.error(tToasts('failedToLoadAdjustment'));
        router.push('/backoffice/inventory');
      })
      .finally(() => setIsLoading(false));
  }, [id, router, tToasts]);

  const handlePrint = async () => {
    await logPrint('StockAdjustment', id);
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Dulu id yang tidak ada membuat halaman berputar selamanya.
  if (!adj) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/backoffice/inventory?tab=adjustments">
            <Button variant="ghost" size="icon" aria-label={t('page.backToInventory')} title={t('page.backToInventory')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{t('stockAdjustment')}</h1>
        </div>
        <Card>
          <CardContent>
            <EmptyState
              icon={PackageX}
              title={tAdj('tidakDitemukan')}
              description={tAdj('tidakDitemukanIsi')}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Judul nota mengikuti jenisnya: penyesuaian Tambah adalah barang MASUK.
  const masuk = adj.type === 'POSITIVE';
  const judulNota = masuk ? tAdj('notaBarangMasuk') : tAdj('notaBarangKeluar');

  const item = adj.item as { sku?: string; nameId?: string; nameEn?: string } | null;
  const itemLabel = item ? `${item.sku ?? '-'} – ${item.nameId ?? item.nameEn ?? '-'}` : adj.itemId;

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
            <Link href="/backoffice/inventory?tab=adjustments">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('page.backToInventory')}
                title={t('page.backToInventory')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-2xl font-bold">{adj.docNumber}</h1>
                <TombolBantuan judul={adj.docNumber} />
              </div>
              <p className="text-muted-foreground">{t('stockAdjustment')}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            {masuk ? tAdj('printNotaBarangMasuk') : tAdj('printNotaBarangKeluar')}
          </Button>
        </div>

        <div ref={printRef}>
          <div className="mb-4 text-center print:block">
            <h2 className="text-lg font-semibold">{judulNota}</h2>
            <p className="text-sm text-muted-foreground">{adj.docNumber}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{tAdj('adjustmentDetails')}</CardTitle>
              <CardDescription>{t('documentAndItem')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                <span className="text-muted-foreground">{t('docNumberLabel')}</span>{' '}
                <span className="font-semibold">{adj.docNumber}</span>
              </p>
              <p>
                <span className="text-muted-foreground">{t('itemLabel')}</span> {itemLabel}
              </p>
              <p>
                <span className="text-muted-foreground">{t('typeLabel')}</span>{' '}
                {adj.type === 'POSITIVE' ? t('page.adjPositive') : t('page.adjNegative')}
              </p>
              <p>
                <span className="text-muted-foreground">{t('qtyChangeLabel')}</span>{' '}
                <span className="font-medium">
                  {/* Tanda qtyChange tidak seragam antar-penulis; arah dari jenisnya. */}
                  {adj.type === 'POSITIVE' ? '+' : '-'}
                  {Math.abs(Number(adj.qtyChange ?? 0)).toLocaleString('id-ID')}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">{t('page.sourceLabel')}</span>{' '}
                {labelJenisGerakan(tKind, adj.source)}
              </p>
              <p>
                <span className="text-muted-foreground">{t('previousQtyLabel')}</span> {angka(adj.prevQty)} →{' '}
                {t('page.newQtyLabel')} {angka(adj.newQty)}
              </p>
              <p>
                <span className="text-muted-foreground">{t('reasonLabel')}</span> {adj.reason}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('page.dateLabel')}{' '}
                {formatDisplayDateTime(adj.createdAt, locale)}
              </p>
              {adj.approvedBy && (
                <p className="text-sm text-muted-foreground">
                  {t('page.approvedByLabel')} {(adj.approvedBy as { name: string | null }).name ?? '—'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
