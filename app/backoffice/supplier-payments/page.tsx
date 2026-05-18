'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DollarSign, Eye, CheckCircle, ChevronDown, Printer } from 'lucide-react';
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
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
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
import { getPOById, getPOs, setPOPaidAt } from '@/app/actions/purchase-orders';
import { logPrint } from '@/app/actions/audit';
import { buildPOPrintHtml } from '@/lib/print/po-html';
import { buildPOPaymentReceiptHtml } from '@/lib/print/po-payment-receipt-html';
import { variantDetailForSku } from '@/lib/items/variants';
import { POStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const statusLabels: Record<POStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PARTIAL: 'Partial',
  CLOSED: 'Closed',
  OVER: 'Over-received',
  CANCELLED: 'Cancelled',
};

function printHtmlInIframe(html: string, iframeTitle: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
  iframe.setAttribute('title', iframeTitle);
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
  }, 1000);
}

interface POForPayment {
  id: string;
  docNumber: string;
  status: POStatus;
  paymentDueDate: Date | null;
  paidAt: Date | null;
  grandTotal: number;
  supplier: { name: string; code: string };
}

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
  const [printingPoId, setPrintingPoId] = useState<string | null>(null);

  const fetchSuppliers = async () => {
    try {
      const { getSuppliersForSelect } = await import('@/app/actions/suppliers');
      const data = await getSuppliersForSelect({ sync: true, approvedOnly: true });
      const list = Array.isArray(data) ? data : [];
      setSuppliers(list.map((s: { id: string; name: string; code: string }) => ({ id: s.id, name: s.name, code: s.code })));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPOs depends on filters
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

  const buildLinesFromPO = (po: NonNullable<Awaited<ReturnType<typeof getPOById>>>) =>
    (po.items ?? []).map((item) => {
      const variantSku = item.variantSku ?? null;
      return {
        itemName:
          item.item?.nameId ?? item.item?.nameEn ?? item.item?.sku ?? '',
        itemSku: item.item?.sku,
        variantSku,
        variantDetail: variantDetailForSku(item.item?.variants, variantSku),
        lineNotes: item.notes?.trim() ? String(item.notes).trim() : null,
        qty: Number(item.qty ?? 0),
        uomCode: item.item?.uom?.code ?? '',
        price: Number(item.price ?? 0),
        amount: Number(item.qty ?? 0) * Number(item.price ?? 0),
      };
    });

  const handlePrintInvoice = async (poId: string) => {
    setPrintingPoId(poId);
    try {
      const po = await getPOById(poId);
      if (!po) {
        toast.error('PO not found');
        return;
      }
      await logPrint('PurchaseOrderInvoice', poId);
      const supplier = po.supplier as {
        name: string;
        code?: string;
        address?: string | null;
      };
      const html = buildPOPrintHtml({
        docNumber: po.docNumber,
        issuedAt: po.createdAt,
        supplierName: supplier.name,
        supplierAddress: supplier.address ?? null,
        supplierCode: supplier.code?.trim() ? supplier.code : null,
        status: statusLabels[po.status as POStatus],
        etaDate: po.etaDate,
        paymentDueDate: po.paymentDueDate,
        currency: po.currency ?? 'IDR',
        subtotal: Number(po.totalAmount ?? 0),
        taxAmount: Number(po.taxAmount ?? 0),
        grandTotal: Number(po.grandTotal ?? 0),
        notes: po.notes ?? null,
        terms: po.terms ?? null,
        lines: buildLinesFromPO(po),
        labels: {
          title: 'Purchase invoice',
          doc: 'PO Number',
          date: 'Date',
          issuedBy: 'Issued by',
          supplier: 'Bill to',
          address: 'Address',
          attn: 'Attn:',
          status: 'Status',
          etaDate: 'ETA',
          terms: 'Terms',
          paymentDue: 'Payment due',
          item: 'Item description',
          qty: 'Qty',
          uom: 'UOM',
          price: 'Unit price',
          amount: 'Amount',
          subtotal: 'Subtotal',
          tax: 'Tax',
          grandTotal: 'Grand total',
          notes: 'Notes',
          termsFooter: 'Terms & conditions',
        },
      });
      printHtmlInIframe(html, 'Print purchase invoice');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to print');
    } finally {
      setPrintingPoId(null);
    }
  };

  const handlePrintReceipt = async (poId: string) => {
    setPrintingPoId(poId);
    try {
      const po = await getPOById(poId);
      if (!po) {
        toast.error('PO not found');
        return;
      }
      if (!po.paidAt) {
        toast.error('Mark this PO as paid before printing a receipt');
        return;
      }
      await logPrint('PurchaseOrderPaymentReceipt', poId);
      const supplier = po.supplier as {
        name: string;
        code: string;
        address?: string | null;
      };
      const receiptNumber = `PR-${po.docNumber.replace(/\//g, '-')}`;
      const html = buildPOPaymentReceiptHtml({
        receiptNumber,
        poDocNumber: po.docNumber,
        supplierName: supplier.name,
        supplierCode: supplier.code ?? '',
        supplierAddress: supplier.address ?? null,
        paidAt: po.paidAt,
        printedAt: new Date(),
        currency: po.currency ?? 'IDR',
        amountPaid: Number(po.grandTotal ?? 0),
        labels: {
          title: 'Receipt',
          issuedBy: 'Issued by',
          receiptNo: 'Receipt No.',
          paymentDate: 'Payment date',
          payee: 'Payee',
          supplierCode: 'Code',
          poRef: 'PO reference',
          status: 'Status',
          statusPaid: 'Paid in full',
          printed: 'Printed',
          grandLabel: 'Amount paid',
          footerTitle: 'Notice',
          footerNote:
            'This receipt reflects the payment status recorded in Elorae. Retain for your records.',
        },
      });
      printHtmlInIframe(html, 'Print payment receipt');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to print');
    } finally {
      setPrintingPoId(null);
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
            <SearchableCombobox
              options={[
                { value: 'all', label: 'All suppliers' },
                ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
              ]}
              value={supplierId || 'all'}
              onValueChange={(v) => setSupplierId(v === 'all' ? '' : v)}
              placeholder="All suppliers"
              triggerClassName="w-[200px]"
            />
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
                  <TableHead className="min-w-[220px] text-right">Actions</TableHead>
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
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Link href={`/backoffice/purchase-orders/${po.id}`}>
                          <Button variant="ghost" size="icon" title="View PO">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              disabled={printingPoId === po.id}
                              title="Print"
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Print
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                void handlePrintInvoice(po.id);
                              }}
                            >
                              Print invoice
                            </DropdownMenuItem>
                            {po.paidAt ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  void handlePrintReceipt(po.id);
                                }}
                              >
                                Print receipt
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
