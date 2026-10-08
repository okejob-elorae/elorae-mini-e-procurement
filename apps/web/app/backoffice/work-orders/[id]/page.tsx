'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  Loader2,
  Package,
  Calendar,
  ClipboardList,
  Truck,
  BarChart3,
  Pencil
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-only';
import {
  getWorkOrderById,
  getWorkOrderRollAllocationStatus,
  getMaterialIssueForPrint,
  updateWOHppAdjustments,
  getAdditionalMaterialsPreview,
  issueAdditionalMaterials,
  postFgReceiptJournalAction,
} from '@/app/actions/production';
import { buildMaterialIssuePrintHtml } from '@/lib/print/material-issue-html';
import { buildNotaKainHtml } from "./nota-kain-html";
import { logPrint } from '@/app/actions/audit';
import { WOStatus } from '@/lib/constants/enums';
import { ChainPositionStrip } from '@/components/lead-time/chain-position-strip';
import type { SnapshotStep } from '@/lib/leadtime/calculations';
import { PERMISSIONS, hasPermission } from '@/lib/rbac';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { newLocalId } from '@/lib/pwa/id-lokal';
import { formatRupiah } from '@/lib/format/rupiah';
import { hariTerlambatWo } from '@/lib/production/terlambat';
import { DialogBatalWo } from '../DialogBatalWo';
import { DialogTerbitWo } from '../DialogTerbitWo';
import { KartuBahanWo } from './KartuBahanWo';
import { LABEL_NOTA_CMT } from '../label-nota-cmt';
import { angkaSetoranWo } from '@/lib/production/setoran-wo';
import { CatatanTanpaDokumen, RingkasSetoran } from '../RingkasSetoran';
import { WoTidakDitemukan } from '../WoTidakDitemukan';

