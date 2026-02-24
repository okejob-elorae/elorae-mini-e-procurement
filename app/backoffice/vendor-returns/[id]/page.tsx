'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2, Printer, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  getVendorReturnById,
  processReturn,
  completeReturn
} from '@/app/actions/vendor-returns';
import { buildVendorReturnPrintHtml } from '@/lib/print/vendor-return-html';

export default function VendorReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('vendorReturn');
  const id = typeof params.id === 'string' ? params.id : '';
  const printRef = useRef<HTMLDivElement>(null);
  const [ret, setRet] = useState<Awaited<ReturnType<typeof getVendorReturnById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
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
        toast.error('Failed to load return');
        router.push('/backoffice/vendor-returns');
      })
      .finally(() => setIsLoading(false));
  }, [id, router]);

  const handleProcess = async () => {
    if (!session?.user?.id || !ret) return;
    setIsProcessing(true);
    try {
      await processReturn(ret.id, session.user.id);
      toast.success('Return processed');
      refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrint = () => {
    if (!ret) return;
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
      labels: {
        title: t('notaReturTitle'),
        doc: 'Doc',
        vendor: 'Vendor',
        totalValue: t('nilaiRetur'),
        workOrder: t('workOrderLabel'),
        processed: 'Processed',
        completed: t('completed'),
        tracking: t('trackingLabel'),
        type: 'Type',
        item: 'Item',
        qty: 'Qty',
        condition: 'Condition',
        reason: 'Reason',
        value: 'Value',
      },
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
      setCompleteError('Tracking number is required');
      return;
    }
    if (!receiptFile) {
      setCompleteError('Receipt file is required');
      return;
    }
    setIsCompleting(true);
    try {
      const formData = new FormData();
      formData.append('files', receiptFile);
      const res = await fetch('/api/upload/grn-photo', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Upload failed');
      }
      const data = await res.json();
      const receiptFileUrl = data.urls?.[0];
      if (!receiptFileUrl) throw new Error('No receipt URL returned');
      await completeReturn(ret.id, session.user.id, {
        trackingNumber: tn,
        receiptFileUrl
      });
      toast.success('Return completed');
      setCompleteOpen(false);
      setTrackingNumber('');
      setReceiptFile(null);
      refresh();
    } catch (err: unknown) {
      setCompleteError(err instanceof Error ? err.message : 'Failed to complete');
      toast.error(err instanceof Error ? err.message : 'Failed to complete');
    } finally {
      setIsCompleting(false);
    }
  };

  if (isLoading || !ret) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const vendor = ret.vendor as { name?: string; code?: string } | null;
  const wo = ret.wo as { id: string; docNumber: string } | null;
  const rawLines = ret.lines;
  const lines: Array<{
    type: string;
    itemId: string;
    itemName?: string;
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
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{ret.docNumber}</h1>
              <p className="text-muted-foreground">
                {vendor?.name ?? vendor?.code ?? ret.vendorId}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant}>{ret.status}</Badge>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Nota Retur
            </Button>
            {ret.status === 'DRAFT' && (
              <Button onClick={handleProcess} disabled={isProcessing}>
                {isProcessing ? 'Processing...' : 'Process Return'}
              </Button>
            )}
            {ret.status === 'PROCESSED' && (
              <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Complete return
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Complete return</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCompleteSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="trackingNumber">Tracking number *</Label>
                      <Input
                        id="trackingNumber"
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder="Resi / tracking number"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="receiptFile">Receipt (upload) *</Label>
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
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isCompleting}>
                        {isCompleting ? 'Completing...' : 'Complete'}
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
            <h2 className="text-lg font-semibold">Nota Retur</h2>
            <p className="text-sm text-muted-foreground">{ret.docNumber}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
              <CardDescription>Total value and related WO</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">{t('nilaiRetur')}</p>
                <p className="text-2xl font-bold">
                  Rp {Number(ret.totalValue).toLocaleString(undefined, {
                    minimumFractionDigits: 2
                  })}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{t('nilaiReturCmtNote')}</p>
              </div>
              {wo && (
                <p>
                  <span className="text-muted-foreground">Work order:</span>{' '}
                  <Link
                    href={`/backoffice/work-orders/${wo.id}`}
                    className="text-primary hover:underline print:no-underline print:text-inherit"
                  >
                    {wo.docNumber}
                  </Link>
                </p>
              )}
              {ret.processedAt && (
                <p className="text-sm text-muted-foreground">
                  Processed: {new Date(ret.processedAt).toLocaleString()}
                </p>
              )}
              {ret.status === 'COMPLETED' && ret.trackingNumber && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Tracking:</span>{' '}
                  {ret.trackingNumber}
                </p>
              )}
              {ret.status === 'COMPLETED' && ret.receiptFileUrl && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Receipt:</span>{' '}
                  <a
                    href={ret.receiptFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    View receipt
                  </a>
                </p>
              )}
              {ret.completedAt && (
                <p className="text-sm text-muted-foreground">
                  Completed: {new Date(ret.completedAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lines</CardTitle>
              <CardDescription>Items returned</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{line.type}</TableCell>
                      <TableCell>{line.itemName ?? line.itemId}</TableCell>
                      <TableCell className="text-right">{line.qty}</TableCell>
                      <TableCell>{line.condition}</TableCell>
                      <TableCell>{line.reason}</TableCell>
                      <TableCell className="text-right">
                        {(line.costValue ?? 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {ret.evidenceUrls && (
            <Card>
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc text-sm">
                  {(JSON.parse(ret.evidenceUrls as string) as string[]).map((url, i) => (
                    <li key={i}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
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
    </>
  );
}
