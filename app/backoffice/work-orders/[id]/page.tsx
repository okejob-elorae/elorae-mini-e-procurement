'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  Loader2,
  Package,
  Calendar,
  Play,
  ClipboardList,
  Truck,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  getWorkOrderById,
  issueWorkOrder,
  cancelWorkOrder
} from '@/app/actions/production';
import { WOStatus } from '@/lib/constants/enums';

const statusLabels: Record<WOStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  IN_PRODUCTION: 'In Production',
  PARTIAL: 'Partial',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
};

const statusColors: Record<WOStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  ISSUED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  IN_PRODUCTION:
    'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  PARTIAL: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

export default function WorkOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getWorkOrderById(id)
      .then(setWO)
      .catch(() => {
        toast.error('Failed to load work order');
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
  }, [id, router]);

  const handleIssue = async () => {
    if (!session?.user?.id || !wo) return;
    try {
      await issueWorkOrder(wo.id, session.user.id);
      toast.success('Work Order issued');
      const updated = await getWorkOrderById(id);
      setWO(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to issue');
    }
  };

  const handleCancel = async () => {
    if (!session?.user?.id || !wo || !confirm('Cancel this Work Order?')) return;
    try {
      await cancelWorkOrder(wo.id, session.user.id);
      toast.success('Work Order cancelled');
      const updated = await getWorkOrderById(id);
      setWO(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  if (isLoading || !wo) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const planned = Number(wo.plannedQty);
  const actual = Number(wo.actualQty ?? 0);
  const progressPct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;
  const consumptionPlan = (wo.consumptionPlan as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/backoffice/work-orders">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {wo.docNumber}
            </h1>
            <p className="text-muted-foreground">
              {wo.vendor?.name} · {(wo.finishedGood as any)?.nameId ?? '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColors[wo.status as WOStatus]}>
            {statusLabels[wo.status as WOStatus]}
          </Badge>
          {wo.status === 'DRAFT' && (
            <Button onClick={handleIssue}>Issue</Button>
          )}
          {(wo.status === 'DRAFT' || wo.status === 'ISSUED') && (
            <Button variant="destructive" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          {wo.status !== 'DRAFT' && wo.status !== 'CANCELLED' && (
            <>
              <Link href={`/backoffice/work-orders/${id}/issue`}>
                <Button variant="outline">Issue Materials</Button>
              </Link>
              <Link href={`/backoffice/work-orders/${id}/receive`}>
                <Button variant="outline">Receive FG</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Progress
          </CardTitle>
          <CardDescription>
            Target: {planned.toLocaleString()} pcs · Actual: {actual.toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{progressPct}%</span>
              <span>
                {actual.toLocaleString()} / {planned.toLocaleString()}
              </span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
          {wo.targetDate && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Target: {new Date(wo.targetDate).toLocaleDateString('id-ID')}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="details">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="issues">Material Issues</TabsTrigger>
          <TabsTrigger value="receipts">FG Receipts</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Consumption Plan</CardTitle>
              <CardDescription>Planned vs issued per material</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead className="text-right">Returned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumptionPlan.map((p: any) => (
                    <TableRow key={p.itemId}>
                      <TableCell>{p.itemName}</TableCell>
                      <TableCell className="text-right">
                        {Number(p.plannedQty ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(p.issuedQty ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(p.returnedQty ?? 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="issues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Material Issues
              </CardTitle>
              <CardDescription>
                {wo.issues?.length ?? 0} issue(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!wo.issues?.length ? (
                <p className="text-muted-foreground">No issues yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(wo.issues as any[]).map((iss: any) => (
                      <TableRow key={iss.id}>
                        <TableCell className="font-medium">
                          {iss.docNumber}
                        </TableCell>
                        <TableCell>{iss.issueType}</TableCell>
                        <TableCell>
                          {new Date(iss.issuedAt).toLocaleDateString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(iss.totalCost).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="receipts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                FG Receipts
              </CardTitle>
              <CardDescription>
                {wo.receipts?.length ?? 0} receipt(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!wo.receipts?.length ? (
                <p className="text-muted-foreground">No receipts yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead className="text-right">Accepted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(wo.receipts as any[]).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.docNumber}
                        </TableCell>
                        <TableCell>
                          {new Date(r.receivedAt).toLocaleDateString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyReceived).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyRejected ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyAccepted).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Reconciliation
              </CardTitle>
              <CardDescription>
                Actual vs theoretical usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/backoffice/work-orders/${id}/reconciliation`}>
                <Button variant="outline">View full reconciliation report</Button>
              </Link>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
