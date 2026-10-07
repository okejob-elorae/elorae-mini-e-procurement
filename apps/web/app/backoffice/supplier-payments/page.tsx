'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DollarSign, Eye, CheckCircle, ChevronDown, Printer, Hourglass } from 'lucide-react';
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
import { getPOById, getPOs, getPemasokPilihan, setPOPaidAt } from '@/app/actions/purchase-orders';
import { pisahUtangPo, ringkasUtangBelumDibayar, utangBaris } from './nilai-utang';
import { KonfirmasiBayarDialog } from './KonfirmasiBayarDialog';
import { TAUTAN_DOKUMEN } from '@/app/backoffice/purchase-orders/tautan-dokumen';
import { supplierPaymentJournalErrorKey } from '@/lib/purchasing/supplier-payment-journal-message';
import { logPrint } from '@/app/actions/audit';
import { LABEL_CETAK_FAKTUR_PO, buildPOPrintHtml, labelStatusCetakPo } from '@/lib/print/po-html';
import { buildPOPaymentReceiptHtml } from '@/lib/print/po-payment-receipt-html';
import { variantDetailForSku } from '@/lib/items/variants';
import type { POStatus } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  /** Utang sesudah sisa yang tidak datang (Tutup PO) dan retur pemasok — dari `listPOs`. */
  utang: number;
  /** Utang barang yang SUDAH diterima vs komitmen PO yang belum datang (`pisahUtangPo`). */
  utangDiterima: number;
  komitmen: number;
  adaPenerimaan: boolean;
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
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string; disetujui: boolean }>>([]);
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
  // Konfirmasi tandai/batal lunas (dulu satu klik langsung memposting jurnal).
  const [konfirmasi, setKonfirmasi] = useState<{ po: POForPayment; arah: 'bayar' | 'batal' } | null>(null);
  const tSupplierPayments = useTranslations('supplierPayments');
  const tTable = useTranslations('tableHeaders');
  const tPO = useTranslations('purchaseOrders');
  const locale = useLocale();

  const fetchSuppliers = async () => {
    try {
      // Pemasok yang disetujui ATAU punya dokumen: saringan "disetujui saja" dulu menyembunyikan
      // pemasok PO yang belum dibayar, jadi saringannya tidak bisa dipakai.
      setSuppliers(await getPemasokPilihan());
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
      const mapPo = (po: any): POForPayment => {
        const pisah = pisahUtangPo({
          grandTotal: po.grandTotal,
          ppnRatePercent: po.ppnRatePercent ?? null,
          utang: po.utang,
          items: po.items ?? [],
        });
        return {
          id: po.id,
          docNumber: po.docNumber,
          status: po.status,
          paymentDueDate: po.paymentDueDate ? new Date(po.paymentDueDate) : null,
          paidAt: po.paidAt ? new Date(po.paidAt) : null,
          grandTotal: Number(po.grandTotal),
          utang: utangBaris(po),
          utangDiterima: pisah.utangDiterima,
          komitmen: pisah.komitmen,
          adaPenerimaan: (po.items ?? []).some((l: { receivedQty: unknown }) => Number(l.receivedQty) > 0),
          supplier: po.supplier,
          paymentJournalStandingWhileUnpaid: Boolean(po.paymentJournalStandingWhileUnpaid),
        };
      };
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

  // Belum dibayar dipisah: utang barang yang SUDAH diterima vs komitmen PO yang belum datang.
  const ringkasan = ringkasUtangBelumDibayar(pos);
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
  const handleMarkPaid = async (poId: string, paidAt: Date | null) => {
    const paid = paidAt != null;
    setTogglingPoId(poId);
    try {
      const result = await setPOPaidAt(poId, paidAt);
      if (result.refusal === 'TANGGAL_TIDAK_SAH') {
        toast.error(tSupplierPayments('konfirmasi.tanggalSalah'));
      } else if (result.refusal) {
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
      setKonfirmasi(null);
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
        status: labelStatusCetakPo(po.status),
        etaDate: po.etaDate,
        paymentDueDate: po.paymentDueDate,
        currency: po.currency ?? 'IDR',
        subtotal: Number(po.totalAmount ?? 0),
        taxAmount: Number(po.taxAmount ?? 0),
        grandTotal: Number(po.grandTotal ?? 0),
        notes: po.notes ?? null,
        terms: po.terms ?? null,
        lines: buildLinesFromPO(po),
        labels: LABEL_CETAK_FAKTUR_PO,
      });
      printHtmlInIframe(html, tSupplierPayments('printInvoice'));
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
        // Yang dibayar = utang PO (sesudah sisa yang tidak datang dan retur pemasok), bukan total PO.
        amountPaid: Number(po.utang?.utang ?? po.grandTotal ?? 0),
      });
      printHtmlInIframe(html, tSupplierPayments('printReceipt'));
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
                ...suppliers.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${s.code})${s.disetujui ? '' : ` · ${tSupplierPayments('belumDisetujui')}`}`,
                })),
              ]}
              value={supplierId || 'all'}
              onValueChange={(v) => setSupplierId(v === 'all' ? '' : v)}
              placeholder={tSupplierPayments('allSuppliers')}
              searchPlaceholder={tSupplierPayments('cariPemasok')}
              triggerClassName="w-[220px]"
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

      {/* Mini dashboard: utang (barang diterima) dipisah dari komitmen PO (belum diterima). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              {tSupplierPayments('utangDiterimaJudul')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">Rp {ringkasan.utangDiterima.toLocaleString('id-ID')}</p>
            <p className="text-xs text-muted-foreground">
              {tSupplierPayments('poCount', { count: ringkasan.jumlahPoUtang })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Hourglass className="h-4 w-4" />
              {tSupplierPayments('komitmenJudul')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">Rp {ringkasan.komitmen.toLocaleString('id-ID')}</p>
            <p className="text-xs text-muted-foreground">
              {tSupplierPayments('poCount', { count: ringkasan.jumlahPoKomitmen })}
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
                      <Link href={`/backoffice/purchase-orders/${po.id}`} className={TAUTAN_DOKUMEN}>
                        {po.docNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div>
                        <p className="font-medium">{po.supplier.name}</p>
                        <p className="text-sm text-muted-foreground">{po.supplier.code}</p>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      Rp {po.grandTotal.toLocaleString('id-ID')}
                      {!po.paidAt && (
                        <div className="text-xs text-muted-foreground">
                          {tSupplierPayments('utangSingkatDiterima', { nilai: `Rp ${po.utangDiterima.toLocaleString('id-ID')}` })}
                        </div>
                      )}
                      {po.paidAt && po.utang !== po.grandTotal && (
                        <div className="text-xs text-muted-foreground">
                          {tPO('ringkasan.utangSingkat', { nilai: `Rp ${po.utang.toLocaleString('id-ID')}` })}
                        </div>
                      )}
                    </TableCell>
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
                            onClick={() => setKonfirmasi({ po, arah: 'batal' })}
                          >
                            {togglingPoId === po.id
                              ? tSupplierPayments('unmarking')
                              : tSupplierPayments('unmark')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={togglingPoId === po.id || po.paymentJournalStandingWhileUnpaid}
                            onClick={() => setKonfirmasi({ po, arah: 'bayar' })}
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

      <KonfirmasiBayarDialog
        open={konfirmasi !== null}
        onOpenChange={(buka) => !buka && setKonfirmasi(null)}
        arah={konfirmasi?.arah ?? 'bayar'}
        po={
          konfirmasi
            ? {
                docNumber: konfirmasi.po.docNumber,
                supplierName: konfirmasi.po.supplier.name,
                grandTotal: konfirmasi.po.grandTotal,
                utangDiterima: konfirmasi.po.utangDiterima,
                komitmen: konfirmasi.po.komitmen,
                adaPenerimaan: konfirmasi.po.adaPenerimaan,
              }
            : null
        }
        sibuk={konfirmasi != null && togglingPoId === konfirmasi.po.id}
        onKonfirmasi={(paidAt) => {
          if (!konfirmasi) return;
          // "Tandai lunas" tanpa tanggal sah tidak boleh jatuh menjadi "batal lunas".
          if (konfirmasi.arah === 'bayar' && paidAt == null) return;
          void handleMarkPaid(konfirmasi.po.id, konfirmasi.arah === 'bayar' ? paidAt : null);
        }}
      />
    </div>
  );
}
