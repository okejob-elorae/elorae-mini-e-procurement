'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getWorkOrderById, receiveFG } from '@/app/actions/production';

export default function WorkOrderReceivePage() {
  const t = useTranslations('toasts');
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [qtyReceived, setQtyReceived] = useState('');
  const [qtyRejected, setQtyRejected] = useState('0');
  const [qcNotes, setQcNotes] = useState('');
  const [qcPhotos, _setQcPhotos] = useState<string[]>([]);
  void _setQcPhotos;
  const [variantQtys, setVariantQtys] = useState<Array<{ variantSku: string; qty: number }>>([]);
  const [rejectedVariantQtys, setRejectedVariantQtys] = useState<Array<{ variantSku: string; qty: number }>>([]);

  useEffect(() => {
    if (!id) return;
    getWorkOrderById(id)
      .then((data) => {
        setWO(data);
        const sb = (data as { skuBreakdown?: unknown })?.skuBreakdown;
        if (Array.isArray(sb) && sb.length > 0) {
          const rows = sb.map((x: { variantSku?: string }) => ({ variantSku: String((x as { variantSku?: string }).variantSku ?? ''), qty: 0 }));
          setVariantQtys(rows);
          setRejectedVariantQtys(rows.map((r) => ({ ...r })));
        } else {
          setVariantQtys([]);
          setRejectedVariantQtys([]);
        }
      })
      .catch(() => {
        toast.error(t('failedToLoadWorkOrder'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id, router drive fetch
  }, [id, router]);

  const received = Number(qtyReceived) || 0;
  const rejected = Number(qtyRejected) || 0;
  const accepted = Math.max(0, received - rejected);
  const issuesArr = Array.isArray(wo?.issues) ? wo.issues : [];
  const totalMaterialCost = issuesArr.length
    ? (issuesArr as any[]).reduce(
        (sum: number, i: any) => sum + Number(i.totalCost ?? 0),
        0
      )
    : 0;
  const costPerUnit = accepted > 0 ? totalMaterialCost / accepted : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user?.id || !wo) return;
    if (received <= 0) {
      toast.error(t('qtyReceivedMustBePositive'));
      return;
    }
    const sb = (wo as { skuBreakdown?: unknown })?.skuBreakdown;
    const needsVariantBreakdown = Array.isArray(sb) && sb.length > 1;
    if (needsVariantBreakdown) {
      const sumAccepted = variantQtys.reduce((s, x) => s + x.qty, 0);
      if (Math.abs(sumAccepted - accepted) > 0.01) {
        toast.error('Sum of variant qtys must equal qty accepted');
        return;
      }
      if (rejected > 0) {
        const sumRejected = rejectedVariantQtys.reduce((s, x) => s + x.qty, 0);
        if (Math.abs(sumRejected - rejected) > 0.01) {
          toast.error('Sum of rejected variant qtys must equal qty rejected');
          return;
        }
      }
    }
    setIsSubmitting(true);
    try {
      await receiveFG(
        {
          woId: String(wo.id),
          qtyReceived: received,
          qtyRejected: rejected,
          qcNotes: qcNotes.trim() || undefined,
          qcPhotos: qcPhotos.length > 0 ? qcPhotos : undefined,
          skuBreakdown: needsVariantBreakdown && variantQtys.length > 0 ? variantQtys : undefined,
          rejectedSkuBreakdown:
            needsVariantBreakdown && rejected > 0 && rejectedVariantQtys.length > 0
              ? rejectedVariantQtys
              : undefined
        },
        session.user.id
      );
      toast.success(t('fgReceived'));
      router.replace(`/backoffice/work-orders/${id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('failedToReceive'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !wo) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/backoffice/work-orders/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Receive Finished Goods</h1>
          <p className="text-muted-foreground">{String(wo.docNumber ?? '')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
          <CardDescription>
            Enter received and rejected quantities. Material cost is allocated
            from issues.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Qty Received (good)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={qtyReceived}
                  onChange={(e) => setQtyReceived(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Qty Rejected (defects)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={qtyRejected}
                  onChange={(e) => setQtyRejected(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Qty Accepted (net)</Label>
                <Input
                  type="text"
                  readOnly
                  value={accepted.toLocaleString()}
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium">Cost allocation</p>
              <p className="text-muted-foreground">
                Total material cost: {totalMaterialCost.toLocaleString()} →{' '}
                {accepted > 0
                  ? `${costPerUnit.toFixed(2)} per unit (${accepted} accepted)`
                  : 'N/A'}
              </p>
            </div>
            {variantQtys.length > 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Per-variant breakdown (sum must equal qty accepted)</Label>
                  {variantQtys.map((row, i) => (
                    <div key={row.variantSku} className="flex items-center gap-2">
                      <span className="w-48 truncate text-sm">{row.variantSku}</span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={row.qty === 0 ? '' : row.qty}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setVariantQtys((prev) => prev.map((p, j) => (j === i ? { ...p, qty: v } : p)));
                        }}
                        placeholder="0"
                        className="w-24"
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Sum: {variantQtys.reduce((s, x) => s + x.qty, 0).toLocaleString()} / {accepted.toLocaleString()} accepted
                  </p>
                </div>
                {rejected > 0 && (
                  <div className="space-y-2">
                    <Label>Per-variant rejected (sum must equal qty rejected)</Label>
                    {rejectedVariantQtys.map((row, i) => (
                      <div key={row.variantSku} className="flex items-center gap-2">
                        <span className="w-48 truncate text-sm">{row.variantSku}</span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={row.qty === 0 ? '' : row.qty}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setRejectedVariantQtys((prev) =>
                              prev.map((p, j) => (j === i ? { ...p, qty: v } : p))
                            );
                          }}
                          placeholder="0"
                          className="w-24"
                        />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Sum: {rejectedVariantQtys.reduce((s, x) => s + x.qty, 0).toLocaleString()} / {rejected.toLocaleString()} rejected
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>QC Notes</Label>
              <Textarea
                value={qcNotes}
                onChange={(e) => setQcNotes(e.target.value)}
                placeholder="Quality check notes"
                rows={3}
              />
            </div>
            <div className="flex gap-4">
              <Button type="submit" disabled={isSubmitting || received <= 0}>
                {isSubmitting ? 'Saving...' : 'Save Receipt'}
              </Button>
              <Link href={`/backoffice/work-orders/${id}`}>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
