'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getPOById, changePOStatus, updatePO, setPOPaidAt } from '@/app/actions/purchase-orders';
import { POForm } from '@/components/forms/POForm';
import { ETABadge } from '@/components/ui/ETABadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, ArrowLeft, Edit, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { POStatus } from '@/lib/constants/enums';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PinAuthModal } from '@/components/security/PinAuthModal';

const statusLabels: Record<POStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PARTIAL: 'Partial',
  CLOSED: 'Closed',
  OVER: 'Over-received',
  CANCELLED: 'Cancelled',
};

const statusColors: Record<POStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  SUBMITTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  PARTIAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  CLOSED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  OVER: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const [po, setPO] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'cancel' | 'update' | null>(null);
  const [pendingUpdateData, setPendingUpdateData] = useState<any>(null);

  useEffect(() => {
    if (params.id && typeof params.id === 'string') {
      getPOById(params.id)
        .then((data) => {
          setPO(data);
          // Load suppliers for edit mode
          fetch('/api/suppliers?sync=true')
            .then(res => res.json())
            .then(data => setSuppliers(data.map((s: any) => ({ id: s.id, code: s.code, name: s.name }))))
            .catch(() => {});
        })
        .catch(() => {
          toast.error('Failed to load PO');
          router.push('/backoffice/purchase-orders');
        })
        .finally(() => setIsLoading(false));
    }
  }, [params.id, router]);

  const handleStatusChange = async (newStatus: 'SUBMITTED' | 'CANCELLED' | 'CLOSED', notes?: string) => {
    if (!session?.user?.id || !po) return;

    if (newStatus === 'CANCELLED') {
      setCancelReason(notes ?? '');
      setPendingAction('cancel');
      setPinModalOpen(true);
      return;
    }

    setIsSaving(true);
    try {
      await changePOStatus(po.id, newStatus, session.user.id, notes);
      toast.success(`PO ${newStatus.toLowerCase()} successfully`);
      router.refresh();
      const updated = await getPOById(po.id);
      setPO(updated);
      setCancelDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePinConfirm = async (pin: string) => {
    if (!session?.user?.id || !po) return;

    setIsSaving(true);
    try {
      if (pendingAction === 'cancel') {
        await changePOStatus(po.id, 'CANCELLED', session.user.id, cancelReason, pin);
        toast.success('PO cancelled successfully');
        setCancelDialogOpen(false);
        setCancelReason('');
      } else if (pendingAction === 'update' && pendingUpdateData) {
        await updatePO(po.id, pendingUpdateData, session.user.id, pin);
        toast.success('PO updated successfully');
        setIsEditMode(false);
        setPendingUpdateData(null);
      }
      setPinModalOpen(false);
      setPendingAction(null);
      router.refresh();
      const updated = await getPOById(po.id);
      setPO(updated);
    } catch (error: any) {
      toast.error(error.message || 'Failed');
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (data: Parameters<typeof POForm>[0]['onSubmit'] extends (data: infer T) => any ? T : never) => {
    if (!session?.user?.id || !po) return;

    if (po.status !== 'DRAFT') {
      setPendingUpdateData(data);
      setPendingAction('update');
      setPinModalOpen(true);
      return;
    }

    setIsSaving(true);
    try {
      await updatePO(po.id, data, session.user.id);
      toast.success('PO updated successfully');
      setIsEditMode(false);
      router.refresh();
      const updated = await getPOById(po.id);
      setPO(updated);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update PO');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!po) {
    return null;
  }

  const canEdit = po.status === 'DRAFT';
  const canSubmit = po.status === 'DRAFT';
  const canCancel = po.status === 'DRAFT' || po.status === 'SUBMITTED';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/backoffice/purchase-orders">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{po.docNumber}</h1>
            <p className="text-muted-foreground">{po.supplier.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusColors[po.status as POStatus]}>
            {statusLabels[po.status as POStatus]}
          </Badge>
          {po.paidAt ? (
            <Badge variant="default" className="bg-green-600">Paid</Badge>
          ) : (
            <Badge variant="secondary">Unpaid</Badge>
          )}
          {po.etaDate && (
            <ETABadge etaDate={po.etaDate} status={po.status} />
          )}
        </div>
      </div>

      {isEditMode && canEdit ? (
        <POForm
          initialData={{
            supplierId: po.supplierId,
            etaDate: po.etaDate ? new Date(po.etaDate) : null,
            paymentDueDate: po.paymentDueDate ? new Date(po.paymentDueDate) : null,
            notes: po.notes || undefined,
            terms: po.terms || undefined,
            items: po.items.map((item: any) => ({
              itemId: item.itemId,
              item: {
                sku: item.item.sku,
                nameId: item.item.nameId,
                uom: { id: item.uomId, code: item.item.uom.code },
              },
              qty: Number(item.qty),
              price: Number(item.price),
              uomId: item.uomId,
              notes: item.notes || undefined,
            })),
          }}
          suppliers={suppliers}
          onSubmit={handleUpdate}
          isLoading={isSaving}
        />
      ) : (
        <>
          {/* PO Details */}
          <Card>
            <CardHeader>
              <CardTitle>PO Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Supplier</p>
                  <p className="font-medium">{po.supplier.name} ({po.supplier.code})</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">ETA Date</p>
                  <p className="font-medium">
                    {po.etaDate ? new Date(po.etaDate).toLocaleDateString('id-ID') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment due date</p>
                  <p className="font-medium">
                    {po.paymentDueDate ? new Date(po.paymentDueDate).toLocaleDateString('id-ID') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment status</p>
                  <p className="font-medium">
                    {po.paidAt
                      ? `Paid on ${new Date(po.paidAt).toLocaleDateString('id-ID')}`
                      : 'Unpaid'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="font-medium">Rp {Number(po.grandTotal).toLocaleString('id-ID')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {new Date(po.createdAt).toLocaleDateString('id-ID')}
                  </p>
                </div>
              </div>
              {po.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="font-medium">{po.notes}</p>
                </div>
              )}
              {po.terms && (
                <div>
                  <p className="text-sm text-muted-foreground">Payment Terms</p>
                  <p className="font-medium">{po.terms}</p>
                </div>
              )}
              {po.status !== 'DRAFT' && po.status !== 'CANCELLED' && (
                <div className="pt-2 flex gap-2">
                  {po.paidAt ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await setPOPaidAt(po.id, null);
                          toast.success('Marked as unpaid');
                          const updated = await getPOById(po.id);
                          setPO(updated);
                        } catch (e: any) {
                          toast.error(e.message || 'Failed');
                        }
                      }}
                    >
                      Unmark paid
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={async () => {
                        try {
                          await setPOPaidAt(po.id, new Date());
                          toast.success('Marked as paid');
                          const updated = await getPOById(po.id);
                          setPO(updated);
                        } catch (e: any) {
                          toast.error(e.message || 'Failed');
                        }
                      }}
                    >
                      Mark as paid
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.item.sku}</p>
                          <p className="text-sm text-muted-foreground">{item.item.nameId}</p>
                        </div>
                      </TableCell>
                      <TableCell>{Number(item.qty).toLocaleString()}</TableCell>
                      <TableCell>{item.item.uom.code}</TableCell>
                      <TableCell className="text-right">
                        Rp {Number(item.price).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {(Number(item.qty) * Number(item.price)).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>
                        {Number(item.receivedQty).toLocaleString()} / {Number(item.qty).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Status History */}
          <Card>
            <CardHeader>
              <CardTitle>Status History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {po.statusHistory?.map((history: any, index: number) => (
                  <div key={history.id} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-2 h-2 rounded-full mt-[5px] mb-[5px] text-lg ${
                        index === 0 ? 'bg-primary' : 'bg-muted'
                      }`} />
                      {index < po.statusHistory.length - 1 && (
                        <div className="w-px h-8 bg-muted" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[history.status as POStatus]}>
                          {statusLabels[history.status as POStatus]}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(history.createdAt).toLocaleString('id-ID')}
                        </span>
                      </div>
                      {history.changedBy && (
                        <p className="text-sm text-muted-foreground mt-1">
                          by {history.changedBy.name || history.changedBy.email}
                        </p>
                      )}
                      {history.notes && (
                        <p className="text-sm mt-1">{history.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {canEdit && (
              <Button onClick={() => setIsEditMode(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit PO
              </Button>
            )}
            {canSubmit && (
              <Button
                onClick={() => handleStatusChange('SUBMITTED')}
                disabled={isSaving}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Submit PO
              </Button>
            )}
            {canCancel && (
              <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" disabled={isSaving}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel PO
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel Purchase Order</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to cancel this PO? Please provide a reason.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="cancelReason">Reason</Label>
                      <Textarea
                        id="cancelReason"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        placeholder="Enter cancellation reason..."
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCancelDialogOpen(false);
                        setCancelReason('');
                      }}
                    >
                      No, Keep PO
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => handleStatusChange('CANCELLED', cancelReason || 'PO Cancelled')}
                      disabled={isSaving}
                    >
                      Yes, Cancel PO
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </>
      )}

      <PinAuthModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
          setPendingUpdateData(null);
        }}
        onConfirm={handlePinConfirm}
        action={pendingAction === 'cancel' ? 'membatalkan PO' : 'menyunting PO yang sudah diposting'}
      />
    </div>
  );
}
