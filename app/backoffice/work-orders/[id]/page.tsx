'use client';

import React, { useEffect, useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  getWorkOrderById,
  issueWorkOrder,
  cancelWorkOrder,
  getMaterialIssueForPrint
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
  const t = useTranslations('production');
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [printIssueId, setPrintIssueId] = useState<string | null>(null);
  const [printData, setPrintData] = useState<Awaited<ReturnType<typeof getMaterialIssueForPrint>>>(null);

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
      await issueWorkOrder(String(wo.id), session.user.id);
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
      await cancelWorkOrder(String(wo.id), session.user.id);
      toast.success('Work Order cancelled');
      const updated = await getWorkOrderById(id);
      setWO(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const openPrintNota = (issueId: string) => {
    setPrintIssueId(issueId);
    setPrintData(null);
  };
  const closePrintNota = () => {
    setPrintIssueId(null);
    setPrintData(null);
  };
  useEffect(() => {
    if (!printIssueId) return;
    getMaterialIssueForPrint(printIssueId)
      .then(setPrintData)
      .catch(() => toast.error('Failed to load issue for print'));
  }, [printIssueId]);
  const handlePrintNota = () => window.print();

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
  const rollBreakdown: Array<{ rollRef: string; qty: number; notes?: string }> | null = Array.isArray((wo as any).rollBreakdown)
    ? (wo as any).rollBreakdown
    : null;

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
              {String(wo.docNumber ?? '')}
            </h1>
            <p className="text-muted-foreground">
              {String((wo as any).vendor?.name ?? '')} · {String((wo as any).finishedGood?.nameId ?? '—')}
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
            {t('progressTarget')}: {planned.toLocaleString()} pcs · {t('progressActual')}: {actual.toLocaleString()}
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
          <p className="mt-2 text-sm text-muted-foreground">
            {actual < planned
              ? t('setoranSummary', {
                  target: planned.toLocaleString(),
                  actual: actual.toLocaleString(),
                  shortfall: (planned - actual).toLocaleString(),
                })
              : t('setoranSummaryExact', {
                  target: planned.toLocaleString(),
                  actual: actual.toLocaleString(),
                })}
          </p>
          {(wo as any).targetDate && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {t('progressTarget')}: {new Date((wo as any).targetDate).toLocaleDateString('id-ID')}
            </div>
          )}
        </CardContent>
      </Card>

      {rollBreakdown && rollBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alokasi per roll</CardTitle>
            <CardDescription>Nota kain per roll</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roll / Ref</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollBreakdown.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.rollRef ?? '-'}</TableCell>
                    <TableCell className="text-right">{Number(r.qty ?? 0).toLocaleString()}</TableCell>
                    <TableCell>{r.notes ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                const win = window.open('', '_blank', 'width=800,height=600');
                if (!win) return;
                win.document.write(`
                  <html><head><title>Nota Kain per Roll - ${wo.docNumber}</title></head><body>
                  <h2>Nota Kain per Roll</h2>
                  <p><strong>WO:</strong> ${wo.docNumber}</p>
                  <p><strong>Vendor:</strong> ${(wo.vendor as any)?.name ?? ''}</p>
                  <p><strong>FG:</strong> ${(wo.finishedGood as any)?.nameId ?? ''}</p>
                  <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
                  <tr><th>Roll / Ref</th><th>Qty</th><th>Notes</th></tr>
                  ${rollBreakdown.map((r) => `<tr><td>${r.rollRef ?? ''}</td><td>${Number(r.qty ?? 0)}</td><td>${r.notes ?? ''}</td></tr>`).join('')}
                  </table>
                  <p style="margin-top:16px"><strong>Materials (consumption plan):</strong></p>
                  <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
                  <tr><th>Material</th><th>Planned</th><th>UOM</th></tr>
                  ${consumptionPlan.map((p: any) => `<tr><td>${p.itemName ?? p.itemId}</td><td>${Number(p.plannedQty ?? 0)}</td><td>${p.uomCode ?? ''}</td></tr>`).join('')}
                  </table>
                  </body></html>`);
                win.document.close();
                win.focus();
                setTimeout(() => { win.print(); win.close(); }, 250);
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print Nota Kain per Roll
            </Button>
          </CardContent>
        </Card>
      )}

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
              <CardDescription>{t('cuttingPlanned')} vs {t('issuedToCmt')} per material</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead className="text-right" title={t('cuttingPlanned')}>{t('targetCutting')}</TableHead>
                    <TableHead className="text-right" title={t('issuedToCmt')}>{t('issuedToCmt')}</TableHead>
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
                {(wo as any).issues?.length ?? 0} issue(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!(wo as any).issues?.length ? (
                <p className="text-muted-foreground">No issues yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((wo as any).issues as any[]).map((iss: any) => (
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
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openPrintNota(iss.id)}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
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
                {(wo as any).receipts?.length ?? 0} receipt(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!(wo as any).receipts?.length ? (
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
                    {((wo as any).receipts as any[]).map((r: any) => (
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

      <Dialog open={!!printIssueId} onOpenChange={(open) => !open && closePrintNota()}>
        <DialogContent className="max-w-lg no-print">
          <style
            dangerouslySetInnerHTML={{
              __html: `@media print { .no-print { display: none !important; } }`,
            }}
          />
          <DialogHeader>
            <DialogTitle>Nota ke CMT</DialogTitle>
          </DialogHeader>
          {printData ? (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Doc:</span> {printData.docNumber}</p>
                <p><span className="text-muted-foreground">WO:</span> {printData.woDocNumber}</p>
                <p><span className="text-muted-foreground">Vendor:</span> {printData.vendorName}</p>
                <p><span className="text-muted-foreground">Date:</span> {new Date(printData.issuedAt).toLocaleDateString('id-ID')}</p>
                <p><span className="text-muted-foreground">Type:</span> {printData.issueType}</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>UOM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printData.lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{line.itemName}</TableCell>
                      <TableCell className="text-right">{Number(line.qty ?? 0).toLocaleString()}</TableCell>
                      <TableCell>{line.uomCode}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="font-semibold">Total cost: {Number(printData.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <div className="flex gap-2 no-print">
                <Button variant="outline" onClick={closePrintNota}>Close</Button>
                <Button onClick={handlePrintNota}><Printer className="mr-2 h-4 w-4" />Print</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading...</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