/** Tab yang boleh ada di `?tab=`. */
const TAB_WO = ['details', 'issues', 'receipts', 'hpp'] as const;


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
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const t = useTranslations('production');
  const tToasts = useTranslations('toasts');
  const tWO = useTranslations('workOrders');
  const tTolak = useTranslations('productionErrors');
  const tD = useTranslations('workOrders.detail');
  const tNota = useTranslations('notaRegister');
  const tTable = useTranslations('tableHeaders');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const issueTypeLabel = (type: string) =>
    type === 'FABRIC' ? tNota('typeFabric') : type === 'ACCESSORIES' ? tNota('typeAccessories') : type;
  const statusLabels: Record<WOStatus, string> = {
    DRAFT: tWO('draft'),
    ISSUED: tWO('issued'),
    IN_PRODUCTION: tWO('inProduction'),
    PARTIAL: tWO('partial'),
    COMPLETED: tWO('completed'),
    CANCELLED: tWO('cancelled'),
  };
  const id = typeof params.id === 'string' ? params.id : '';
  const [wo, setWO] = useState<Awaited<ReturnType<typeof getWorkOrderById>>>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [printIssueId, setPrintIssueId] = useState<string | null>(null);
  const [printData, setPrintData] = useState<Awaited<ReturnType<typeof getMaterialIssueForPrint>>>(null);
  const [hppMarginPercent, setHppMarginPercent] = useState('');
  const [hppAdditionalCost, setHppAdditionalCost] = useState('');
  const [rollAllocationStatus, setRollAllocationStatus] = useState<Awaited<ReturnType<typeof getWorkOrderRollAllocationStatus>> | null>(null);
  const [additionalMaterialsOpen, setAdditionalMaterialsOpen] = useState(false);
  const [additionalQtyInput, setAdditionalQtyInput] = useState('');
  const [additionalPreview, setAdditionalPreview] = useState<Awaited<ReturnType<typeof getAdditionalMaterialsPreview>> | null>(null);
  const [additionalPreviewLoading, setAdditionalPreviewLoading] = useState(false);
  const [additionalSubmitLoading, setAdditionalSubmitLoading] = useState(false);
  // Kunci idempotensi per isian qty tambahan: simpan ulang dengan qty sama tidak mengeluarkan bahan dua kali.
  const [kunciTambahan, setKunciTambahan] = useState(() => newLocalId());
  const canPostJournal = hasPermission(session?.user?.permissions ?? [], "journals:manage");
  const bolehKelola = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE);
  const [postingReceiptId, setPostingReceiptId] = useState<string | null>(null);
  const [dialogBatal, setDialogBatal] = useState(false);
  const [dialogTerbit, setDialogTerbit] = useState(false);
  const [versiBahan, setVersiBahan] = useState(0);
  const tabMentah = searchParams.get('tab') ?? 'details';
  const tab = (TAB_WO as readonly string[]).includes(tabMentah) ? tabMentah : 'details';
  const gantiTab = (v: string) => {
    const q = new URLSearchParams(searchParams.toString());
    if (v === 'details') q.delete('tab');
    else q.set('tab', v);
    const qs = q.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  };
  const muatUlang = async () => {
    const updated = await getWorkOrderById(id);
    setWO(updated);
    setVersiBahan((v) => v + 1);
  };

  async function handlePostReceiptJournal(receiptId: string) {
    setPostingReceiptId(receiptId);
    try {
      const res = await postFgReceiptJournalAction(receiptId);
      if (res.ok) {
        toast.success(res.created ? tWO("receiptJournal.postedToast") : tWO("receiptJournal.alreadyPostedToast"));
      } else {
        switch (res.code) {
          case "UNMAPPED_ROLE": toast.error(tWO("receiptJournal.errUNMAPPED_ROLE", { role: res.role ?? "" })); break;
          case "UNBALANCED": toast.error(tWO("receiptJournal.errUNBALANCED")); break;
          case "NON_POSTABLE_ACCOUNT": toast.error(tWO("receiptJournal.errNON_POSTABLE_ACCOUNT")); break;
          case "ERROR": toast.error(tWO("receiptJournal.errUnexpected")); break;
          case "FORBIDDEN": toast.error(tWO("receiptJournal.errFORBIDDEN")); break;
          default: toast.error(tWO("receiptJournal.errBAD_STATE"));
        }
      }
      const updated = await getWorkOrderById(id);
      setWO(updated);
    } catch {
      toast.error(tWO("receiptJournal.errUnexpected"));
    } finally {
      setPostingReceiptId(null);
    }
  }

  useEffect(() => {
    if (!id) return;
    getWorkOrderById(id)
      .then((data) => {
        setWO(data);
        setHppMarginPercent(
          data?.hppMarginPercent != null ? String(data.hppMarginPercent) : ''
        );
        setHppAdditionalCost(
          data?.hppAdditionalCost != null ? String(data.hppAdditionalCost) : ''
        );
      })
      .catch(() => {
        toast.error(tToasts('failedToLoadWorkOrder'));
        router.push('/backoffice/work-orders');
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id, router drive fetch
  }, [id, router]);

  useEffect(() => {
    if (!id || !wo) return;
    const rb = (wo as { rollBreakdown?: unknown }).rollBreakdown;
    const hasBreakdown = Array.isArray(rb) && rb.length > 0;
    if (!hasBreakdown) {
      setRollAllocationStatus(null);
      return;
    }
    getWorkOrderRollAllocationStatus(id)
      .then(setRollAllocationStatus)
      .catch(() => setRollAllocationStatus(null));
  }, [id, wo]);

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
      .catch(() => toast.error(tToasts('failedToLoadIssueForPrint')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- printIssueId drives fetch
  }, [printIssueId]);
  const handlePrintNota = async () => {
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
      toast.error(tToasts('failedToLoadIssueForPrint'));
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
        toast.error(tToasts('failedToLoadIssueForPrint'));
      }
      setTimeout(removeIframe, 500);
    }, 350);
  };

  const handleSaveHpp = async () => {
    if (!wo) return;
    try {
      const updated = await updateWOHppAdjustments(String(wo.id), {
        hppMarginPercent: hppMarginPercent.trim() ? Number(hppMarginPercent) : undefined,
        hppAdditionalCost: hppAdditionalCost.trim() ? Number(hppAdditionalCost) : undefined,
      });
      setWO(updated as any);
      toast.success(tD('hppUpdated'));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tD('hppUpdateFailed'));
    }
  };

  const loadAdditionalPreview = async () => {
    const qty = parseInt(additionalQtyInput, 10);
    if (!id || !Number.isInteger(qty) || qty <= 0) {
      toast.error(tD('additionalQtyInvalid'));
      return;
    }
    setAdditionalPreviewLoading(true);
    setAdditionalPreview(null);
    try {
      const preview = await getAdditionalMaterialsPreview(id, qty);
      setAdditionalPreview(preview);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tD('previewFailed'));
    } finally {
      setAdditionalPreviewLoading(false);
    }
  };

  const handleIssueAdditionalMaterials = async () => {
    const qty = parseInt(additionalQtyInput, 10);
    if (!session?.user?.id || !id || !Number.isInteger(qty) || qty <= 0) return;
    const allSufficient = additionalPreview?.lines.every((l) => l.sufficient) ?? false;
    if (!allSufficient) {
      toast.error(tD('insufficientStock'));
      return;
    }
    setAdditionalSubmitLoading(true);
    try {
      // Penolakan datang sebagai kode (pesan lemparan disamarkan di produksi).
      const hasil = await issueAdditionalMaterials(id, qty, session.user.id, kunciTambahan);
      if (!hasil.ok) {
        toast.error(
          hasil.code === 'STOK_BAHAN_KURANG'
            ? tTolak('STOK_BAHAN_KURANG', { barang: hasil.barang ?? '' })
            : tTolak.has(hasil.code)
              ? tTolak(hasil.code)
              : tWO('issueFailed')
        );
        return;
      }
      setKunciTambahan(newLocalId());
      toast.success(tD('additionalIssued'));
      setAdditionalMaterialsOpen(false);
      setAdditionalQtyInput('');
      setAdditionalPreview(null);
      await muatUlang();
    } catch {
      toast.error(tWO('issueFailed'));
    } finally {
      setAdditionalSubmitLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Aksi mengembalikan null untuk id yang tidak ada: tampilkan keadaan "tidak ditemukan", bukan pemutar tanpa akhir.
  if (!wo) return <WoTidakDitemukan />;

  // Satu definisi angka setoran untuk rincian, layar terima, rekonsiliasi dan daftar.
  const setoran = angkaSetoranWo({
    plannedQty: wo.plannedQty,
    actualQty: wo.actualQty,
    receipts: ((wo as { receipts?: unknown }).receipts as Parameters<typeof angkaSetoranWo>[0]['receipts']) ?? [],
  });
  const consumptionPlan = (wo.consumptionPlan as any[]) || [];
  const status = wo.status as WOStatus;
  const adaPenerimaan = ((wo as any).receipts?.length ?? 0) > 0;
  const bolehBatal = (status === 'DRAFT' || status === 'ISSUED' || status === 'IN_PRODUCTION') && !adaPenerimaan;
  const berjalan = status === 'ISSUED' || status === 'IN_PRODUCTION' || status === 'PARTIAL';
  const terlambat = hariTerlambatWo((wo as any).targetDate, status);
  const isAdmin = session?.user?.role === 'ADMIN';
  const rollBreakdown: Array<{ rollRef: string; qty: number; notes?: string }> | null = Array.isArray((wo as any).rollBreakdown)
    ? (wo as any).rollBreakdown
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href="/backoffice/work-orders" aria-label={tD('backToList')} title={tD('backToList')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">
                {String(wo.docNumber ?? '')}
              </h1>
              <TombolBantuan judul={String(wo.docNumber ?? '')} />
            </div>
            <p className="text-muted-foreground">
              {String((wo as any).vendor?.name ?? '')} · {String((wo as any).finishedGood?.nameId ?? '—')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={statusColors[wo.status as WOStatus]}>
            {statusLabels[wo.status as WOStatus]}
          </Badge>
          {wo.status === 'COMPLETED' && (wo as { completedAt?: string | Date | null }).completedAt && (
            <span className="text-sm text-muted-foreground">
              {tWO('completedAt')}:{' '}
              {formatDisplayDateTime((wo as { completedAt: string | Date }).completedAt, locale)}
            </span>
          )}
          {status === 'DRAFT' && bolehKelola && (
            <>
              <Button asChild variant="outline">
                <Link href={`/backoffice/work-orders/${id}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {tD('ubah')}
                </Link>
              </Button>
              <Button onClick={() => setDialogTerbit(true)}>{tWO('issue')}</Button>
            </>
          )}
          {bolehBatal && bolehKelola && (
            <Button variant="destructive" onClick={() => setDialogBatal(true)}>
              {tWO('cancelWO')}
            </Button>
          )}
          {berjalan && (
            <>
              {status !== 'PARTIAL' && (
                <Button asChild variant="outline">
                  <Link href={`/backoffice/work-orders/${id}/issue`}>{tWO('issueMaterials')}</Link>
                </Button>
              )}
              {status === 'IN_PRODUCTION' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAdditionalMaterialsOpen(true);
                    setAdditionalQtyInput('');
                    setAdditionalPreview(null);
                  }}
                >
                  {tD('issueAdditional')}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href={`/backoffice/work-orders/${id}/receive`}>{tWO('terimaBarangJadi')}</Link>
              </Button>
            </>
          )}
          {status !== 'DRAFT' && (
            <Button asChild variant="outline">
              <Link href={`/backoffice/work-orders/${id}/reconciliation`}>
                <BarChart3 className="mr-2 h-4 w-4" />
                {tWO('reconciliation')}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {status === 'COMPLETED' ? (
        <p className="text-sm text-muted-foreground">{tD('selesaiTanpaAksi')}</p>
      ) : null}

      {Array.isArray((wo as { chainSnapshot?: unknown }).chainSnapshot) &&
        ((wo as { chainSnapshot: unknown[] }).chainSnapshot?.length ?? 0) > 0 &&
        (wo as { issuedAt?: string | Date | null }).issuedAt && (
          <ChainPositionStrip
            docType="WO"
            docId={String(wo.id)}
            snapshot={(wo as { chainSnapshot: SnapshotStep[] }).chainSnapshot}
            clockStart={new Date((wo as { issuedAt: string | Date }).issuedAt)}
            chainTotalDays={(wo as { chainTotalDays?: number | null }).chainTotalDays ?? 0}
            confirmedIndex={
              (wo as { chainConfirmedStepIndex?: number | null }).chainConfirmedStepIndex ?? null
            }
            confirmedAt={
              (wo as { chainConfirmedAt?: string | Date | null }).chainConfirmedAt
                ? new Date((wo as { chainConfirmedAt: string | Date }).chainConfirmedAt)
                : null
            }
            confirmedSource={
              (wo as { chainConfirmedSource?: string | null }).chainConfirmedSource ?? null
            }
            actualLeadDays={(wo as { actualLeadDays?: number | null }).actualLeadDays ?? null}
            status={String(wo.status)}
            canConfirm={hasPermission(
              session?.user?.permissions ?? [],
              PERMISSIONS.WORK_ORDERS_MANAGE
            )}
            onUpdated={() => {
              void getWorkOrderById(String(wo.id)).then(setWO);
            }}
          />
        )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {tD('progressTitle')}
          </CardTitle>
          <CardDescription>
            <RingkasSetoran angkaWo={setoran} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="tabular-nums">{setoran.persen}%</span>
              <span className="tabular-nums">
                {tWO('setoran.masukDariTarget', {
                  masuk: setoran.masukStok.toLocaleString('id-ID'),
                  target: setoran.target.toLocaleString('id-ID'),
                })}
              </span>
            </div>
            <Progress value={setoran.persen} className="h-2" />
          </div>
          <div className="mt-2">
            <CatatanTanpaDokumen angkaWo={setoran} />
          </div>
          {(wo as any).targetDate && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              {t('progressTarget')}: {formatDisplayDate((wo as any).targetDate, locale)}
              {terlambat != null ? (
                <Badge variant="destructive">{tWO('terlambatHari', { hari: terlambat })}</Badge>
              ) : null}
            </div>
          )}
          {(wo as any).expectedConsumption != null && Number((wo as any).expectedConsumption) > 0 && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              {tD('expectedConsumption', {
                value: (wo as any).expectedConsumption.toLocaleString('id-ID'),
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {rollBreakdown && rollBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{tWO('allocationPerRoll')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tD('colRollRef')}</TableHead>
                  <TableHead className="text-right">{tD('colAllocated')}</TableHead>
                  {rollAllocationStatus != null && (
                    <>
                      <TableHead className="text-right">{tTable('initial')}</TableHead>
                      <TableHead className="text-right">{tTable('remaining')}</TableHead>
                      <TableHead className="text-right">{tD('colUsed')}</TableHead>
                    </>
                  )}
                  <TableHead>{tWO('notes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rollBreakdown.map((r, i) => {
                  const status = rollAllocationStatus?.[i];
                  return (
                    <TableRow key={i}>
                      <TableCell>{r.rollRef ?? '-'}</TableCell>
                      <TableCell className="text-right">{Number(r.qty ?? 0).toLocaleString('id-ID')}</TableCell>
                      {rollAllocationStatus != null && (
                        <>
                          <TableCell className="text-right">
                            {status?.initialLength != null ? status.initialLength.toLocaleString('id-ID') : '–'}
                          </TableCell>
                          <TableCell className="text-right">
                            {status?.remainingLength != null ? status.remainingLength.toLocaleString('id-ID') : '–'}
                          </TableCell>
                          <TableCell className="text-right">
                            {status?.used != null ? status.used.toLocaleString('id-ID') : '–'}
                          </TableCell>
                        </>
                      )}
                      <TableCell>{r.notes ?? '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                const win = window.open('', '_blank', 'width=800,height=600');
                if (!win) return;
                // Semua nilai di-escape di pembangunnya — catatan rol diketik bebas.
                win.document.write(
                  buildNotaKainHtml({
                    docNumber: String(wo.docNumber ?? ""),
                    vendorName: (wo.vendor as { name?: string | null } | null)?.name,
                    fgName: (wo.finishedGood as { nameId?: string | null } | null)?.nameId,
                    labelKonsumsi: tWO("kebutuhanTotalRencana"),
                    rolls: rollBreakdown,
                    materials: consumptionPlan,
                  }),
                );
                win.document.close();
                win.focus();
                setTimeout(() => { win.print(); win.close(); }, 250);
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              {tD('printNotaKain')}
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab === 'hpp' && !isAdmin ? 'details' : tab} onValueChange={gantiTab}>
        <TabsList className={isAdmin ? 'grid w-full grid-cols-4' : 'grid w-full grid-cols-3'}>
          <TabsTrigger value="details">{tWO('details')}</TabsTrigger>
          <TabsTrigger value="issues">{tWO('materialIssues')}</TabsTrigger>
          <TabsTrigger value="receipts">{tWO('penerimaanBarangJadi')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="hpp">{tD('hppTitle')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="details" className="space-y-4">
          <KartuBahanWo
            woId={id}
            bolehKelola={bolehKelola}
            bolehKembali={status !== 'CANCELLED' && status !== 'DRAFT'}
            alasanTidakBoleh={status === 'CANCELLED' ? tD('bahanWoBatal') : tD('bahanWoDraf')}
            versi={versiBahan}
            onBerubah={() => {
              void getWorkOrderById(id).then(setWO);
            }}
          />
          {Array.isArray((wo as any).steps) && (wo as any).steps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{tD('productionSteps')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tD('colStep')}</TableHead>
                      <TableHead>{tTable('supplier')}</TableHead>
                      <TableHead className="text-right">{tD('colServicePrice')}</TableHead>
                      <TableHead className="text-right">{tWO('qty')}</TableHead>
                      <TableHead className="text-right">{tD('colTotal')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(wo as any).steps.map((step: any) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.stepName || tD('stepN', { n: step.sequence })}</TableCell>
                        <TableCell>{step.supplier?.name || step.supplier?.code || '-'}</TableCell>
                        <TableCell className="text-right">
                          {formatRupiah(Number(step.servicePrice || 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          {step.qty != null ? Number(step.qty).toLocaleString('id-ID') : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {step.totalCost != null ? formatRupiah(Number(step.totalCost)) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="issues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                {tWO('materialIssues')}
              </CardTitle>
              <CardDescription>
                {tD('issuesCount', { count: (wo as any).issues?.length ?? 0 })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!(wo as any).issues?.length ? (
                <p className="text-muted-foreground">{tWO('noIssuesYet')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tD('colDoc')}</TableHead>
                      <TableHead>{tWO('type')}</TableHead>
                      <TableHead>{tWO('date')}</TableHead>
                      <TableHead className="text-right">{tWO('totalCost')}</TableHead>
                      <TableHead className="w-[100px]">{tD('colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((wo as any).issues as any[]).map((iss: any) => (
                      <TableRow key={iss.id}>
                        <TableCell className="font-medium">
                          {iss.docNumber}
                        </TableCell>
                        <TableCell>{issueTypeLabel(iss.issueType)}</TableCell>
                        <TableCell>
                          {formatDisplayDate(iss.issuedAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatRupiah(Number(iss.totalCost))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openPrintNota(iss.id)}
                            aria-label={tNota('printNota', { docNumber: iss.docNumber })}
                            title={tNota('printNota', { docNumber: iss.docNumber })}
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
                {tWO('penerimaanBarangJadi')}
              </CardTitle>
              <CardDescription>
                {tD('receiptsCount', { count: (wo as any).receipts?.length ?? 0 })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!(wo as any).receipts?.length ? (
                <p className="text-muted-foreground">{tWO('noReceiptsYet')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tD('colDoc')}</TableHead>
                      <TableHead>{tWO('date')}</TableHead>
                      <TableHead className="text-right">{tWO('received')}</TableHead>
                      <TableHead className="text-right">{tWO('rejected')}</TableHead>
                      <TableHead className="text-right">{tD('colAccepted')}</TableHead>
                      <TableHead className="text-right">{tD('colNilaiHpp')}</TableHead>
                      <TableHead>{tWO("receiptJournal.column")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {((wo as any).receipts as any[]).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          {r.docNumber}
                        </TableCell>
                        <TableCell>
                          {formatDisplayDate(r.receivedAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyReceived).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyRejected ?? 0).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(r.qtyAccepted).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right whitespace-normal">
                          <div className="tabular-nums">
                            {r.totalCostValue != null ? formatRupiah(Number(r.totalCostValue)) : '-'}
                          </div>
                          {r.serviceCost != null || r.additionalCost != null ? (
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {tD('rincianNilaiHpp', {
                                bahan: formatRupiah(Number(r.materialCost ?? 0)),
                                jasa: formatRupiah(Number(r.serviceCost ?? 0)),
                              })}
                              {Number(r.additionalCost ?? 0) > 0
                                ? ` · ${tD('rincianNilaiTambahan', { value: formatRupiah(Number(r.additionalCost)) })}`
                                : ''}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {r.journalId ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="default">{tWO("receiptJournal.posted")}</Badge>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/backoffice/finance/journals/${r.journalId}`}>{tWO("receiptJournal.viewJournal")}</Link>
                              </Button>
                            </div>
                          ) : r.hasPostableJournal && canPostJournal ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={postingReceiptId === r.id}
                              onClick={() => handlePostReceiptJournal(r.id)}
                            >
                              {tWO("receiptJournal.postJournal")}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {isAdmin && (
          <TabsContent value="hpp" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{tD('hppTitle')}</CardTitle>
                <CardDescription>
                  {tD('hppSekarang', {
                    margin:
                      (wo as any).hppMarginPercent != null
                        ? `${Number((wo as any).hppMarginPercent).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
                        : '—',
                    biaya:
                      (wo as any).hppAdditionalCost != null ? formatRupiah(Number((wo as any).hppAdditionalCost)) : '—',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="hpp-margin">{tD('marginLabel')}</Label>
                  <Input
                    id="hpp-margin"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={hppMarginPercent}
                    onChange={(e) => setHppMarginPercent(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hpp-biaya">{tD('additionalCostLabel')}</Label>
                  <Input
                    id="hpp-biaya"
                    type="number"
                    min={0}
                    step="0.01"
                    value={hppAdditionalCost}
                    onChange={(e) => setHppAdditionalCost(e.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleSaveHpp}>{tD('saveHpp')}</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!printIssueId} onOpenChange={(open) => !open && closePrintNota()}>
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
                      <TableCell className="text-right">{Number(line.qty ?? 0).toLocaleString('id-ID')}</TableCell>
                      <TableCell>{line.uomCode}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="font-semibold">
                {tWO('totalCost')}: {formatRupiah(Number(printData.totalCost ?? 0))}
              </p>
              <div className="flex gap-2 no-print">
                <Button variant="outline" onClick={closePrintNota}>{tWO('close')}</Button>
                <Button onClick={handlePrintNota}><Printer className="mr-2 h-4 w-4" />{tWO('print')}</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{tCommon('loading')}</p>
          )}
        </DialogContent>
      </Dialog>

      <DialogBatalWo
        open={dialogBatal}
        onOpenChange={setDialogBatal}
        woId={id}
        docNumber={String(wo.docNumber ?? '')}
        diRincian
        onSelesai={() => void muatUlang()}
      />
      <DialogTerbitWo
        open={dialogTerbit}
        onOpenChange={setDialogTerbit}
        woId={id}
        docNumber={String(wo.docNumber ?? '')}
        onSelesai={() => void muatUlang()}
      />

      <Dialog open={additionalMaterialsOpen} onOpenChange={(open) => !open && setAdditionalMaterialsOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tD('issueAdditional')}</DialogTitle>
            <CardDescription>{tD('additionalDesc')}</CardDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tD('additionalQtyLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  value={additionalQtyInput}
                  onChange={(e) => {
                    setAdditionalQtyInput(e.target.value);
                    // Qty lain = permintaan lain: kunci baru.
                    setKunciTambahan(newLocalId());
                  }}
                  placeholder={tD('additionalQtyPlaceholder')}
                />
                <Button
                  variant="outline"
                  onClick={loadAdditionalPreview}
                  disabled={additionalPreviewLoading || !additionalQtyInput.trim()}
                >
                  {additionalPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : tD('preview')}
                </Button>
              </div>
            </div>
            {additionalPreview && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tWO('item')}</TableHead>
                      <TableHead className="text-right">{tD('colQtyNeeded')}</TableHead>
                      <TableHead className="text-right">{tD('colOnHand')}</TableHead>
                      <TableHead>{tWO('status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {additionalPreview.lines.map((line, i) => (
                      <TableRow key={i}>
                        <TableCell>{line.itemName}</TableCell>
                        <TableCell className="text-right">{line.qtyNeeded.toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right">{line.qtyOnHand.toLocaleString('id-ID')}</TableCell>
                        <TableCell>
                          <span className={line.sufficient ? 'text-green-600' : 'text-red-600'}>
                            {line.sufficient ? tD('ok') : tD('short')}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setAdditionalMaterialsOpen(false)}>
                    {tD('cancel')}
                  </Button>
                  <Button
                    onClick={handleIssueAdditionalMaterials}
                    disabled={additionalSubmitLoading || !additionalPreview.lines.every((l) => l.sufficient)}
                  >
                    {additionalSubmitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {tD('issueAccessories')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
