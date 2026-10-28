"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/sales-orders/format";
import type { getVendorPaymentDetail } from "@/lib/vendor-billing/payment-queries";
import { voidVendorPaymentAction } from "@/app/actions/vendor-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Payment = NonNullable<Awaited<ReturnType<typeof getVendorPaymentDetail>>>;

const day = (d: Date | string) => new Date(d).toLocaleDateString("id-ID");

export function VendorPaymentDetailClient({ payment, canVoid, userId }: { payment: Payment; canVoid: boolean; userId: string }) {
  const t = useTranslations("vendorPayments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submitVoid = async () => {
    setBusy(true);
    try {
      const res = await voidVendorPaymentAction(payment.id, reason, userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("voided", { docNumber: res.docNumber }));
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/backoffice/vendor-payments">
          <Button variant="ghost" size="icon" aria-label={t("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{payment.docNumber}</h1>
          <p className="text-muted-foreground">{payment.supplier.name}</p>
        </div>
        <Badge className="ml-auto" variant={payment.voidedAt ? "destructive" : "outline"}>
          {t(payment.voidedAt ? "statusVoid" : "statusPosted")}
        </Badge>
        {canVoid && (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            {t("void")}
          </Button>
        )}
      </div>

      {payment.voidedAt && (
        <Card>
          <CardContent className="pt-6 text-sm">
            {t("voidedOn", { date: day(payment.voidedAt) })}: {payment.voidReason}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <p className="text-muted-foreground">{t("paidAt")}</p>
            <p>{day(payment.paidAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("colMethod")}</p>
            <p>{t(`method.${payment.method}`)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("colReference")}</p>
            <p>{payment.reference || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("colAmount")}</p>
            <p className="font-medium">{formatIDR(payment.amount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("createdBy")}</p>
            <p>{payment.createdBy.name ?? "-"}</p>
          </div>
          {payment.notes && (
            <div className="sm:col-span-3 lg:col-span-5">
              <p className="text-muted-foreground">{t("notes")}</p>
              <p className="whitespace-pre-wrap">{payment.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("allocationsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colBill")}</TableHead>
                <TableHead>{t("colVendorInvoice")}</TableHead>
                <TableHead className="text-right">{t("colBillTotal")}</TableHead>
                <TableHead className="text-right">{t("colAllocation")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payment.allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link className="hover:underline" href={`/backoffice/vendor-bills/${a.bill.id}`}>
                      {a.bill.docNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{a.bill.vendorInvoiceNo}</TableCell>
                  <TableCell className="text-right">{formatIDR(a.bill.total)}</TableCell>
                  <TableCell className="text-right">{formatIDR(a.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("journalsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {payment.journals.length === 0 ? (
            <p className="text-muted-foreground">-</p>
          ) : (
            <ul className="space-y-1">
              {payment.journals.map((j) => (
                <li key={j.id}>
                  <Link className="hover:underline" href={`/backoffice/finance/journals/${j.id}`}>
                    {j.sourceType} · {day(j.date)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voidTitle")}</DialogTitle>
            <DialogDescription>{t("voidBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vp-void-reason">{t("voidReason")}</Label>
            <Textarea id="vp-void-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("back")}
            </Button>
            <Button variant="destructive" onClick={submitVoid} disabled={busy || reason.trim() === ""}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("void")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
