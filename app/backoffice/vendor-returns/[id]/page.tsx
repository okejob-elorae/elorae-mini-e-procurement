'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { toast } from 'sonner';
import { getVendorReturnById, processReturn } from '@/app/actions/vendor-returns';

export default function VendorReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [ret, setRet] = useState<Awaited<ReturnType<typeof getVendorReturnById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

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
      getVendorReturnById(id).then(setRet);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setIsProcessing(false);
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
  const lines = (ret.lines as Array<{
    type: string;
    itemId: string;
    itemName?: string;
    qty: number;
    reason: string;
    condition: string;
    costValue?: number;
  }>) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
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
          <Badge variant={ret.status === 'PROCESSED' ? 'default' : 'secondary'}>
            {ret.status}
          </Badge>
          {ret.status === 'DRAFT' && (
            <Button onClick={handleProcess} disabled={isProcessing}>
              {isProcessing ? 'Processing...' : 'Process Return'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Total value and related WO</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>
            <span className="text-muted-foreground">Total value:</span>{' '}
            <span className="font-semibold">
              {Number(ret.totalValue).toLocaleString(undefined, {
                minimumFractionDigits: 2
              })}
            </span>
          </p>
          {wo && (
            <p>
              <span className="text-muted-foreground">Work order:</span>{' '}
              <Link
                href={`/backoffice/work-orders/${wo.id}`}
                className="text-primary hover:underline"
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
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
