"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  getItemRequestLines,
  getLastPricesForSupplier,
  cancelItemRequestLines,
  convertItemRequestLinesToPo,
} from "@/app/actions/item-requests";
import type { RequestLineRow } from "@/lib/item-requests/queries";

const STATUS_VARIANT = { OPEN: "default", CONVERTED: "secondary", CANCELLED: "outline" } as const;

export function ItemRequestsClient({ userId, canManage, canCreatePo }: { userId: string; canManage: boolean; canCreatePo: boolean }) {
  const t = useTranslations("itemRequests");
  const router = useRouter();
  const [status, setStatus] = useState("OPEN");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RequestLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [supplierId, setSupplierId] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getItemRequestLines({ status: status === "ALL" ? undefined : status, search }));
      setSelected(new Set());
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [status, search, t]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on status change; search applies on Enter / button
  }, [status]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const openRows = rows.filter((r) => r.status === "OPEN");

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const openConvert = () => {
    setSupplierId("");
    setEtaDate("");
    setPrices(Object.fromEntries(selectedRows.map((r) => [r.id, ""])));
    setConvertOpen(true);
    if (suppliers.length === 0) {
      import("@/app/actions/suppliers")
        .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true, approvedOnly: true }))
        .then((data: unknown) => setSuppliers(Array.isArray(data) ? data : []))
        .catch(() => toast.error(t("loadFailed")));
    }
  };

  const pickSupplier = async (id: string) => {
    setSupplierId(id);
    if (!id) return;
    // Prefill only the prices the user has not typed yet.
    const last = await getLastPricesForSupplier([...new Set(selectedRows.map((r) => r.itemId))], id).catch(() => ({}) as Record<string, number>);
    setPrices((prev) =>
      Object.fromEntries(selectedRows.map((r) => [r.id, prev[r.id] || (last[r.itemId] != null ? String(last[r.itemId]) : "")]))
    );
  };

  const pricesValid = selectedRows.every((r) => prices[r.id] !== "" && Number(prices[r.id]) >= 0);

  const submitConvert = async () => {
    setBusy(true);
    try {
      const res = await convertItemRequestLinesToPo(
        {
          lineIds: selectedRows.map((r) => r.id),
          supplierId,
          prices: Object.fromEntries(selectedRows.map((r) => [r.id, Number(prices[r.id])])),
          etaDate: etaDate || undefined,
        },
        userId
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("poCreated", { docNumber: res.docNumber }));
      setConvertOpen(false);
      router.push(`/backoffice/purchase-orders/${res.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const cancelSelected = async () => {
    if (!confirm(t("confirmCancel", { count: selectedRows.length }))) return;
    setBusy(true);
    try {
      const res = await cancelItemRequestLines(selectedRows.map((r) => r.id), userId);
      if (!res.ok) toast.error(res.error);
      else toast.success(t("linesCancelled"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
          <CardDescription>{t("listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>{t("status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["OPEN", "CONVERTED", "CANCELLED", "ALL"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`statusLabel.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ir-search">{t("search")}</Label>
              <Input
                id="ir-search"
                className="w-[260px]"
                value={search}
                placeholder={t("searchPlaceholder")}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void load()}
              />
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {t("load")}
            </Button>
            {canManage && (
              <div className="ml-auto flex gap-2">
                <Button variant="outline" disabled={busy || selectedRows.length === 0} onClick={cancelSelected}>
                  {t("cancelLines")}
                </Button>
                {canCreatePo && (
                  <Button disabled={busy || selectedRows.length === 0} onClick={openConvert}>
                    {t("createPo", { count: selectedRows.length })}
                  </Button>
                )}
              </div>
            )}
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
                    {canManage && (
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t("selectAll")}
                          checked={openRows.length > 0 && openRows.every((r) => selected.has(r.id))}
                          onCheckedChange={(on) => setSelected(on ? new Set(openRows.map((r) => r.id)) : new Set())}
                        />
                      </TableHead>
                    )}
                    <TableHead>{t("colRequest")}</TableHead>
                    <TableHead>{t("colDate")}</TableHead>
                    <TableHead>{t("colSource")}</TableHead>
                    <TableHead>{t("colItem")}</TableHead>
                    <TableHead className="text-right">{t("colQty")}</TableHead>
                    <TableHead>{t("colUnit")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>PO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      {canManage && (
                        <TableCell>
                          <Checkbox
                            aria-label={`${r.docNumber} ${r.itemName}`}
                            disabled={r.status !== "OPEN"}
                            checked={selected.has(r.id)}
                            onCheckedChange={(on) => toggle(r.id, on === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">
                        <Link className="hover:underline" href={`/backoffice/item-requests/${r.requestId}`}>
                          {r.docNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{new Date(r.createdAt).toLocaleDateString("id-ID")}</TableCell>
                      <TableCell>
                        {r.sourceWo ? (
                          <Link className="hover:underline" href={`/backoffice/work-orders/${r.sourceWo.id}`}>
                            {r.sourceWo.docNumber}
                          </Link>
                        ) : (
                          "-"
                        )}
                        {r.sourceWo?.status === "CANCELLED" && <span className="ml-1 text-xs text-muted-foreground">({t("woCancelled")})</span>}
                      </TableCell>
                      <TableCell>
                        <div>{r.itemName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.itemSku}
                          {r.variantSku ? ` · ${r.variantSku}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                      <TableCell>{r.uomCode}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{t(`statusLabel.${r.status}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        {r.po ? (
                          <Link className="hover:underline" href={`/backoffice/purchase-orders/${r.po.id}`}>
                            {r.po.docNumber}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={convertOpen} onOpenChange={(open) => !open && !busy && setConvertOpen(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("convertTitle")}</DialogTitle>
            <CardDescription>{t("convertSubtitle")}</CardDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-2">
                <Label>{t("supplier")}</Label>
                <SearchableCombobox
                  options={suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
                  value={supplierId}
                  onValueChange={(v) => void pickSupplier(v)}
                  placeholder={t("pickSupplier")}
                  triggerClassName="w-[280px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ir-eta">{t("eta")}</Label>
                <Input id="ir-eta" type="date" className="w-[180px]" value={etaDate} onChange={(e) => setEtaDate(e.target.value)} />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colItem")}</TableHead>
                  <TableHead className="text-right">{t("colQty")}</TableHead>
                  <TableHead className="w-[180px]">{t("price")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.itemName}
                      <div className="text-xs text-muted-foreground">{r.docNumber}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.qty.toLocaleString()} {r.uomCode}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        aria-label={`${t("price")} ${r.itemName}`}
                        value={prices[r.id] ?? ""}
                        onChange={(e) => setPrices((p) => ({ ...p, [r.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={busy}>
                {t("back")}
              </Button>
              <Button onClick={submitConvert} disabled={busy || !supplierId || !pricesValid}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("createPoConfirm")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
