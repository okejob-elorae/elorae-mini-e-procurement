'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Search, 
  ShoppingCart, 
  Eye,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { getPOs, submitPO, cancelPO } from '@/app/actions/purchase-orders';
import { POStatus } from '@/lib/constants/enums';
import { ETABadge } from '@/components/ui/ETABadge';

interface PurchaseOrder {
  id: string;
  docNumber: string;
  status: POStatus;
  etaDate: string | null;
  totalAmount: string;
  grandTotal: string;
  createdAt: string;
  supplier: {
    name: string;
    code: string;
  };
  items: Array<{
    qty: string;
    receivedQty: string;
    item: {
      sku: string;
      nameId: string;
    };
  }>;
  _count: {
    grns: number;
  };
  etaAlert?: {
    status: 'normal' | 'warning' | 'danger' | 'completed';
    message: string;
    daysUntil: number;
  };
}

const statusLabels: Record<POStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PARTIAL: 'Partial',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled'
};

const statusColors: Record<POStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SUBMITTED: 'bg-blue-100 text-blue-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  CLOSED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800'
};

const statusIcons: Record<POStatus, React.ReactNode> = {
  DRAFT: <Clock className="h-4 w-4" />,
  SUBMITTED: <CheckCircle className="h-4 w-4" />,
  PARTIAL: <AlertCircle className="h-4 w-4" />,
  CLOSED: <CheckCircle className="h-4 w-4" />,
  CANCELLED: <XCircle className="h-4 w-4" />
};

export default function PurchaseOrdersPage() {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | ''>('');

  const fetchPOs = async () => {
    setIsLoading(true);
    try {
      const data = await getPOs({
        status: statusFilter || undefined
      });
      setPOs(data as PurchaseOrder[]);
    } catch (error) {
      toast.error('Failed to load purchase orders');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPOs();
  }, [statusFilter]);

  const handleSubmit = async (id: string) => {
    try {
      await submitPO(id, 'user-id'); // TODO: Get actual user ID
      toast.success('PO submitted successfully');
      fetchPOs();
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit PO');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this PO?')) return;
    
    try {
      await cancelPO(id, 'user-id'); // TODO: Get actual user ID
      toast.success('PO cancelled successfully');
      fetchPOs();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel PO');
    }
  };

  const isOverdue = (po: PurchaseOrder) => {
    if (!po.etaDate || po.status === 'CLOSED' || po.status === 'CANCELLED') return false;
    return new Date(po.etaDate) < new Date();
  };

  const getPendingQty = (po: PurchaseOrder) => {
    return po.items.reduce((sum, item) => 
      sum + (Number(item.qty) - Number(item.receivedQty)), 0
    );
  };

  const filteredPOs = pos.filter(po => 
    po.docNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    po.supplier.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">
            Manage procurement and track deliveries
          </p>
        </div>
        <Link href="/backoffice/purchase-orders/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New PO
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search PO number or supplier..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as POStatus | '')}
          className="px-3 py-2 rounded-md border bg-background"
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="PARTIAL">Partial</option>
          <option value="CLOSED">Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* POs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Purchase Order List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredPOs.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No purchase orders found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPOs.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.docNumber}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{po.supplier.name}</p>
                          <p className="text-sm text-muted-foreground">{po.supplier.code}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[po.status]}>
                          {statusIcons[po.status]}
                          <span className="ml-1">{statusLabels[po.status]}</span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {po.etaDate ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {new Date(po.etaDate).toLocaleDateString('id-ID')}
                            </div>
                            <ETABadge etaDate={new Date(po.etaDate)} status={po.status} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {Number(po.grandTotal).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {getPendingQty(po).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Link href={`/backoffice/purchase-orders/${po.id}`}>
                            <Button variant="ghost" size="icon">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {po.status === 'DRAFT' && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleSubmit(po.id)}
                            >
                              Submit
                            </Button>
                          )}
                          {(po.status === 'DRAFT' || po.status === 'SUBMITTED') && (
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-destructive"
                              onClick={() => handleCancel(po.id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
