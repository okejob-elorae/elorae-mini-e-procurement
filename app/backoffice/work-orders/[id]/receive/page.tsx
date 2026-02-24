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
  const [qcPhotos, setQcPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    getWorkOrderById(id)
      .then(setWO)
      .catch(() => {
        toast.error(t('failedToLoadWorkOrder'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
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
    setIsSubmitting(true);
    try {
      await receiveFG(
        {
          woId: String(wo.id),
          qtyReceived: received,
          qtyRejected: rejected,
          qcNotes: qcNotes.trim() || undefined,
          qcPhotos: qcPhotos.length > 0 ? qcPhotos : undefined
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
