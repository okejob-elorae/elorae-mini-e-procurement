"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDateOnly } from "@/lib/date-only";
import { createVendorBillAction, getBillableSources } from "@/app/actions/vendor-billing";
import type { BillableGrnItem, BillableWoStep } from "@/lib/vendor-billing/billable";

type Draft = { on: boolean; qty: string; price: string };
type Sources = { grnItems: BillableGrnItem[]; woSteps: BillableWoStep[] };

const lineTotal = (d: Draft | undefined) => (d?.on ? Math.round(Number(d.qty) * Number(d.price) * 100) / 100 || 0 : 0);
/** Draft key of a GRN row: one per GRN and item key (decision 2026-10-29: invoices name receipts). */
const grnKey = (i: Pick<BillableGrnItem, "grnId" | "itemId" | "variantSku">) => `GRN:${i.grnId}:${i.itemId}:${i.variantSku ?? ""}`;

export function NewVendorBillClient({
  userId,
  pemasokAwal,
  sumberDiminta,
}: {
  userId: string;
  /** `?pemasok=` — preselects the supplier. */
  pemasokAwal?: string | null;
  /** `?permintaan=` of that supplier: the receipts the request named (`kunciDokumenHutang`), ticked at their remaining qty. */
  sumberDiminta?: string[];
}) {
  const t = useTranslations("vendorBills");
  const tGrn = useTranslations("vendorBills.grn");
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [supplierId, setSupplierId] = useState("");
  const [vendorInvoiceNo, setVendorInvoiceNo] = useState("");
  const [billDate, setBillDate] = useState(formatDateOnly(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<Sources | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    import("@/app/actions/suppliers")
      .then(({ getSuppliersForSelect }) => getSuppliersForSelect({ sync: true, approvedOnly: true }))
      .then((data: unknown) => setSuppliers(Array.isArray(data) ? data : []))
      .catch(() => toast.error(t("loadFailed")));
  }, [t]);

  const pickSupplier = async (id: string, centang: ReadonlySet<string> = new Set()) => {
    setSupplierId(id);
    setSources(null);
    setDrafts({});
    if (!id) return;
    setLoadingSources(true);
    try {
      const s = await getBillableSources(id);
      setSources(s);
      setDrafts(
        Object.fromEntries([
          ...s.grnItems.map((i) => [
            grnKey(i),
            { on: i.terhalang == null && centang.has(`GRN|${i.grnId}`), qty: String(i.remainingQty), price: String(i.recordedPrice) },
          ]),
          ...s.woSteps.map((st) => [`WO_STEP:${st.woStepId}`, { on: centang.has(`WO_STEP|${st.woStepId}`), qty: String(st.remainingQty), price: String(st.servicePrice) }]),
        ])
      );
    } catch {
      toast.error(t("loadFailed"));
    } finally {
      setLoadingSources(false);
    }
  };

  const awalDimuat = useRef(false);
  useEffect(() => {
    if (awalDimuat.current || !pemasokAwal) return;
    awalDimuat.current = true;
    void pickSupplier(pemasokAwal, new Set(sumberDiminta ?? []));
    // Only on first render: the URL picks the supplier once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const chosen = useMemo(() => Object.entries(drafts).filter(([, d]) => d.on), [drafts]);
  const total = chosen.reduce((s, [, d]) => s + lineTotal(d), 0);
  const linesValid = chosen.length > 0 && chosen.every(([, d]) => Number(d.qty) > 0 && d.price !== "" && Number(d.price) >= 0);
  const canSave = !!supplierId && vendorInvoiceNo.trim() !== "" && billDate !== "" && linesValid && !busy;

  const save = async () => {
    setBusy(true);
    try {
      const res = await createVendorBillAction(
        {
          supplierId,
          vendorInvoiceNo,
          billDate,
          dueDate: dueDate || undefined,
          notes: notes || undefined,
          // Typed by the action: two element shapes would otherwise leave flatMap without one U.
          lines: chosen.flatMap(([key, d]): Parameters<typeof createVendorBillAction>[0]["lines"] => {
            const qty = Number(d.qty);
            const price = Number(d.price);
            const g = sources?.grnItems.find((i) => grnKey(i) === key);
            if (g) return [{ type: "GRN_ITEM" as const, grnId: g.grnId, itemId: g.itemId, variantSku: g.variantSku, qty, price }];
            if (key.startsWith("WO_STEP:")) return [{ type: "WO_STEP" as const, sourceId: key.slice("WO_STEP:".length), qty, price }];
            return [];
          }),
        },
        userId
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("created", { docNumber: res.docNumber }));
      if (res.koreksi > 0) toast.warning(t("selisih.dibuat", { count: res.koreksi }));
      router.push(`/backoffice/vendor-bills/${res.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const variance = (key: string, ref: number) => {
    const d = drafts[key];
    return d?.on && d.price !== "" && Math.abs(Number(d.price) - ref) > 0.005;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/backoffice/vendor-bills">
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
            <Label htmlFor="vb-inv">{t("vendorInvoiceNo")}</Label>
            <Input id="vb-inv" maxLength={64} value={vendorInvoiceNo} onChange={(e) => setVendorInvoiceNo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-date">{t("billDate")}</Label>
            <TanggalInput id="vb-date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vb-due">{t("dueDate")}</Label>
            <TanggalInput id="vb-due" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("dueDateHint")}</p>
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-4">
            <Label htmlFor="vb-notes">{t("notes")}</Label>
            <Textarea id="vb-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {loadingSources && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {sources && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tGrn("judul")}</CardTitle>
              <CardDescription>{tGrn("subjudul")}</CardDescription>
            </CardHeader>
            <CardContent>
              {sources.grnItems.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">{tGrn("kosong")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>{tGrn("kolomPenerimaan")}</TableHead>
                      <TableHead>{t("colItem")}</TableHead>
                      <TableHead className="text-right">{t("colReceived")}</TableHead>
                      <TableHead className="text-right">{t("colBilled")}</TableHead>
                      <TableHead className="w-[130px]">{t("colQty")}</TableHead>
                      <TableHead className="w-[160px]">{t("colPrice")}</TableHead>
                      <TableHead className="text-right">{t("colAmount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.grnItems.map((i) => {
                      const key = grnKey(i);
                      const d = drafts[key];
                      const terhalang = i.terhalang != null;
                      return (
                        <TableRow key={key}>
                          <TableCell className="align-top">
                            <Checkbox
                              aria-label={`${i.grnDocNumber} ${i.itemName}`}
                              checked={d?.on ?? false}
                              disabled={terhalang}
                              onCheckedChange={(on) => setDraft(key, { on: on === true })}
                            />
                          </TableCell>
                          <TableCell className="align-top whitespace-normal">
                            <Link className="hover:underline" href={`/backoffice/inventory/grn/${i.grnId}`}>
                              {i.grnDocNumber}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {i.grnDate} · {i.poDocNumber ?? tGrn("tanpaPo")}
                            </div>
                            {i.poPaid && <div className="text-xs text-muted-foreground">{t("poPaidNotBillable")}</div>}
                            {terhalang && <div className="text-xs text-amber-700 dark:text-amber-400">{tGrn(`terhalang.${i.terhalang}`)}</div>}
                          </TableCell>
                          <TableCell className="align-top whitespace-normal">
                            <div>{i.itemName}</div>
                            <div className="text-xs text-muted-foreground">
                              {i.sku}
                              {i.variantSku ? ` · ${i.variantSku}` : ""}
                              {i.ppnMode !== "TANPA" ? ` · ${tGrn(`ppnMode.${i.ppnMode}`)}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-right">
                            {i.receivedQty.toLocaleString("id-ID")} {i.uomCode}
                            {i.returnedQty > 0 && <div className="text-xs text-muted-foreground">{tGrn("diretur", { qty: i.returnedQty.toLocaleString("id-ID") })}</div>}
                          </TableCell>
                          <TableCell className="align-top text-right">{i.billedQty.toLocaleString("id-ID")}</TableCell>
                          <TableCell className="align-top">
                            <Input
                              type="number"
                              min={0}
                              max={i.remainingQty}
                              aria-label={`${t("colQty")} ${i.itemName}`}
                              disabled={!d?.on}
                              value={d?.qty ?? ""}
                              onChange={(e) => setDraft(key, { qty: e.target.value })}
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <Input
                              type="number"
                              min={0}
                              aria-label={`${t("colPrice")} ${i.itemName}`}
                              disabled={!d?.on}
                              value={d?.price ?? ""}
                              onChange={(e) => setDraft(key, { price: e.target.value })}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">{tGrn("hargaPenerimaan", { harga: formatIDR(i.recordedPrice) })}</p>
                            {i.ppnMode === "PPN_MASUKAN" && <p className="text-xs text-muted-foreground">{tGrn("sebelumPpn")}</p>}
                            {variance(key, i.recordedPrice) && (
                              <>
                                <Badge variant="secondary" className="mt-1">
                                  {t("variance", { ref: formatIDR(i.recordedPrice) })}
                                </Badge>
                                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("selisih.akanMenunggu")}</p>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right">{d?.on ? formatIDR(lineTotal(d)) : "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("woSourcesTitle")}</CardTitle>
              <CardDescription>{t("woSourcesSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              {sources.woSteps.length === 0 ? (
                <p className="py-6 text-center text-muted-foreground">{t("noWoSources")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>WO</TableHead>
                      <TableHead>{t("colStep")}</TableHead>
                      <TableHead className="text-right">{t("colStepQty")}</TableHead>
                      <TableHead className="text-right">{t("colBilled")}</TableHead>
                      <TableHead className="w-[130px]">{t("colQty")}</TableHead>
                      <TableHead className="w-[160px]">{t("colPrice")}</TableHead>
                      <TableHead className="text-right">{t("colAmount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.woSteps.map((s) => {
                      const key = `WO_STEP:${s.woStepId}`;
                      const d = drafts[key];
                      const label = `${t("step")} ${s.sequence}${s.stepName ? ` · ${s.stepName}` : ""}`;
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <Checkbox
                              aria-label={`${s.woDocNumber} ${label}`}
                              checked={d?.on ?? false}
                              onCheckedChange={(on) => setDraft(key, { on: on === true })}
                            />
                          </TableCell>
                          <TableCell>
                            <Link className="hover:underline" href={`/backoffice/work-orders/${s.woId}`}>
                              {s.woDocNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {label}
                            {s.penerimaan.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                {s.penerimaan.map((r) => `${r.nomor} (${r.tanggal}, ${r.qty.toLocaleString("id-ID")} pcs)`).join(" · ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{s.qty.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{s.billedQty.toLocaleString()}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              max={s.remainingQty}
                              aria-label={`${t("colQty")} ${s.woDocNumber} ${label}`}
                              disabled={!d?.on}
                              value={d?.qty ?? ""}
                              onChange={(e) => setDraft(key, { qty: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              aria-label={`${t("colPrice")} ${s.woDocNumber} ${label}`}
                              disabled={!d?.on}
                              value={d?.price ?? ""}
                              onChange={(e) => setDraft(key, { price: e.target.value })}
                            />
                            {variance(key, s.servicePrice) && (
                              <>
                                <Badge variant="secondary" className="mt-1">
                                  {t("variance", { ref: formatIDR(s.servicePrice) })}
                                </Badge>
                                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("selisih.akanMenunggu")}</p>
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{d?.on ? formatIDR(lineTotal(d)) : "-"}</TableCell>
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
              {t("totalDicatat")}: {formatIDR(total)}
            </p>
            <Button onClick={save} disabled={!canSave}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
