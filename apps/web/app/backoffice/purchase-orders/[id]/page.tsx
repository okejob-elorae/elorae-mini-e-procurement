'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getPOById,
  changePOStatus,
  batalkanPO,
  updatePO,
  setPOPaidAt,
  postSupplierPaymentReversalJournalAction,
} from '@/app/actions/purchase-orders';
import { supplierPaymentJournalErrorKey } from '@/lib/purchasing/supplier-payment-journal-message';
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
import { Loader2, ArrowLeft, Edit, CheckCircle, XCircle, Printer, AlertTriangle, PackageCheck } from 'lucide-react';
import { buildPOPrintHtml, labelStatusCetakPo } from '@/lib/print/po-html';
import { barisCetakPo } from '@/lib/purchase-orders/cetak-po';
import type { SuratPo } from '@/lib/purchase-orders/surat-po';
import { logPrint } from '@/app/actions/audit';
import { toast } from 'sonner';
import Link from 'next/link';
import { POStatus } from '@/lib/constants/enums';
import { PinAuthModal } from '@/components/security/PinAuthModal';
import { ChainPositionStrip } from '@/components/lead-time/chain-position-strip';
import { PERMISSIONS, hasPermission } from '@/lib/rbac';
import type { SnapshotStep } from '@/lib/leadtime/calculations';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/date-only';
import { getStatusMeta } from '@/lib/ui/status-map';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { TutupPoDialog } from './TutupPoDialog';
import { DialogCetakPo } from './DialogCetakPo';
import { RingkasanUtangPo } from './RingkasanUtangPo';
import { pesanTolakBatalPo, type TolakBatalPo } from '../pesan-batal-po';
import { pesanTolakEditPo, type TolakEditPo } from '../pesan-edit-po';
import { BatalPoDialog } from '../BatalPoDialog';
import { bolehTerimaBarang, keadaanBatalPo, tampilStatusBayar } from '../aturan-po';
import { TAUTAN_DOKUMEN } from '../tautan-dokumen';
import { catatanRiwayatPo } from './catatan-riwayat';
import { KonfirmasiBayarDialog } from '../../supplier-payments/KonfirmasiBayarDialog';
import { pisahUtangPo } from '../../supplier-payments/nilai-utang';
import { labelTahap, tautanRuangKerjaTahap, type TahapPo } from '@/lib/purchase-orders/tahap';

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
  const [isTogglingPaid, setIsTogglingPaid] = useState(false);
  const [isPostingReversal, setIsPostingReversal] = useState(false);
  const [konfirmasiBayar, setKonfirmasiBayar] = useState<'bayar' | 'batal' | null>(null);
  const [cetakOpen, setCetakOpen] = useState(false);
  const tSupplierPayments = useTranslations('supplierPayments');
  const tPO = useTranslations('purchaseOrders');
  const tSecurity = useTranslations('security');
  const tToasts = useTranslations('toasts');
  const tStatus = useTranslations('statuses');
  const tInv = useTranslations('inventory.page');
  const locale = useLocale();
  const statusLabel = (status: string) =>
    tStatus(getStatusMeta('purchaseOrder', status).labelKey as never);

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
   * state, so reaching it means the page was stale — the toast has to name the
   * standing journal and send the operator to the warning's own control.
   *
   * `changed: false` is checked next and never reported as success: the PO was
   * already in the requested state, so nothing was written and no journal was
   * attempted. Green-toasting that is the same lie as green-toasting a failed
   * post — worse from a stale tab, where a re-mark whose first attempt left a
   * ledger gap would read as a fresh clean payment. The neutral toast names the
   * state the PO is actually in and points at the only remedy that reopens a
   * journal attempt.
   */
  const handlePaidToggle = async (next: Date | null) => {
    if (!po) return;
    setIsTogglingPaid(true);
    try {
      const result = await setPOPaidAt(po.id, next);
      if (result.refusal === 'TANGGAL_TIDAK_SAH') {
        toast.error(tSupplierPayments('konfirmasi.tanggalSalah'));
      } else if (result.refusal) {
        toast.warning(tSupplierPayments('standingPayment.markRefused'), { duration: 12000 });
      } else if (!result.changed) {
        toast.info(
          tSupplierPayments(next != null ? 'noop.alreadyPaid' : 'noop.alreadyUnpaid'),
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
          next != null ? tSupplierPayments('markedPaid') : tSupplierPayments('markedUnpaid')
        );
      }
      const updated = await getPOById(po.id);
      setPO(updated);
    } catch {
      toast.error(tSupplierPayments('actionFailed'));
    } finally {
      setIsTogglingPaid(false);
      setKonfirmasiBayar(null);
    }
  };

  /**
   * Posts the reversal a failed unmark left missing. The banner this hangs off
   * is the only place the state is visible, and the toggle cannot reach it — see
   * `postSupplierPaymentReversalJournalAction` for why this control is a
   * deliberate exception to the "the toggle IS the retry" rule.
   *
   * Every non-ok outcome is named rather than collapsed into one "failed": a
   * refused permission, a state that no longer holds (someone else posted the
   * reversal, or re-marked the PO, between the page load and the click) and a
   * journal that could not post are three different next steps.
   */
  const handlePostMissingReversal = async () => {
    if (!po) return;
    setIsPostingReversal(true);
    try {
      const result = await postSupplierPaymentReversalJournalAction(po.id);
      if (result.ok) {
        toast.success(tSupplierPayments('standingPayment.posted'));
      } else if (result.code === 'FORBIDDEN') {
        toast.error(tSupplierPayments('standingPayment.errForbidden'));
      } else if (result.code === 'BAD_STATE') {
        toast.info(tSupplierPayments('standingPayment.errBadState'), { duration: 10000 });
      } else {
        toast.warning(tSupplierPayments('standingPayment.errFailed', { code: result.code }), {
          duration: 12000,
        });
      }
      const updated = await getPOById(po.id);
      setPO(updated);
    } catch {
      toast.error(tSupplierPayments('actionFailed'));
    } finally {
      setIsPostingReversal(false);
    }
  };

  useEffect(() => {
    if (params.id && typeof params.id === 'string') {
      getPOById(params.id)
        .then((data) => {
          setPO(data);
          // Load suppliers for edit mode
          import('@/app/actions/suppliers')
            .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true, approvedOnly: true }))
            .then((rows: unknown) => {
              const list = (Array.isArray(rows) ? rows : []).map((s: { id: string; code: string; name: string }) => ({
                id: s.id,
                code: s.code,
                name: s.name,
              }));
              // Pemasok PO ini sendiri tetap bisa dipilih walau belum/tidak lagi disetujui.
              const sendiri = data?.supplier as { id?: string; code?: string; name?: string } | undefined;
              if (sendiri?.id && !list.some((s) => s.id === sendiri.id)) {
                list.unshift({ id: sendiri.id, code: sendiri.code ?? '', name: sendiri.name ?? '' });
              }
              setSuppliers(list);
            })
            .catch(() => {});
        })
        .catch(() => {
          toast.error(tPO('loadPOFailed'));
          router.push('/backoffice/purchase-orders');
        })
        .finally(() => setIsLoading(false));
    }
  }, [params.id, router, tPO]);

  /** Alasan sudah diisi di dialog batal; lanjut ke PIN. */
  const lanjutBatal = (alasan: string) => {
    setCancelReason(alasan);
    setPendingAction('cancel');
    setPinModalOpen(true);
  };

  const handleStatusChange = async (newStatus: 'SUBMITTED' | 'CLOSED', notes?: string) => {
    if (!session?.user?.id || !po) return;

    setIsSaving(true);
    try {
      await changePOStatus(po.id, newStatus, session.user.id, notes);
      toast.success(newStatus === 'SUBMITTED' ? tPO('toastSubmitted') : tPO('toastClosed'));
      router.refresh();
      const updated = await getPOById(po.id);
      setPO(updated);
      setCancelDialogOpen(false);
    } catch {
      // Pesan lemparan disamarkan di build produksi: selalu teks terjemahan.
      toast.error(tPO('updateStatusFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  /** Teks penolakan `batalkanPO`: kunci `security.*` untuk PIN, `purchaseOrders.batal.err.*` selainnya. */
  const teksTolakBatal = (hasil: TolakBatalPo) => {
    const pesan = pesanTolakBatalPo(hasil);
    const teks =
      pesan.ruang === 'security'
        ? tSecurity.has(pesan.kunci) ? tSecurity(pesan.kunci) : tSecurity('pinInvalid')
        : tPO.has(pesan.kunci) ? tPO(pesan.kunci) : tToasts('failedToCancelPO');
    return { teks, ulangiPin: pesan.ulangiPin };
  };

  /*
   * Batal PO lewat `batalkanPO`, yang MENGEMBALIKAN `{ ok:false, code }`: dulu
   * lewat `changePOStatus('CANCELLED')` yang melempar, dan di build produksi
   * Next menyamarkan pesan lemparan — "sudah ada barang diterima" jadi galat umum.
   * PIN salah/kosong dilempar ke jendela PIN supaya bisa diketik ulang di sana.
   */
  const batalkanDenganPin = async (pin: string) => {
    if (!po) return;
    setIsSaving(true);
    let hasil: Awaited<ReturnType<typeof batalkanPO>>;
    try {
      hasil = await batalkanPO(po.id, cancelReason, pin);
    } catch {
      // Galat jaringan/server: tampil di jendela PIN, bukan "PIN tidak valid".
      setIsSaving(false);
      throw new Error(tToasts('failedToCancelPO'));
    }
    if (!hasil.ok) {
      const { teks, ulangiPin } = teksTolakBatal(hasil);
      if (ulangiPin) {
        setIsSaving(false);
        throw new Error(teks);
      }
      toast.error(teks);
    } else {
      toast.success(tPO('toastCancelled'));
      setCancelReason('');
    }
    setCancelDialogOpen(false);
    setPinModalOpen(false);
    setPendingAction(null);
    router.refresh();
    try {
      setPO(await getPOById(po.id));
    } catch {
      // muat ulang gagal: data lama tetap tampil, router.refresh sudah jalan
    } finally {
      setIsSaving(false);
    }
  };

  /** Teks penolakan `updatePO`: kunci `security.*` untuk PIN, `purchaseOrders.edit.err.*` selainnya. */
  const teksTolakEdit = (hasil: TolakEditPo) => {
    const pesan = pesanTolakEditPo(hasil, locale);
    const teks =
      pesan.ruang === 'security'
        ? tSecurity.has(pesan.kunci) ? tSecurity(pesan.kunci) : tSecurity('pinInvalid')
        : tPO.has(pesan.kunci) ? tPO(pesan.kunci, pesan.nilai) : tPO('updateFailed');
    return { teks, ulangiPin: pesan.ulangiPin };
  };

  /** Sesudah penolakan karena PO berubah di tempat lain: tampilkan keadaan terbarunya. */
  const muatUlangSesudahTolakEdit = async (hasil: TolakEditPo) => {
    if (!po) return;
    if (hasil.code === 'TIDAK_DITEMUKAN') {
      router.push('/backoffice/purchase-orders');
      return;
    }
    if (hasil.code !== 'PO_TERTUTUP' && hasil.code !== 'PIN_WAJIB') return;
    if (hasil.code === 'PO_TERTUTUP') setIsEditMode(false);
    try {
      setPO(await getPOById(po.id));
    } catch {
      // muat ulang gagal: data lama tetap tampil
    }
  };

  /** Edit setelah ketik PIN. Penolakan datang sebagai kode (pesan lemparan disamarkan di produksi). */
  const simpanEditDenganPin = async (pin: string) => {
    if (!session?.user?.id || !po || !pendingUpdateData) return;
    setIsSaving(true);
    let hasil: Awaited<ReturnType<typeof updatePO>>;
    try {
      hasil = await updatePO(po.id, pendingUpdateData, session.user.id, pin);
    } catch {
      // Galat jaringan/server: tampil di jendela PIN, bukan "PIN tidak valid".
      setIsSaving(false);
      throw new Error(tPO('updateFailed'));
    }
    if (!hasil.ok) {
      const { teks, ulangiPin } = teksTolakEdit(hasil);
      setIsSaving(false);
      // PIN salah/kosong: jendela PIN tetap terbuka dan menampilkan pesannya.
      if (ulangiPin) throw new Error(teks);
      // Selain itu jendela PIN tertutup; isian edit tetap di formulir.
      toast.error(teks);
      await muatUlangSesudahTolakEdit(hasil);
      return;
    }
    toast.success(tPO('toastUpdated'));
    setIsEditMode(false);
    setPendingUpdateData(null);
    setPinModalOpen(false);
    setPendingAction(null);
    router.refresh();
    try {
      setPO(await getPOById(po.id));
    } catch {
      // muat ulang gagal: data lama tetap tampil, router.refresh sudah jalan
    } finally {
      setIsSaving(false);
    }
  };

  const handlePinConfirm = async (pin: string) => {
    if (!session?.user?.id || !po) return;
    if (pendingAction === 'cancel') return batalkanDenganPin(pin);
    if (pendingAction === 'update') return simpanEditDenganPin(pin);
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
      const hasil = await updatePO(po.id, data, session.user.id);
      if (!hasil.ok) {
        toast.error(teksTolakEdit(hasil).teks);
        if (hasil.code === 'PIN_WAJIB') {
          // PO terkirim ke pemasok di tengah edit: lanjutkan lewat PIN dengan isian yang sama.
          setPendingUpdateData(data);
          setPendingAction('update');
          setPinModalOpen(true);
        }
        await muatUlangSesudahTolakEdit(hasil);
        return;
      }
      toast.success(tPO('toastUpdated'));
      setIsEditMode(false);
      router.refresh();
      const updated = await getPOById(po.id);
      setPO(updated);
    } catch {
      toast.error(tPO('updateFailed'));
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

  const canPostJournal = hasPermission(
    session?.user?.permissions ?? [],
    PERMISSIONS.JOURNALS_MANAGE
  );
  const canEdit = po.status === 'DRAFT';
  const canEditPosted =
    po.status === 'SUBMITTED' ||
    po.status === 'PARTIAL' ||
    po.status === 'OVER';
  const canOpenEditForm = canEdit || canEditPosted;
  const canSubmit = po.status === 'DRAFT';
  // "Tutup PO": hanya PO yang sudah menerima sebagian (PARTIAL) — yang belum
  // menerima apa pun dibatalkan, bukan ditutup.
  const canClose =
    po.status === 'PARTIAL' &&
    hasPermission(session?.user?.permissions ?? [], PERMISSIONS.PURCHASE_ORDERS_APPROVE);
  const reloadPO = async () => {
    router.refresh();
    setPO(await getPOById(po.id));
  };
  // Batal: mati dengan alasan bila sudah ada penerimaan (server menolak SUDAH_ADA_PENERIMAAN).
  const batal = keadaanBatalPo(po);
  const canReceive =
    bolehTerimaBarang(po.status) &&
    hasPermission(session?.user?.permissions ?? [], PERMISSIONS.INVENTORY_MANAGE);
  const grns: Array<{
    id: string;
    docNumber: string;
    totalAmount: number;
    grnDate: string;
    keadaanPemilik?: 'menunggu' | 'disetujui' | 'ditolak' | null;
  }> = [...(po.grns ?? [])].sort((a: { grnDate: string }, b: { grnDate: string }) =>
    String(a.grnDate).localeCompare(String(b.grnDate)),
  );
  // Rincian GRN ada di bawah /backoffice/inventory (inventory:view); tanpa izin itu nomornya teks biasa.
  const bolehBukaGrn = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.INVENTORY_VIEW);
  // Tahap produksi PO ini; ruang kerjanya di Plan Kerja (production_planning:view), selain itu teks biasa.
  const tahap: TahapPo | null = po.tahap ?? null;
  const bolehBukaTahap = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.PRODUCTION_PLANNING_VIEW);
  /*
   * While an earlier mark's payment journal still stands on an unpaid PO,
   * marking it paid is the one click that destroys its own recovery control:
   * the post refuses `PAYMENT_SUPERSEDED` as soon as the payable has moved, and
   * the refreshed detector — which requires `paidAt == null` — then drops the
   * banner carrying the reversal button, leaving a paid PO, a stale payment
   * journal, and nothing persistent to recover from. So the mark is withheld
   * while the banner is up and recovery goes through the reversal instead.
   */
  const markPaidBlockedByStandingPayment = Boolean(po.paymentJournalStandingWhileUnpaid);

  // Surat pembuka/penutup dari dialog cetak (bawaan Pengaturan → Pajak, bisa diubah per cetak).
  const handlePrint = async (surat: SuratPo) => {
    await logPrint('PurchaseOrder', String(params.id));
    const supplier = po.supplier as {
      name: string;
      code?: string;
      address?: string | null;
    };
    // Bahan berwarna mendapat kolom Warna, bahan kg dengan kg per roll kolom Roll.
    const lines = barisCetakPo(po.items as Parameters<typeof barisCetakPo>[0]);
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
      lines,
      suratPembuka: surat.pembuka,
      suratPenutup: surat.penutup,
    });
    const iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:absolute;width:0;height:0;border:0;visibility:hidden;');
    iframe.setAttribute('title', tPO('printPO'));
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
  };

  return (
    <div className="space-y-6">
      {/* Di HP judul di atas, tombol dan lencana di baris sendiri (dulu meluber 40 px ke kanan). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/backoffice/purchase-orders">
            <Button variant="ghost" size="icon" aria-label={tPO('backToList')} title={tPO('backToList')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold tracking-tight">{po.docNumber}</h1>
              <TombolBantuan judul={po.docNumber} />
            </div>
            <p className="text-muted-foreground">{po.supplier.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {canReceive && (
            <Button size="sm" asChild>
              <Link href={`/backoffice/inventory/grn/new?poId=${encodeURIComponent(po.id)}`}>
                <PackageCheck className="mr-2 h-4 w-4" />
                {tPO('terimaBarang')}
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setCetakOpen(true)}>
            <Printer className="mr-2 h-4 w-4" />
            {tPO('printPO')}
          </Button>
          <Badge className={statusColors[po.status as POStatus]}>
            {statusLabel(po.status)}
          </Badge>
          {tampilStatusBayar(po.status) &&
            (po.paidAt ? (
              <Badge variant="default" className="bg-green-600">{tSupplierPayments('paid')}</Badge>
            ) : (
              <Badge variant="secondary">{tSupplierPayments('unpaid')}</Badge>
            ))}
          {po.etaDate && (
            <ETABadge etaDate={po.etaDate} status={po.status} />
          )}
        </div>
      </div>

      {po.paymentJournalStandingWhileUnpaid && (
        <Card className="flex-row items-start gap-3 border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {tSupplierPayments('standingPayment.title')}
            </p>
            <p className="text-sm text-amber-700/90 dark:text-amber-400/90">
              {tSupplierPayments('standingPayment.body')}
            </p>
            {canPostJournal ? (
              <Button
                variant="outline"
                size="sm"
                disabled={isPostingReversal}
                onClick={handlePostMissingReversal}
              >
                {isPostingReversal && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tSupplierPayments('standingPayment.action')}
              </Button>
            ) : (
              <p className="text-xs text-amber-700/80 dark:text-amber-400/80">
                {tSupplierPayments('standingPayment.needsPermission')}
              </p>
            )}
          </div>
        </Card>
      )}

      {Array.isArray(po.chainSnapshot) && po.chainSnapshot.length > 0 && (
        <ChainPositionStrip
          docType="PO"
          docId={po.id}
          snapshot={po.chainSnapshot as SnapshotStep[]}
          clockStart={new Date(po.createdAt)}
          chainTotalDays={po.chainTotalDays ?? 0}
          confirmedIndex={po.chainConfirmedStepIndex ?? null}
          confirmedAt={po.chainConfirmedAt ? new Date(po.chainConfirmedAt) : null}
          confirmedSource={po.chainConfirmedSource ?? null}
          actualLeadDays={po.actualLeadDays ?? null}
          status={po.status}
          canConfirm={hasPermission(
            session?.user?.permissions ?? [],
            PERMISSIONS.PURCHASE_ORDERS_EDIT
          )}
          onUpdated={() => {
            void getPOById(po.id).then(setPO);
          }}
        />
      )}

      {isEditMode && canOpenEditForm ? (
        <POForm
          ppnRatePercent={po.ppnRatePercent ?? null}
          tahap={tahap}
          initialData={{
            supplierId: po.supplierId,
            etaDate: po.etaDate ? new Date(po.etaDate) : null,
            paymentDueDate: po.paymentDueDate ? new Date(po.paymentDueDate) : null,
            notes: po.notes || undefined,
            terms: po.terms || undefined,
            items: po.items.map((item: any) => ({
              itemId: item.itemId,
              variantSku: item.variantSku ?? undefined,
              item: {
                sku: item.item.sku,
                nameId: item.item.nameId,
                uom: { id: item.uomId, code: item.item.uom.code },
                variants: item.item.variants,
              },
              qty: Number(item.qty),
              price: Number(item.price),
              ppnIncluded: item.ppnIncluded ?? true,
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
              <CardTitle>{tPO('detailsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('supplierLabel')}</p>
                  <p className="font-medium">{po.supplier.name} ({po.supplier.code})</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('etaDateLabel')}</p>
                  <p className="font-medium">
                    {po.etaDate ? formatDisplayDate(po.etaDate, locale) : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('paymentDueDateLabel')}</p>
                  <p className="font-medium">
                    {po.paymentDueDate ? formatDisplayDate(po.paymentDueDate, locale) : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('paymentStatusLabel')}</p>
                  <p className="font-medium">
                    {po.paidAt
                      ? tSupplierPayments('paidOn', { date: formatDisplayDate(po.paidAt, locale) })
                      : tSupplierPayments('unpaid')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('totalAmountLabel')}</p>
                  <p className="font-medium">Rp {Number(po.grandTotal).toLocaleString('id-ID')}</p>
                  {po.utang && po.utang.utang !== po.utang.nilaiPo && (
                    <p className="text-xs text-muted-foreground">
                      {tPO('ringkasan.utangSingkat', { nilai: `Rp ${Number(po.utang.utang).toLocaleString('id-ID')}` })}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('createdLabel')}</p>
                  <p className="font-medium">
                    {formatDisplayDate(po.createdAt, locale)}
                  </p>
                </div>
                {tahap && (
                  <div>
                    <p className="text-sm text-muted-foreground">{tPO('tahap.label')}</p>
                    {bolehBukaTahap ? (
                      <Link href={tautanRuangKerjaTahap(tahap.id)} className={TAUTAN_DOKUMEN}>
                        {labelTahap(tahap)}
                      </Link>
                    ) : (
                      <p className="font-medium">{labelTahap(tahap)}</p>
                    )}
                  </div>
                )}
              </div>
              {po.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('notesLabel')}</p>
                  <p className="font-medium">{po.notes}</p>
                </div>
              )}
              {po.terms && (
                <div>
                  <p className="text-sm text-muted-foreground">{tPO('paymentTermsLabel')}</p>
                  <p className="font-medium">{po.terms}</p>
                </div>
              )}
              <RingkasanUtangPo po={po} />
              {po.status !== 'DRAFT' && po.status !== 'CANCELLED' && (
                <div className="pt-2 space-y-2">
                  <div className="flex gap-2">
                    {po.paidAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isTogglingPaid}
                        onClick={() => setKonfirmasiBayar('batal')}
                      >
                        {isTogglingPaid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {tSupplierPayments('unmarkPaid')}
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={isTogglingPaid || markPaidBlockedByStandingPayment}
                        onClick={() => setKonfirmasiBayar('bayar')}
                      >
                        {isTogglingPaid && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {tSupplierPayments('markAsPaid')}
                      </Button>
                    )}
                  </div>
                  {markPaidBlockedByStandingPayment && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {tSupplierPayments('standingPayment.markBlocked')}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>{tPO('lineItemsTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tPO('colItem')}</TableHead>
                    <TableHead>{tPO('colVariant')}</TableHead>
                    <TableHead>{tPO('colQty')}</TableHead>
                    <TableHead>{tPO('colUom')}</TableHead>
                    <TableHead className="text-right">{tPO('colPrice')}</TableHead>
                    <TableHead className="text-right">{tPO('colTotal')}</TableHead>
                    <TableHead>{tPO('colReceived')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="min-w-[180px] whitespace-normal">
                        <div>
                          <p className="font-medium">{item.item.sku}</p>
                          <p className="text-sm text-muted-foreground">{item.item.nameId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.variantSku ?? '—'}
                      </TableCell>
                      <TableCell>{Number(item.qty).toLocaleString('id-ID')}</TableCell>
                      <TableCell>{item.item.uom.code}</TableCell>
                      <TableCell className="text-right">
                        Rp {Number(item.price).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {(Number(item.qty) * Number(item.price)).toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell>
                        {Number(item.receivedQty).toLocaleString('id-ID')} / {Number(item.qty).toLocaleString('id-ID')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Penerimaan barang (GRN) milik PO ini */}
          {po.status !== 'DRAFT' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PackageCheck className="h-5 w-5" />
                  {tPO('penerimaan.judul')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {grns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tPO('penerimaan.kosong')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tPO('penerimaan.colNomor')}</TableHead>
                        <TableHead>{tPO('penerimaan.colTanggal')}</TableHead>
                        <TableHead className="text-right">{tPO('penerimaan.colNilai')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grns.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              {bolehBukaGrn ? (
                                <Link href={`/backoffice/inventory/grn/${g.id}`} className={TAUTAN_DOKUMEN}>
                                  {g.docNumber}
                                </Link>
                              ) : (
                                <span className="font-medium">{g.docNumber}</span>
                              )}
                              {g.keadaanPemilik === 'menunggu' && (
                                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                  {tInv('awaitingOwnerApproval')}
                                </Badge>
                              )}
                              {g.keadaanPemilik === 'ditolak' && (
                                <Badge variant="outline" className="border-destructive/50 text-destructive">
                                  {tInv('declinedByOwner')}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{formatDisplayDate(g.grnDate, locale)}</TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${g.keadaanPemilik === 'ditolak' ? 'text-muted-foreground line-through' : ''}`}
                          >
                            Rp {Number(g.totalAmount).toLocaleString('id-ID')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {/* Status History */}
          <Card>
            <CardHeader>
              <CardTitle>{tPO('statusHistoryTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {po.statusHistory?.map((history: any, index: number) => {
                  const isPaymentMarked = history.paymentEvent === 'MARKED';
                  const isPaymentUnmarked = history.paymentEvent === 'UNMARKED';
                  const isPaymentEvent = isPaymentMarked || isPaymentUnmarked;
                  const badgeLabel = isPaymentMarked
                    ? tSupplierPayments('historyMarked')
                    : isPaymentUnmarked
                      ? tSupplierPayments('historyUnmarked')
                      : statusLabel(history.status);
                  const badgeClass = isPaymentMarked
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : isPaymentUnmarked
                      ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                      : statusColors[history.status as POStatus];
                  return (
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
                          <Badge className={badgeClass}>
                            {badgeLabel}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {formatDisplayDateTime(history.createdAt, locale)}
                          </span>
                        </div>
                        {history.changedBy && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {tPO('byUser', { name: history.changedBy.name || history.changedBy.email })}
                          </p>
                        )}
                        {!isPaymentEvent && (() => {
                          const catatan = catatanRiwayatPo(history.notes);
                          if (!catatan) return null;
                          const teks =
                            'teks' in catatan
                              ? catatan.teks
                              : catatan.kunci === 'statusBerubah'
                                ? tPO('riwayat.statusBerubah', { status: statusLabel(catatan.nilai.status ?? '') })
                                : tPO(`riwayat.${catatan.kunci}` as never, catatan.nilai as never);
                          return <p className="text-sm mt-1 whitespace-pre-wrap break-words">{teks}</p>;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-wrap items-start justify-end gap-2">
            {canOpenEditForm && (
              <Button onClick={() => setIsEditMode(true)}>
                <Edit className="h-4 w-4 mr-2" />
                {tPO('editPO')}
              </Button>
            )}
            {canSubmit && (
              <Button
                onClick={() => handleStatusChange('SUBMITTED')}
                disabled={isSaving}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {tPO('submitPO')}
              </Button>
            )}
            {canClose && (
              <TutupPoDialog
                poId={po.id}
                docNumber={po.docNumber}
                disabled={isSaving}
                sisa={po.items
                  .filter((item: any) => Number(item.qty) > Number(item.receivedQty))
                  .map((item: any) => ({
                    id: item.id,
                    nama: `${item.item?.sku ?? ''}${item.variantSku ? ` · ${item.variantSku}` : ''}`,
                    sisa: Number(item.qty) - Number(item.receivedQty),
                    satuan: item.item?.uom?.code ?? '',
                  }))}
                onSelesai={reloadPO}
              />
            )}
            {batal !== 'sembunyi' && (
              <div className="flex flex-col items-end gap-1">
                <Button
                  variant="destructive"
                  disabled={isSaving || batal === 'mati'}
                  onClick={() => setCancelDialogOpen(true)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {tPO('cancelPO')}
                </Button>
                {batal === 'mati' && (
                  <p className="max-w-xs text-right text-xs text-muted-foreground">{tPO('batal.matiAdaGrn')}</p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <KonfirmasiBayarDialog
        open={konfirmasiBayar !== null}
        onOpenChange={(buka) => !buka && setKonfirmasiBayar(null)}
        arah={konfirmasiBayar ?? 'bayar'}
        po={(() => {
          const pisah = pisahUtangPo({
            grandTotal: po.grandTotal,
            ppnRatePercent: po.ppnRatePercent ?? null,
            utang: po.utang,
            items: po.items ?? [],
          });
          return {
            docNumber: po.docNumber,
            supplierName: po.supplier?.name ?? '',
            grandTotal: Number(po.grandTotal ?? 0),
            utangDiterima: pisah.utangDiterima,
            komitmen: pisah.komitmen,
            adaPenerimaan: (po.items ?? []).some((l: { receivedQty: unknown }) => Number(l.receivedQty) > 0),
          };
        })()}
        sibuk={isTogglingPaid}
        onKonfirmasi={(paidAt) => {
          // "Tandai lunas" tanpa tanggal sah tidak boleh jatuh menjadi "batal lunas".
          if (konfirmasiBayar === 'bayar' && paidAt == null) return;
          void handlePaidToggle(konfirmasiBayar === 'bayar' ? paidAt : null);
        }}
      />

      <DialogCetakPo open={cetakOpen} onOpenChange={setCetakOpen} onCetak={handlePrint} />

      <BatalPoDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        docNumber={po.docNumber}
        onLanjut={lanjutBatal}
      />

      <PinAuthModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
          setPendingUpdateData(null);
        }}
        onConfirm={handlePinConfirm}
        action={pendingAction === 'cancel' ? tPO('pinActionCancelPO') : tPO('pinActionEditPosted')}
      />
    </div>
  );
}
