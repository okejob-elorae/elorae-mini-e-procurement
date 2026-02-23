'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { getStockAdjustmentById } from '@/app/actions/inventory';
import { toast } from 'sonner';

export default function StockAdjustmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';
  const printRef = useRef<HTMLDivElement>(null);
  const [adj, setAdj] = useState<Awaited<ReturnType<typeof getStockAdjustmentById>>>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getStockAdjustmentById(id)
      .then(setAdj)
      .catch(() => {
        toast.error('Failed to load adjustment');
        router.push('/backoffice/inventory');
      })
      .finally(() => setIsLoading(false));
  }, [id, router]);

  const handlePrint = () => {
    window.print();
  };

  if (isLoading || !adj) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
            <Link href="/backoffice/inventory">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{adj.docNumber}</h1>
              <p className="text-muted-foreground">Stock Adjustment</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print Nota Barang Keluar
          </Button>
        </div>

        <div ref={printRef}>
          <div className="mb-4 text-center print:block">
            <h2 className="text-lg font-semibold">Nota Barang Keluar</h2>
            <p className="text-sm text-muted-foreground">{adj.docNumber}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Adjustment details</CardTitle>
              <CardDescription>Document and item</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                <span className="text-muted-foreground">Doc #:</span>{' '}
                <span className="font-semibold">{adj.docNumber}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Item:</span> {itemLabel}
              </p>
              <p>
                <span className="text-muted-foreground">Type:</span> {adj.type}
              </p>
              <p>
                <span className="text-muted-foreground">Qty change:</span>{' '}
                <span className="font-medium">
                  {adj.type === 'POSITIVE' ? '+' : '-'}
                  {adj.qtyChange}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Previous qty:</span> {adj.prevQty} → New
                qty: {adj.newQty}
              </p>
              <p>
                <span className="text-muted-foreground">Reason:</span> {adj.reason}
              </p>
              <p className="text-sm text-muted-foreground">
                Date:{' '}
                {adj.createdAt instanceof Date
                  ? adj.createdAt.toLocaleString()
                  : new Date(adj.createdAt).toLocaleString()}
              </p>
              {adj.approvedBy && (
                <p className="text-sm text-muted-foreground">
                  Approved by: {(adj.approvedBy as { name: string | null }).name ?? '—'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
