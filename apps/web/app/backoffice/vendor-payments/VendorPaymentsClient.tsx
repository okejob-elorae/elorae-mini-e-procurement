"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { formatIDR } from "@/lib/sales-orders/format";
import { getVendorPayments } from "@/app/actions/vendor-billing";
import type { VendorPaymentRow } from "@/lib/vendor-billing/payment-queries";

export function VendorPaymentsClient({ canCreate }: { canCreate: boolean }) {
  const t = useTranslations("vendorPayments");
  const [supplierId, setSupplierId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [rows, setRows] = useState<VendorPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getVendorPayments({ supplierId, from, to, search }));
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [supplierId, from, to, search, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on supplier; text and dates apply on Load
  }, [supplierId]);

  useEffect(() => {
    import("@/app/actions/suppliers")
      .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true }))
      .then((data: unknown) => setSuppliers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <Link href="/backoffice/vendor-payments/new" className="ml-auto">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("newPayment")}
            </Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
          <CardDescription>{t("listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t("supplier")}</Label>
              <SearchableCombobox
                options={[{ value: "", label: t("allSuppliers") }, ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))]}
                value={supplierId}
                onValueChange={setSupplierId}
                placeholder={t("allSuppliers")}
                triggerClassName="w-[240px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp-from">{t("from")}</Label>
              <TanggalInput id="vp-from" className="w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp-to">{t("to")}</Label>
              <TanggalInput id="vp-to" className="w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vp-search">{t("search")}</Label>
              <Input
                id="vp-search"
                className="w-[200px]"
                value={search}
                placeholder={t("searchPlaceholder")}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
              />
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {t("load")}
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colPayment")}</TableHead>
                    <TableHead>{t("supplier")}</TableHead>
                    <TableHead>{t("colDate")}</TableHead>
                    <TableHead>{t("colMethod")}</TableHead>
                    <TableHead>{t("colReference")}</TableHead>
                    <TableHead className="text-right">{t("colBills")}</TableHead>
                    <TableHead className="text-right">{t("colAmount")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <Link className="hover:underline" href={`/backoffice/vendor-payments/${r.id}`}>
                          {r.docNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{r.supplier.name}</TableCell>
                      <TableCell>{new Date(r.paidAt).toLocaleDateString("id-ID")}</TableCell>
                      <TableCell>{t(`method.${r.method}`)}</TableCell>
                      <TableCell>{r.reference || "-"}</TableCell>
                      <TableCell className="text-right">{r.billCount}</TableCell>
                      <TableCell className="text-right">{formatIDR(r.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={r.voidedAt ? "destructive" : "outline"}>{t(r.voidedAt ? "statusVoid" : "statusPosted")}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
