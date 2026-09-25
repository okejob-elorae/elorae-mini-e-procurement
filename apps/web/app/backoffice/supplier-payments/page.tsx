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
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { formatDateOnly, formatDisplayDate, parseDateOnly } from '@/lib/date-only';
import { PageHeader } from '@/components/ui/page-header';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { getPOById, getPOs, setPOPaidAt } from '@/app/actions/purchase-orders';
import { supplierPaymentJournalErrorKey } from '@/lib/purchasing/supplier-payment-journal-message';
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
  /**
   * Unpaid while a payment journal from an earlier mark still stands on the
   * ledger. Computed server-side by the list query — the same condition the PO
   * detail page gates its own mark on, so the two screens cannot disagree about
   * which POs are safe to mark paid.
   */
  paymentJournalStandingWhileUnpaid: boolean;
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
  const [togglingPoId, setTogglingPoId] = useState<string | null>(null);
  const tSupplierPayments = useTranslations('supplierPayments');
  const tTable = useTranslations('tableHeaders');
  const locale = useLocale();

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
        { page, pageSize },
        /* This register offers the paid toggle, so it needs the same
           standing-payment verdict the PO detail page gates its mark on. Asked
           for explicitly because it costs its own queries — a fixed three for
           the whole page, not three per row. */
        { withStandingPaymentJournal: true }
      );
      const mapPo = (po: any) => ({
        id: po.id,
        docNumber: po.docNumber,
        status: po.status,
        paymentDueDate: po.paymentDueDate ? new Date(po.paymentDueDate) : null,
        paidAt: po.paidAt ? new Date(po.paidAt) : null,
        grandTotal: Number(po.grandTotal),
        supplier: po.supplier,
        paymentJournalStandingWhileUnpaid: Boolean(po.paymentJournalStandingWhileUnpaid),
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
      toast.error(tSupplierPayments('loadFailed'));
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

  /**
   * The toggle always commits, so the outcome — not the absence of a throw —
   * decides what the operator is told. A journal failure means the ledger does
   * not reflect this toggle: for most payment codes because payables and bank
   * were left untouched, for `PAYMENT_SUPERSEDED` because they still hold an
   * earlier payment for a different amount, and on the reversal half because they
   * still hold the payment this unmark failed to undo. Reporting "Marked as paid"
   * for any of those is positive confirmation of something that did not happen,
   * and the only other trace is an `AdminNotification` row nothing in the UI
   * renders yet. Which case it is, and the remedy, come from the message the code
   * AND the direction resolve to — the same failure means opposite things on the
   * two halves of the toggle.
   *
   * `refusal` is checked FIRST because it also carries `changed: false`, and the
   * no-op message would be wrong for it twice over: nothing was written, but the
   * PO was NOT already in the requested state, and unmark-then-re-mark cannot
   * reach the reversal that is actually missing. The button is withheld for this
   * state, so reaching it means the list was stale — and the remedy is on the PO
   * detail page, which is what this surface's own message says.
   *
   * `changed: false` is checked next and never reported as success: the PO was
   * already in the requested state, so nothing was written and no journal was
   * attempted. Green-toasting that is the same lie as green-toasting a failed
   * post — worse from a stale list, where a re-mark whose first attempt left a
   * ledger gap would read as a fresh clean payment. The neutral toast names the
   * state the PO is actually in and points at the only remedy that reopens a
   * journal attempt.
   */
  const handleMarkPaid = async (poId: string, paid: boolean) => {
    setTogglingPoId(poId);
    try {
      const result = await setPOPaidAt(poId, paid ? new Date() : null);
      if (result.refusal) {
        toast.warning(tSupplierPayments('standingPayment.markRefusedRegister'), { duration: 12000 });
      } else if (!result.changed) {
        toast.info(
          tSupplierPayments(paid ? 'noop.alreadyPaid' : 'noop.alreadyUnpaid'),
          { duration: 10000 }
        );
      } else if (result.journalFailure) {
        const failure = result.journalFailure;
        /*
         * `UNMAPPED_ROLE` is the only one of these messages that interpolates a
         * value, so it is resolved from its literal key to keep next-intl's
         * parameter typing intact. Passing values alongside the computed key
         * would widen the whole call to `never` and drop that check.
         */
        const warning =
          failure.code === 'UNMAPPED_ROLE'
            ? tSupplierPayments('journal.err.UNMAPPED_ROLE', { role: failure.role ?? '' })
            : tSupplierPayments(
                supplierPaymentJournalErrorKey(failure.code, failure.direction) as never
              );
        toast.warning(warning, { duration: 12000 });
      } else {
        toast.success(
          paid ? tSupplierPayments('markedPaid') : tSupplierPayments('markedUnpaid')
        );
      }
      fetchPOs();
    } catch (e: any) {
      toast.error(e.message || tSupplierPayments('actionFailed'));
    } finally {
      setTogglingPoId(null);
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
        toast.error(tSupplierPayments('poNotFound'));
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
      toast.error(e instanceof Error ? e.message : tSupplierPayments('printFailed'));
    } finally {
      setPrintingPoId(null);
    }
  };

  const handlePrintReceipt = async (poId: string) => {
    setPrintingPoId(poId);
    try {
      const po = await getPOById(poId);
      if (!po) {
        toast.error(tSupplierPayments('poNotFound'));
        return;
      }
      if (!po.paidAt) {
        toast.error(tSupplierPayments('receiptNeedsPaid'));
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
      toast.error(e instanceof Error ? e.message : tSupplierPayments('printFailed'));
    } finally {
      setPrintingPoId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={tSupplierPayments('pageTitle')}
        description={tSupplierPayments('pageDescription')}
      />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tSupplierPayments('filtersTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-2">
            <Label>{tSupplierPayments('supplierLabel')}</Label>
            <SearchableCombobox
              options={[
                { value: 'all', label: tSupplierPayments('allSuppliers') },
                ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
              ]}
              value={supplierId || 'all'}
              onValueChange={(v) => setSupplierId(v === 'all' ? '' : v)}
              placeholder={tSupplierPayments('allSuppliers')}
              triggerClassName="w-[200px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-due-range">{tSupplierPayments('dueRangeLabel')}</Label>
            <DateRangePicker
              id="payment-due-range"
              triggerClassName="w-[220px]"
              value={{
                from: parseDateOnly(dateFrom),
                to: parseDateOnly(dateTo),
              }}
              onChange={(range) => {
                setDateFrom(range?.from ? formatDateOnly(range.from) : '');
                setDateTo(range?.to ? formatDateOnly(range.to) : '');
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>{tSupplierPayments('paymentStatusLabel')}</Label>
            <Select value={paymentFilter} onValueChange={(v: 'all' | 'paid' | 'unpaid') => setPaymentFilter(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tSupplierPayments('filterAll')}</SelectItem>
                <SelectItem value="paid">{tSupplierPayments('paid')}</SelectItem>
                <SelectItem value="unpaid">{tSupplierPayments('unpaid')}</SelectItem>
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
              {tSupplierPayments('outstandingTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">Rp {unpaidTotal.toLocaleString('id-ID')}</p>
            <p className="text-xs text-muted-foreground">
              {tSupplierPayments('poCount', { count: unpaidCount })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tSupplierPayments('unpaid')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{unpaidCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tSupplierPayments('paid')}
            </CardTitle>
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
            {tSupplierPayments('listTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : pos.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {tSupplierPayments('noPOsMatchFilters')}
            </p>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tTable('poNumber')}</TableHead>
                  <TableHead className="min-w-[160px]">{tTable('supplier')}</TableHead>
                  <TableHead>{tSupplierPayments('colTotal')}</TableHead>
                  <TableHead>{tSupplierPayments('colDue')}</TableHead>
                  <TableHead>{tSupplierPayments('colPaidDate')}</TableHead>
                  <TableHead>{tTable('status')}</TableHead>
                  <TableHead className="sticky right-0 min-w-[220px] bg-card text-right">
                    {tSupplierPayments('colActions')}
                  </TableHead>
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
                    <TableCell className="whitespace-normal">
                      <div>
                        <p className="font-medium">{po.supplier.name}</p>
                        <p className="text-sm text-muted-foreground">{po.supplier.code}</p>
                      </div>
                    </TableCell>
                    <TableCell>Rp {po.grandTotal.toLocaleString('id-ID')}</TableCell>
                    <TableCell>
                      {po.paymentDueDate ? formatDisplayDate(po.paymentDueDate, locale) : '-'}
                    </TableCell>
                    <TableCell>
                      {po.paidAt ? formatDisplayDate(po.paidAt, locale) : '-'}
                    </TableCell>
                    <TableCell>
                      {po.paidAt ? (
                        <Badge variant="default" className="bg-green-600">
                          {tSupplierPayments('paid')}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{tSupplierPayments('unpaid')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Link href={`/backoffice/purchase-orders/${po.id}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={tSupplierPayments('viewPO')}
                            aria-label={tSupplierPayments('viewPO')}
                          >
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
                            >
                              <Printer className="h-3.5 w-3.5" />
                              {tSupplierPayments('print')}
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                void handlePrintInvoice(po.id);
                              }}
                            >
                              {tSupplierPayments('printInvoice')}
                            </DropdownMenuItem>
                            {po.paidAt ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  void handlePrintReceipt(po.id);
                                }}
                              >
                                {tSupplierPayments('printReceipt')}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {po.paidAt ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={togglingPoId === po.id}
                            onClick={() => handleMarkPaid(po.id, false)}
                          >
                            {togglingPoId === po.id
                              ? tSupplierPayments('unmarking')
                              : tSupplierPayments('unmark')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={togglingPoId === po.id || po.paymentJournalStandingWhileUnpaid}
                            onClick={() => handleMarkPaid(po.id, true)}
                          >
                            {togglingPoId === po.id
                              ? tSupplierPayments('marking')
                              : tSupplierPayments('markPaid')}
                          </Button>
                        )}
                      </div>
                      {po.paymentJournalStandingWhileUnpaid && (
                        <p className="mt-1 ml-auto max-w-[260px] text-left text-xs text-amber-700 dark:text-amber-400">
                          {tSupplierPayments('standingPayment.markBlockedRegister')}
                        </p>
                      )}
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
