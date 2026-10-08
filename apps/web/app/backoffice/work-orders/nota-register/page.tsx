'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { formatDateOnly, formatDisplayDate, parseDateOnly, parseDateOnlyEnd } from '@/lib/date-only';
import { formatRupiah } from '@/lib/format/rupiah';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  getMaterialIssuesForCMTRegister,
  getMaterialIssueForPrint
} from '@/app/actions/production';
import { buildMaterialIssuePrintHtml } from '@/lib/print/material-issue-html';
import { logPrint } from '@/app/actions/audit';
import { Pagination } from '@/components/ui/pagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { LABEL_NOTA_CMT } from '../label-nota-cmt';

type RegisterRow = {
  id: string;
  woId?: string;
  docNumber: string;
  issueType: string;
  issuedAt: Date;
  totalCost: number;
  woDocNumber: string;
  vendorName: string;
};

export default function NotaRegisterPage() {
  const _t = useTranslations('toasts');
  void _t;
  const tNota = useTranslations('notaRegister');
  const tPlaceholders = useTranslations('placeholders');
  const tWO = useTranslations('workOrders');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const issueTypeLabel = (type: string) =>
    type === 'FABRIC' ? tNota('typeFabric') : type === 'ACCESSORIES' ? tNota('typeAccessories') : type;
  const [issues, setIssues] = useState<RegisterRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; code: string }[]>([]);
  // Saringan tinggal di URL (?vendor=&dari=&sampai=&jenis=&page=): berlaku
  // langsung saat diubah, bisa dibagikan, dan bertahan saat kembali.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const vendorId = searchParams.get('vendor') ?? '';
  const dateFrom = searchParams.get('dari') ?? '';
  const dateTo = searchParams.get('sampai') ?? '';
  const jenisUrl = searchParams.get('jenis');
  const issueType: 'FABRIC' | 'ACCESSORIES' | '' = jenisUrl === 'FABRIC' || jenisUrl === 'ACCESSORIES' ? jenisUrl : '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const [isLoading, setIsLoading] = useState(false);
  const [printIssueId, setPrintIssueId] = useState<string | null>(null);
  const [printData, setPrintData] = useState<Awaited<ReturnType<typeof getMaterialIssueForPrint>>>(null);
  const pageSize = DEFAULT_PAGE_SIZE;
  const [totalCount, setTotalCount] = useState(0);

  /** Ganti parameter URL sekaligus; saringan baru kembali ke halaman 1. */
  const setParams = useCallback(
    (ubah: Record<string, string | null>) => {
      const q = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(ubah)) {
        if (v == null || v === '') q.delete(k);
        else q.set(k, v);
      }
      if (!('page' in ubah)) q.delete('page');
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    import('@/app/actions/suppliers')
      .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true, approvedOnly: true }))
      .then((data: unknown) => setSuppliers(Array.isArray(data) ? data : []))
      .catch(() => {
        setSuppliers([]);
        toast.error(tNota('loadSuppliersFailed'));
      });
  }, [tNota]);

  const loadIssues = async () => {
    setIsLoading(true);
    try {
      const filters: { vendorId?: string; dateFrom?: Date; dateTo?: Date; issueType?: 'FABRIC' | 'ACCESSORIES' } = {};
      if (vendorId) filters.vendorId = vendorId;
      // Tanggal WIB; "sampai" inklusif sampai akhir harinya (dulu tengah malam UTC → hari terakhir hilang).
      if (dateFrom) filters.dateFrom = parseDateOnly(dateFrom);
      if (dateTo) filters.dateTo = parseDateOnlyEnd(dateTo);
      if (issueType) filters.issueType = issueType;
      const result = await getMaterialIssuesForCMTRegister(filters, { page, pageSize });
      if (result != null && typeof result === 'object' && 'items' in result && 'totalCount' in result) {
        setIssues((result as { items: RegisterRow[] }).items);
        setTotalCount((result as { totalCount: number }).totalCount);
      } else {
        const list = (result as RegisterRow[]) ?? [];
        setIssues(list);
        setTotalCount(list.length);
      }
    } catch {
      toast.error(tNota('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadIssues depends on filters
  }, [page, vendorId, dateFrom, dateTo, issueType]);

  const openPrint = (issueId: string) => {
    setPrintIssueId(issueId);
    setPrintData(null);
  };
  const closePrint = () => {
    setPrintIssueId(null);
    setPrintData(null);
  };
  useEffect(() => {
    if (!printIssueId) return;
    getMaterialIssueForPrint(printIssueId)
      .then(setPrintData)
      .catch(() => toast.error(tNota('printLoadFailed')));
  }, [printIssueId, tNota]);

  const handlePrint = async () => {
    if (!printData || !printIssueId) return;
    await logPrint('MaterialIssue', printIssueId);
    const html = buildMaterialIssuePrintHtml({
      docNumber: printData.docNumber,
      woDocNumber: printData.woDocNumber,
      vendorName: printData.vendorName,
      issuedAt: printData.issuedAt,
      issueType: printData.issueType,
      totalCost: printData.totalCost,
      lines: printData.lines,
      labels: LABEL_NOTA_CMT,
    });
    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
    iframe.setAttribute('title', 'Print Nota ke CMT');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      toast.error(tNota('printLoadFailed'));
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const removeIframe = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch {
        toast.error(tNota('printLoadFailed'));
      }
      setTimeout(removeIframe, 500);
    }, 350);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link
            href="/backoffice/work-orders"
            aria-label={tNota('backToWorkOrders')}
            title={tNota('backToWorkOrders')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{tNota('pageTitle')}</h1>
          <TombolBantuan judul={tNota('pageTitle')} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tNota('filterTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label>{tNota('vendorLabel')}</Label>
            <SearchableCombobox
              options={[
                { value: '_', label: tPlaceholders('all') },
                ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
              ]}
              value={vendorId || '_'}
              onValueChange={(v) => setParams({ vendor: v === '_' ? null : v })}
              placeholder={tPlaceholders('all')}
              triggerClassName="w-[220px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nota-date-range">{tNota('dateRangeLabel')}</Label>
            <DateRangePicker
              id="nota-date-range"
              triggerClassName="w-[220px]"
              value={{
                from: parseDateOnly(dateFrom),
                to: parseDateOnly(dateTo),
              }}
              onChange={(range) =>
                setParams({
                  dari: range?.from ? formatDateOnly(range.from) : null,
                  sampai: range?.to ? formatDateOnly(range.to) : null,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>{tNota('typeLabel')}</Label>
            <Select value={issueType || '_'} onValueChange={(v) => setParams({ jenis: v === '_' ? null : v })}>
              <SelectTrigger className="w-[140px]" aria-label={tNota('typeLabel')}>
                <SelectValue placeholder={tPlaceholders('all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">{tPlaceholders('all')}</SelectItem>
                <SelectItem value="FABRIC">{tNota('typeFabric')}</SelectItem>
                <SelectItem value="ACCESSORIES">{tNota('typeAccessories')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tNota('listTitle')}</CardTitle>
          <CardDescription>{tNota('issuesCount', { count: totalCount })}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && issues.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : issues.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">{tNota('emptyHint')}</p>
          ) : (
            <div className="border rounded-md overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tNota('colDoc')}</TableHead>
                    <TableHead>{tNota('colWo')}</TableHead>
                    <TableHead>{tNota('colVendor')}</TableHead>
                    <TableHead>{tNota('colType')}</TableHead>
                    <TableHead>{tNota('colDate')}</TableHead>
                    <TableHead className="text-right">{tNota('colTotalCost')}</TableHead>
                    <TableHead className="w-[80px]">{tNota('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.docNumber}</TableCell>
                      <TableCell>
                        {row.woId ? (
                          <Link href={`/backoffice/work-orders/${row.woId}`} className="hover:underline">
                            {row.woDocNumber}
                          </Link>
                        ) : (
                          row.woDocNumber
                        )}
                      </TableCell>
                      <TableCell className="min-w-[140px] whitespace-normal">{row.vendorName}</TableCell>
                      <TableCell>{issueTypeLabel(row.issueType)}</TableCell>
                      <TableCell>{formatDisplayDate(row.issuedAt, locale)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(row.totalCost)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPrint(row.id)}
                          aria-label={tNota('printNota', { docNumber: row.docNumber })}
                          title={tNota('printNota', { docNumber: row.docNumber })}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
            onPageChange={(p) => setParams({ page: p > 1 ? String(p) : null })}
            totalCount={totalCount}
            pageSize={pageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={!!printIssueId} onOpenChange={(open) => !open && closePrint()}>
        <DialogContent className="max-w-lg no-print">
          <style
            dangerouslySetInnerHTML={{
              __html: `@media print { .no-print { display: none !important; } }`,
            }}
          />
          <DialogHeader>
            <DialogTitle>{tWO('notaToCmt')}</DialogTitle>
          </DialogHeader>
          {printData ? (
            <div className="space-y-4">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">{tWO('docLabel')}</span> {printData.docNumber}</p>
                <p><span className="text-muted-foreground">{tWO('woLabel')}</span> {printData.woDocNumber}</p>
                <p><span className="text-muted-foreground">{tWO('vendorLabel')}</span> {printData.vendorName}</p>
                <p><span className="text-muted-foreground">{tWO('dateLabel')}</span> {formatDisplayDate(printData.issuedAt, locale)}</p>
                <p><span className="text-muted-foreground">{tWO('typeLabel')}</span> {issueTypeLabel(printData.issueType)}</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tWO('item')}</TableHead>
                    <TableHead className="text-right">{tWO('qty')}</TableHead>
                    <TableHead>{tNota('colUom')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printData.lines.map((line, i) => (
                    <TableRow key={i}>
                      <TableCell>{line.itemName}</TableCell>
                      <TableCell className="text-right">{line.qty.toLocaleString('id-ID')}</TableCell>
                      <TableCell>{line.uomCode}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="font-semibold">
                {tWO('totalCost')}: {formatRupiah(printData.totalCost)}
              </p>
              <div className="flex gap-2 no-print">
                <Button variant="outline" onClick={closePrint}>{tWO('close')}</Button>
                <Button onClick={handlePrint}><Printer className="mr-2 h-4 w-4" />{tWO('print')}</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{tCommon('loading')}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
