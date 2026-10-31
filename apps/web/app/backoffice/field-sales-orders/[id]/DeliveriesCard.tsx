"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { tautanFakturPajak, tautanPiutangFaktur } from "./tautan-penagihan";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, FileCheck2, FileText, Landmark, MoreHorizontal, PackageCheck, Pencil, Printer, Receipt, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDateOnlyJakarta, formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { STATUS_BADGE_VARIANT, STATUS_LABEL_KEY } from "@/lib/tax-invoices/status-display";
import type {
  FieldSalesDeliveryStatus,
  FieldSalesDeliverySummary,
  FieldSalesOrderStatus,
  FieldSalesOrderType,
} from "@/lib/field-sales/queries";
import {
  closeRemainderAction,
  recordNotaTagihanPrinted,
  updateDeliveryDatesAction,
} from "@/app/actions/field-sales-deliveries";
import { logPrintQuietly } from "@/lib/audit/log-print-quietly";
import { printHtmlInIframe } from "@/lib/print/print-html-in-iframe";
import { promoNameForDeliveryLine } from "@/lib/field-sales/delivery-nota-promos";
import { buildNotaGudangPrintHtml } from "@/lib/print/field-sales-nota-gudang-html";
import { buildNotaTagihanPrintHtml } from "@/lib/print/field-sales-nota-tagihan-html";
import { buildBuktiTerimaPrintHtml } from "@/lib/print/bukti-terima-html";
import {
  DialogBuktiTerimaKantor,
  LightboxBuktiTerima,
  SelBuktiTerima,
  cetakDenganGambar,
  type SasaranKantor,
} from "./BuktiTerimaKantor";
import {
  DeliveryFormDialog,
  deliveryErrorKey,
  parseDateOnlyInput,
  type DeliverableLine,
} from "./DeliveryFormDialog";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { DELIVERY_BADGE_CLASS, DELIVERY_BADGE_VARIANT } from "../delivery-status-badge";
import { TanggalInput } from "@/components/ui/tanggal-input";
import type { PiutangKiriman } from "./tautan-pesanan";

type Props = {
  orderId: string;
  orderNo: string;
  storeName: string;
  salesmanName: string;
  orderType: FieldSalesOrderType;
  status: FieldSalesOrderStatus;
  deliveryStatus: FieldSalesDeliveryStatus;
  deliveries: FieldSalesDeliverySummary[];
  lines: Array<DeliverableLine & { appliedPromoName: string | null }>;
  appliedOrderPromoName: string | null;
  paymentTempo: number;
  canDeliver: boolean;
  canShipShipment: boolean;
  /**
   * Mencatat/mengoreksi bukti terima: izin kirim ATAU setujui. Tidak diisi =
   * sama dengan `canDeliver` (penulis tetap memeriksa izinnya sendiri).
   */
  canRecordReceipt?: boolean;
  /**
   * Pre-order yang jendelanya belum dirilis: stoknya belum disiapkan, jadi
   * pengiriman belum bisa dicatat (penulis menolak dengan `INDEN_BELUM_RILIS`).
   * Menutup sisa tetap boleh — toko yang membatalkan pre-order-nya.
   */
  indenBelumRilis?: boolean;
  /** Piutang tiap nota (per `deliveryId`), sisa dihitung ulang; kosong = tidak boleh/ tidak termuat. */
  piutangKiriman?: Record<string, PiutangKiriman>;
  bolehBukaPiutang?: boolean;
  bolehBukaFakturPajak?: boolean;
};

const KUNCI_FAKTUR: Record<"PENDING" | "CREATED" | "NOT_REQUIRED", "fakturMenunggu" | "fakturDibuat" | "fakturTidakPerlu"> = {
  PENDING: "fakturMenunggu",
  CREATED: "fakturDibuat",
  NOT_REQUIRED: "fakturTidakPerlu",
};

/**
 * CardHeader places its action slot in a second grid column, which squeezes the title on a
 * phone. Below the sm breakpoint the actions drop to their own row under the title, which
 * also means cancelling the base slot's row-span and its justify-self-end pin.
 */
const ACTION_SLOT_CLASS = [
  "flex flex-wrap gap-2 justify-end",
  "max-sm:col-start-1 max-sm:row-start-2 max-sm:row-span-1",
  "max-sm:justify-self-start max-sm:justify-start",
].join(" ");

