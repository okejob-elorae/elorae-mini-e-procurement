'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DollarSign, Eye, Calendar, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getPOs, setPOPaidAt } from '@/app/actions/purchase-orders';
import { POStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';

interface POForPayment {
  id: string;
  docNumber: string;
  status: POStatus;
  paymentDueDate: Date | null;
  paidAt: Date | null;
  grandTotal: number;
  supplier: { name: string; code: string };
}

const PAYMENT_STATUS = { all: 'all', paid: 'paid', unpaid: 'unpaid' } as const;

export default function SupplierPaymentsPage() {
  const [pos, setPOs] = useState<POForPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [supplierId, setSupplierId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);

  const fetchSuppliers = async () => {
    try {
      const res = await fetch('/api/suppliers?sync=true');
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.map((s: { id: string; name: string; code: string }) => ({ id: s.id, name: s.name, code: s.code })));
      }
    } catch {
      // ignore
    }
  };

  const fetchPOs = async () => {
    setIsLoading(true);
    try {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : undefined;
      const to = dateTo ? new Date(dateTo + 'T23:59:59') : undefined;
      const result = await getPOs(
        {
          statusIn: ['SUBMITTED', 'PARTIAL', 'CLOSED', 'OVER'],
          supplierId: supplierId || undefined,
          paymentDueFrom: from,
          paymentDueTo: to,
          paid: paymentFilter === 'all' ? undefined : paymentFilter === 'paid',
        },
        { page, pageSize }
      );
      const mapPo = (po: any) => ({
        id: po.id,
        docNumber: po.docNumber,
        status: po.status,
        paymentDueDate: po.paymentDueDate ? new Date(po.paymentDueDate) : null,
        paidAt: po.paidAt ? new Date(po.paidAt) : null,
        grandTotal: Number(po.grandTotal),
        supplier: po.supplier,
      });
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        const r = result as { items: any[]; totalCount: number };
        setPOs(r.items.map(mapPo));
        setTotalCount(r.totalCount);
      } else {
        const list = (result as any[]) ?? [];
        setPOs(list.map(mapPo));
        setTotalCount(list.length);
      }
    } catch {
      toast.error('Failed to load POs');
      setPOs([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [supplierId, dateFrom, dateTo, paymentFilter]);

  useEffect(() => {
    fetchPOs();
  }, [supplierId, dateFrom, dateTo, paymentFilter, page, pageSize]);

  const unpaidTotal = pos.filter((p) => !p.paidAt).reduce((sum, p) => sum + p.grandTotal, 0);
  const paidCount = pos.filter((p) => p.paidAt).length;
  const unpaidCount = pos.filter((p) => !p.paidAt).length;

  const handleMarkPaid = async (poId: string, paid: boolean) => {
    try {
      await setPOPaidAt(poId, paid ? new Date() : null);
      toast.success(paid ? 'Marked as paid' : 'Marked as unpaid');
      fetchPOs();
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Supplier Payment</h1>
        <p className="text-muted-foreground">
          View and record supplier payments by PO
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label>Supplier</Label>
            <Select value={supplierId || 'all'} onValueChange={(v) => setSupplierId(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment due from</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Payment due to</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Payment status</Label>
            <Select value={paymentFilter} onValueChange={(v: 'all' | 'paid' | 'unpaid') => setPaymentFilter(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Mini dashboard */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Outstanding (unpaid)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">Rp {unpaidTotal.toLocaleString('id-ID')}</p>
            <p className="text-xs text-muted-foreground">{unpaidCount} PO(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unpaid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{unpaidCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{paidCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Purchase orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : pos.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No POs match the filters.</p>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Payment due</TableHead>
                  <TableHead>Paid date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">
                      <Link href={`/backoffice/purchase-orders/${po.id}`} className="text-primary hover:underline">
                        {po.docNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{po.supplier.name}</p>
                        <p className="text-sm text-muted-foreground">{po.supplier.code}</p>
                      </div>
                    </TableCell>
                    <TableCell>Rp {po.grandTotal.toLocaleString('id-ID')}</TableCell>
                    <TableCell>
                      {po.paymentDueDate ? po.paymentDueDate.toLocaleDateString('id-ID') : '-'}
                    </TableCell>
                    <TableCell>
                      {po.paidAt ? po.paidAt.toLocaleDateString('id-ID') : '-'}
                    </TableCell>
                    <TableCell>
                      {po.paidAt ? (
                        <Badge variant="default" className="bg-green-600">Paid</Badge>
                      ) : (
                        <Badge variant="secondary">Unpaid</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/backoffice/purchase-orders/${po.id}`}>
                          <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        {po.paidAt ? (
                          <Button variant="outline" size="sm" onClick={() => handleMarkPaid(po.id, false)}>
                            Unmark
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => handleMarkPaid(po.id, true)}>
                            Mark paid
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
              onPageChange={setPage}
              totalCount={totalCount}
              pageSize={pageSize}
            />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
