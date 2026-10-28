"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDateOnly } from "@/lib/date-only";
import { createVendorPaymentAction, getOpenBills } from "@/app/actions/vendor-billing";
import type { OpenBill } from "@/lib/vendor-billing/payment-queries";

const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("id-ID") : "-");

export function NewVendorPaymentClient({ userId }: { userId: string }) {
  const t = useTranslations("vendorPayments");
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [supplierId, setSupplierId] = useState("");
  const [paidAt, setPaidAt] = useState(formatDateOnly(new Date()));
  const [method, setMethod] = useState<"BANK" | "CASH">("BANK");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [bills, setBills] = useState<OpenBill[] | null>(null);
  const [loadingBills, setLoadingBills] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    import("@/app/actions/suppliers")
      .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true }))
      .then((data: unknown) => setSuppliers(Array.isArray(data) ? data : []))
      .catch(() => toast.error(t("loadFailed")));
  }, [t]);

  const pickSupplier = async (id: string) => {
    setSupplierId(id);
    setBills(null);
    setAlloc({});
    if (!id) return;
    setLoadingBills(true);
    try {
      setBills(await getOpenBills(id));
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoadingBills(false);
    }
  };

  const chosen = (bills ?? []).filter((b) => Number(alloc[b.id]) > 0);
  const total = Math.round(chosen.reduce((s, b) => s + Number(alloc[b.id]), 0) * 100) / 100;
  const overAllocated = chosen.some((b) => Number(alloc[b.id]) > b.outstanding + 0.005);
  const canSave = !!supplierId && paidAt !== "" && chosen.length > 0 && !overAllocated && !busy;

  const save = async () => {
    setBusy(true);
    try {
      const res = await createVendorPaymentAction(
        {
          supplierId,
          paidAt,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
          allocations: chosen.map((b) => ({ billId: b.id, amount: Number(alloc[b.id]) })),
        },
        userId
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("created", { docNumber: res.docNumber }));
      router.push(`/backoffice/vendor-payments/${res.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/vendor-payments">
          <Button variant="ghost" size="icon" aria-label={t("back")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("newTitle")}</h1>
          <p className="text-muted-foreground">{t("newSubtitle")}</p>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>{t("supplier")}</Label>
            <SearchableCombobox
              options={suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
              value={supplierId}
              onValueChange={(v) => void pickSupplier(v)}
              placeholder={t("pickSupplier")}
              triggerClassName="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vp-date">{t("paidAt")}</Label>
            <Input id="vp-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("colMethod")}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as "BANK" | "CASH")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK">{t("method.BANK")}</SelectItem>
                <SelectItem value="CASH">{t("method.CASH")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vp-ref">{t("colReference")}</Label>
            <Input id="vp-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="vp-notes">{t("notes")}</Label>
            <Textarea id="vp-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {loadingBills && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {bills && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("openBillsTitle")}</CardTitle>
              <CardDescription>{t("openBillsSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              {bills.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">{t("noOpenBills")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colBill")}</TableHead>
                      <TableHead>{t("colVendorInvoice")}</TableHead>
                      <TableHead>{t("colDue")}</TableHead>
                      <TableHead className="text-right">{t("colOutstanding")}</TableHead>
                      <TableHead className="w-[180px]">{t("colAllocation")}</TableHead>
                      <TableHead className="w-[110px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.map((b) => {
                      const over = Number(alloc[b.id]) > b.outstanding + 0.005;
                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Link className="hover:underline" href={`/backoffice/vendor-bills/${b.id}`}>
                              {b.docNumber}
                            </Link>
                          </TableCell>
                          <TableCell>{b.vendorInvoiceNo}</TableCell>
                          <TableCell>{day(b.dueDate)}</TableCell>
                          <TableCell className="text-right">{formatIDR(b.outstanding)}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={b.outstanding}
                              aria-label={`${t("colAllocation")} ${b.docNumber}`}
                              aria-invalid={over}
                              value={alloc[b.id] ?? ""}
                              onChange={(e) => setAlloc((a) => ({ ...a, [b.id]: e.target.value }))}
                            />
                            {over && <p className="mt-1 text-xs text-destructive">{t("overAllocated")}</p>}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAlloc((a) => ({ ...a, [b.id]: String(b.outstanding) }))}
                            >
                              {t("payFull")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-4">
            <p className="text-lg font-semibold">
              {t("colAmount")}: {formatIDR(total)}
            </p>
            <Button onClick={save} disabled={!canSave}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("pay")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