function totalQty(delivery: FieldSalesDeliverySummary): number {
  return delivery.lines.reduce((sum, line) => sum + line.qty, 0);
}

export function DeliveriesCard({
  orderId,
  orderNo,
  storeName,
  salesmanName,
  orderType,
  status,
  deliveryStatus,
  deliveries,
  lines,
  appliedOrderPromoName,
  paymentTempo,
  canDeliver,
  canShipShipment,
  canRecordReceipt = canDeliver,
  indenBelumRilis = false,
  piutangKiriman = {},
  bolehBukaPiutang = false,
  bolehBukaFakturPajak = false,
}: Props) {
  const t = useTranslations("fieldSalesOrders");
  const tCommon = useTranslations("common");
  const tFakturStatus = useTranslations("fakturPajakStatus");
  const tShipments = useTranslations("deliveryShipments");
  const tBukti = useTranslations("buktiTerima.kantor");
  const tCetak = useTranslations("buktiTerima.cetak");
  const [sasaranBukti, setSasaranBukti] = useState<SasaranKantor | null>(null);
  const [lihatBukti, setLihatBukti] = useState<FieldSalesDeliverySummary | null>(null);
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [createShipmentOpen, setCreateShipmentOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [tagihanDialogOpen, setTagihanDialogOpen] = useState(false);
  const [tagihanTargetId, setTagihanTargetId] = useState<string | null>(null);
  const [tagihanFootnote, setTagihanFootnote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editInvoiceDate, setEditInvoiceDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editReason, setEditReason] = useState("");
  /**
   * Bumped each time the edit dialog opens. A save that outlives its dialog (Esc during the
   * pending state, then Edit on another row) must not close the dialog opened after it.
   */
  const editSessionRef = useRef(0);

  /* Konsi orders render KonsiShipmentsCard instead — no accounting deliveries exist for them. */
  if (orderType === "KONSI") return null;
  if (status !== "APPROVED" && deliveries.length === 0) return null;

  const hasOutstanding = lines.some((line) => line.outstanding > 0);
  // Tanpa sisa, kedua tombol tidak punya arti — lencana Terkirim/Ditutup sudah mengatakannya.
  const showActions = canDeliver && status === "APPROVED" && hasOutstanding;
  const statusKey = `delivery.status.${deliveryStatus}`;

  /**
   * Same parsed-pair rule the create dialog applies, from the same helper. `min` on the due input
   * does not cover it: moving the INVOICE date forward past a standing due date leaves the due
   * input untouched, so without this the operator only learns about the inversion from a
   * round-trip that the server was always going to refuse.
   */
  const parsedEditInvoice = parseDateOnlyInput(editInvoiceDate);
  const parsedEditDue = parseDateOnlyInput(editDueDate);
  const editDatesInverted =
    parsedEditInvoice !== null && parsedEditDue !== null && parsedEditDue.getTime() < parsedEditInvoice.getTime();
  const editDatesValid = parsedEditInvoice !== null && parsedEditDue !== null && !editDatesInverted;

  /* Delivery lines don't carry the order line's variant label, so look it up by orderLineId. */
  function lineVariantLabel(orderLineId: string): string | null {
    return lines.find((line) => line.id === orderLineId)?.variantLabel ?? null;
  }

  function handlePrintGudang(delivery: FieldSalesDeliverySummary): void {
    logPrintQuietly("FieldSalesDeliveryNotaGudang", delivery.id);
    const html = buildNotaGudangPrintHtml({
      docNo: delivery.docNo,
      orderNo,
      storeName,
      salesmanName,
      deliveredAt: delivery.deliveredAt,
      status,
      lines: delivery.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        variantLabel: lineVariantLabel(line.orderLineId),
        qty: line.qty,
      })),
      labels: {
        title: t("print.gudangTitle"),
        doc: t("print.docLabel"),
        orderRef: t("print.orderRefLabel"),
        store: t("print.storeLabel"),
        salesman: t("print.salesmanLabel"),
        date: t("print.dateLabel"),
        status: t("print.statusLabel"),
        no: t("print.colNo"),
        product: t("print.colProduct"),
        qty: t("print.colQty"),
        preparedBy: t("print.preparedBy"),
        receivedBy: t("print.receivedBy"),
        issuedBy: t("print.issuedBy"),
      },
    });
    printHtmlInIframe(html, t("print.notaGudang"));
  }

  /**
   * Tanda terima: lembar kosong untuk ditandatangani toko selama belum ada bukti, salinan bukti
   * yang tercatat (nama, jam WIB, gambar) sesudahnya. Dicetak lewat `cetakDenganGambar`, yang
   * menunggu gambar buktinya termuat — `printHtml` di atas mencetak sebelum foto sempat tiba.
   */
  function handlePrintTandaTerima(delivery: FieldSalesDeliverySummary): void {
    logPrintQuietly("FieldSalesTandaTerima", delivery.id);
    const html = buildBuktiTerimaPrintHtml({
      docNo: delivery.docNo,
      orderNo,
      storeName,
      salesmanName,
      deliveredAt: delivery.deliveredAt,
      receivedByName: delivery.receivedByName,
      receivedAt: delivery.receivedAt,
      podPhotoUrl: delivery.podPhotoUrl,
      lines: delivery.lines.map((line) => ({
        productName: line.productName,
        variantSku: line.variantSku,
        variantLabel: lineVariantLabel(line.orderLineId),
        qty: line.qty,
      })),
      labels: {
        title: tCetak("judul"),
        doc: tCetak("nota"),
        orderRef: tCetak("pesanan"),
        store: tCetak("toko"),
        salesman: tCetak("sales"),
        deliveredAt: tCetak("tanggalKirim"),
        receivedBy: tCetak("diterimaOleh"),
        receivedAt: tCetak("waktuDiterima"),
        evidence: tCetak("bukti"),
        no: tCetak("no"),
        product: tCetak("produk"),
        qty: tCetak("qty"),
        totalQty: tCetak("totalQty"),
        statement: tCetak("pernyataan"),
        notYetReceived: tCetak("belum"),
        signature: tCetak("tandaTangan"),
        issuedBy: tCetak("diterbitkan"),
      },
    });
    cetakDenganGambar(html, tCetak("judulJendela"));
  }

  function openTagihanDialog(deliveryId: string): void {
    setTagihanTargetId(deliveryId);
    setTagihanFootnote("");
    setTagihanDialogOpen(true);
  }

  /**
   * The preview opens first and the bookkeeping (`recordNotaTagihanPrinted`: audit, stamp,
   * finance notification) runs after, so the operator never waits on its round trips for the
   * print. Routed through `startTransition` so the confirm button stays disabled on `isPending`
   * and a second click can't fire a second print iframe or a second audit row. A failed half
   * surfaces as a warning toast; it never blocks or undoes the print.
   */
  function callPrintTagihan(): void {
    const delivery = deliveries.find((d) => d.id === tagihanTargetId);
    if (!delivery) return;
    startTransition(async () => {
      const html = buildNotaTagihanPrintHtml({
        docNo: delivery.docNo,
        orderNo,
        storeName,
        salesmanName,
        invoiceDate: delivery.invoiceDate,
        dueDate: delivery.dueDate,
        footnote: tagihanFootnote,
        subtotal: delivery.subtotal,
        orderDiscountAmount: delivery.discountAmount,
        appliedOrderPromoName,
        total: delivery.total,
        lines: delivery.lines.map((line) => ({
          productName: line.productName,
          variantSku: line.variantSku,
          variantLabel: lineVariantLabel(line.orderLineId),
          qty: line.qty,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          discountAmount: line.discountAmount,
          appliedPromoName: promoNameForDeliveryLine(lines, line.orderLineId),
        })),
        labels: {
          title: t("print.tagihanTitle"),
          doc: t("print.docLabel"),
          orderRef: t("print.orderRefLabel"),
          store: t("print.storeLabel"),
          salesman: t("print.salesmanLabel"),
          date: t("print.dateLabel"),
          dueDate: t("print.dueDateLabel"),
          no: t("print.colNo"),
          product: t("print.colProduct"),
          qty: t("print.colQty"),
          price: t("print.colPrice"),
          discount: t("print.colDiscount"),
          lineTotal: t("print.colLineTotal"),
          subtotal: t("print.subtotal"),
          orderDiscount: t("print.orderDiscount"),
          grandTotal: t("print.grandTotal"),
          regards: t("print.regards"),
          receivedBy: t("print.receivedBy"),
          issuedBy: t("print.issuedBy"),
        },
      });
      printHtmlInIframe(html, t("print.notaTagihan"));
      try {
        const result = await recordNotaTagihanPrinted(delivery.id);
        if (!result.ok) {
          /* Only a failed stamp or notification can leave finance unaware of a faktur pajak. */
          const financeAffected = result.failed.includes("STAMP") || result.failed.includes("NOTIFY");
          if (result.failed.length === 0) {
            toast.warning(t("print.tagihanBookkeepingFailedGeneric"));
          } else if (!financeAffected) {
            toast.warning(t("print.tagihanAuditOnlyFailed"));
          } else {
            const parts = result.failed.map((half) => t(`print.tagihanPart.${half}`));
            toast.warning(t("print.tagihanBookkeepingFailed", { parts: parts.join(", ") }));
          }
        }
      } catch {
        toast.warning(t("print.tagihanBookkeepingFailedGeneric"));
      }
      setTagihanDialogOpen(false);
    });
  }

  function callClose(): void {
    const reason = closeReason.trim();
    if (!reason) return;
    startTransition(async () => {
      try {
        const result = await closeRemainderAction(orderId, reason);
        if (result.ok) {
          toast.success(t("delivery.successClosed"));
          setCloseOpen(false);
          setCloseReason("");
          router.refresh();
          return;
        }
        toast.error(t(deliveryErrorKey(result.reason)));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  function openEditDialog(delivery: FieldSalesDeliverySummary): void {
    setEditTargetId(delivery.id);
    setEditInvoiceDate(formatDateOnlyJakarta(delivery.invoiceDate));
    setEditDueDate(formatDateOnlyJakarta(delivery.dueDate));
    setEditReason("");
    editSessionRef.current += 1;
    setEditOpen(true);
  }

  function callUpdateDates(): void {
    const reason = editReason.trim();
    if (!editTargetId || !reason || !editDatesValid) return;
    const session = editSessionRef.current;
    startTransition(async () => {
      try {
        const result = await updateDeliveryDatesAction({
          deliveryId: editTargetId,
          invoiceDate: editInvoiceDate,
          dueDate: editDueDate,
          reason,
        });
        if (result.ok) {
          toast.success(t("delivery.successDatesUpdated"));
          if (session === editSessionRef.current) setEditOpen(false);
          router.refresh();
          return;
        }
        toast.error(t(deliveryErrorKey(result.reason)));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Truck className="h-5 w-5" />
          {t("delivery.title")}
          <Badge
            variant={DELIVERY_BADGE_VARIANT[deliveryStatus]}
            className={DELIVERY_BADGE_CLASS[deliveryStatus]}
          >
            {t(statusKey)}
          </Badge>
        </CardTitle>
        {showActions && (
          <CardAction className={ACTION_SLOT_CLASS}>
            <Button
              className="h-10"
              disabled={isPending || indenBelumRilis}
              title={indenBelumRilis ? t("delivery.err.INDEN_BELUM_RILIS") : undefined}
              onClick={() => setFormOpen(true)}
            >
              <Truck className="h-4 w-4" />
              {t("delivery.create")}
            </Button>
            {canShipShipment && (
              <Button
                variant="outline"
                className="h-10"
                disabled={isPending || !hasOutstanding}
                onClick={() => setCreateShipmentOpen(true)}
              >
                <Truck className="h-4 w-4" />
                {tShipments("createShipment")}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-10"
              disabled={isPending}
              onClick={() => setCloseOpen(true)}
            >
              {t("delivery.close")}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent>
        {deliveries.length === 0 ? (
          <div className="py-10 text-center">
            <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("delivery.empty")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("delivery.docNo")}</TableHead>
                <TableHead>{t("delivery.date")}</TableHead>
                <TableHead className="text-right">{t("delivery.qty")}</TableHead>
                <TableHead className="text-right">{t("delivery.value")}</TableHead>
                <TableHead>{t("delivery.deliveredBy")}</TableHead>
                <TableHead>{t("delivery.invoiceDueDates")}</TableHead>
                <TableHead>{t("delivery.taxInvoiceStatus")}</TableHead>
                <TableHead>{tBukti("kolom")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="min-w-[10rem] whitespace-normal">
                    <div className="font-mono whitespace-nowrap">{delivery.docNo}</div>
                    <PenagihanKiriman
                      delivery={delivery}
                      piutang={piutangKiriman[delivery.id] ?? null}
                      bolehBukaPiutang={bolehBukaPiutang}
                      bolehBukaFakturPajak={bolehBukaFakturPajak}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDisplayDateTime(delivery.deliveredAt, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{totalQty(delivery)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                    {formatIDR(delivery.total)}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{delivery.deliveredByName}</TableCell>
                  <TableCell className="max-w-56 truncate whitespace-nowrap">
                    {formatDisplayDate(delivery.invoiceDate, locale)} → {formatDisplayDate(delivery.dueDate, locale)}
                  </TableCell>
                  <TableCell>
                    {delivery.taxInvoiceStatus ? (
                      <Badge variant={STATUS_BADGE_VARIANT[delivery.taxInvoiceStatus]}>
                        {tFakturStatus(STATUS_LABEL_KEY[delivery.taxInvoiceStatus])}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SelBuktiTerima kiriman={delivery} onLihat={() => setLihatBukti(delivery)} />
                  </TableCell>
                  <TableCell className="w-12 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tCommon("actions")}
                          title={tCommon("actions")}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handlePrintGudang(delivery)}>
                          <Printer className="mr-2 h-4 w-4" />
                          {t("print.notaGudang")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openTagihanDialog(delivery.id)}>
                          <Receipt className="mr-2 h-4 w-4" />
                          {t("print.notaTagihan")}
                        </DropdownMenuItem>
                        {bolehBukaPiutang && piutangKiriman[delivery.id] && (
                          <DropdownMenuItem asChild>
                            <Link href={tautanPiutangFaktur(piutangKiriman[delivery.id].invoiceNo)}>
                              <Landmark className="mr-2 h-4 w-4" />
                              {t("delivery.penagihan.lihatPiutang")}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {bolehBukaFakturPajak && tautanFakturPajak(delivery.taxInvoice, delivery.docNo) && (
                          <DropdownMenuItem asChild>
                            <Link href={tautanFakturPajak(delivery.taxInvoice, delivery.docNo) ?? ""}>
                              <FileText className="mr-2 h-4 w-4" />
                              {t("delivery.penagihan.lihatFakturPajak")}
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {canDeliver && (
                          <DropdownMenuItem onClick={() => openEditDialog(delivery)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t("delivery.editDates")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handlePrintTandaTerima(delivery)}>
                          <FileCheck2 className="mr-2 h-4 w-4" />
                          {tBukti("cetak")}
                        </DropdownMenuItem>
                        {delivery.podPhotoUrl && (
                          <DropdownMenuItem onClick={() => setLihatBukti(delivery)}>
                            <Eye className="mr-2 h-4 w-4" />
                            {tBukti("lihat")}
                          </DropdownMenuItem>
                        )}
                        {canRecordReceipt && (
                          <DropdownMenuItem
                            onClick={() =>
                              setSasaranBukti({ kiriman: delivery, mode: delivery.receivedAt ? "KOREKSI" : "CATAT" })
                            }
                          >
                            <PackageCheck className="mr-2 h-4 w-4" />
                            {delivery.receivedAt ? tBukti("koreksi") : tBukti("catat")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <DialogBuktiTerimaKantor sasaran={sasaranBukti} onTutup={() => setSasaranBukti(null)} />
      <LightboxBuktiTerima kiriman={lihatBukti} onTutup={() => setLihatBukti(null)} />

      <DeliveryFormDialog
        orderId={orderId}
        lines={lines}
        paymentTempo={paymentTempo}
        open={formOpen}
        onOpenChange={setFormOpen}
      />

      <CreateShipmentDialog
        orderId={orderId}
        lines={lines}
        open={createShipmentOpen}
        onOpenChange={setCreateShipmentOpen}
      />

      <AlertDialog
        open={closeOpen}
        onOpenChange={(open) => {
          setCloseOpen(open);
          if (!open) setCloseReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delivery.closeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delivery.closeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="close-remainder-reason" className="text-xs text-muted-foreground">
              {t("delivery.closeReason")}
            </Label>
            <Textarea
              id="close-remainder-reason"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              disabled={isPending}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10" disabled={isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10"
              disabled={isPending || !closeReason.trim()}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; it closes on success. */
                e.preventDefault();
                callClose();
              }}
            >
              {isPending ? t("delivery.submitting") : t("delivery.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={tagihanDialogOpen} onOpenChange={setTagihanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("print.tagihanDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2">
            <Label>{t("print.tagihanDialogFootnote")}</Label>
            <Textarea
              value={tagihanFootnote}
              onChange={(e) => setTagihanFootnote(e.target.value)}
              placeholder={t("print.tagihanDialogFootnotePlaceholder")}
              disabled={isPending}
              rows={3}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isPending}>
                {t("print.tagihanDialogCancel")}
              </Button>
            </DialogClose>
            <Button disabled={isPending} onClick={callPrintTagihan}>
              <Printer className="h-4 w-4 mr-2" />
              {isPending ? t("delivery.submitting") : t("print.tagihanDialogPrint")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("delivery.editDatesTitle")}</DialogTitle>
            <DialogDescription>{t("delivery.editDatesDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-invoice-date" className="text-xs text-muted-foreground">
                {t("delivery.invoiceDate")}
              </Label>
              <TanggalInput
                id="edit-invoice-date"
                className="h-10"
                value={editInvoiceDate}
                disabled={isPending}
                onChange={(e) => setEditInvoiceDate(e.target.value)}
              />
              {editInvoiceDate === "" && (
                <p className="text-xs text-muted-foreground">{t("delivery.invoiceDateRequired")}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-due-date" className="text-xs text-muted-foreground">
                {t("delivery.dueDate")}
              </Label>
              <TanggalInput
                id="edit-due-date"
                className="h-10"
                value={editDueDate}
                min={editInvoiceDate || undefined}
                disabled={isPending}
                onChange={(e) => setEditDueDate(e.target.value)}
              />
              {editDueDate === "" && (
                <p className="text-xs text-muted-foreground">{t("delivery.dueDateRequired")}</p>
              )}
              {editDatesInverted && (
                <p className="text-xs text-destructive">{t("delivery.dueDateBeforeInvoice")}</p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-dates-reason" className="text-xs text-muted-foreground">
              {t("delivery.editReason")}
            </Label>
            <Textarea
              id="edit-dates-reason"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              disabled={isPending}
              rows={3}
              maxLength={191}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="h-10" disabled={isPending}>
                {tCommon("cancel")}
              </Button>
            </DialogClose>
            <Button
              className="h-10"
              disabled={isPending || !editReason.trim() || !editDatesValid}
              onClick={callUpdateDates}
            >
              {isPending ? t("delivery.submitting") : tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Langkah sesudah nota: piutang (sisa sesungguhnya) dan faktur pajak nota ini, di bawah nomornya.
 * Tautan hanya untuk yang boleh membuka halaman tujuannya.
 */
function PenagihanKiriman({
  delivery,
  piutang,
  bolehBukaPiutang,
  bolehBukaFakturPajak,
}: {
  delivery: FieldSalesDeliverySummary;
  piutang: PiutangKiriman | null;
  bolehBukaPiutang: boolean;
  bolehBukaFakturPajak: boolean;
}) {
  const t = useTranslations("fieldSalesOrders.delivery.penagihan");
  const faktur = delivery.taxInvoice;
  if (!piutang && !faktur) return null;
  const teksPiutang = piutang ? (piutang.sisa > 0 ? t("piutangSisa", { nilai: formatIDR(piutang.sisa) }) : t("piutangLunas")) : null;
  const teksFaktur = !faktur
    ? null
    : faktur.status === "CREATED"
      ? t("fakturDibuat", { nomor: faktur.invoiceNo ?? "—" })
      : t(KUNCI_FAKTUR[faktur.status]);
  return (
    <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
      {teksPiutang &&
        (bolehBukaPiutang && piutang ? (
          <Link href={tautanPiutangFaktur(piutang.invoiceNo)} className="underline underline-offset-2 hover:text-foreground">
            {teksPiutang}
          </Link>
        ) : (
          <span>{teksPiutang}</span>
        ))}
      {teksFaktur &&
        (bolehBukaFakturPajak && tautanFakturPajak(faktur, delivery.docNo) ? (
          <Link
            href={tautanFakturPajak(faktur, delivery.docNo) ?? ""}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {teksFaktur}
          </Link>
        ) : (
          <span>{teksFaktur}</span>
        ))}
    </div>
  );
}
