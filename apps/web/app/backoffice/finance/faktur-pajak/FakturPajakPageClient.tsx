"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Receipt, Search, AlertCircle, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/date-only";
import type { TaxInvoiceRow, TaxInvoiceStatusFilter } from "@/lib/tax-invoices/queries";
import {
  markCreatedAction,
  markNotRequiredAction,
  revertToPendingAction,
  type TaxInvoiceActionResult,
} from "@/app/actions/tax-invoices";
import { formatRupiah } from "@/lib/format/rupiah";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

type StatusFilter = TaxInvoiceStatusFilter | "ALL";

type Props = {
  rows: TaxInvoiceRow[];
  total: number;
  counts: Record<TaxInvoiceStatusFilter, number>;
  status: StatusFilter;
  q: string;
  page: number;
  pageSize: number;
  canManage: boolean;
  /** No. Nota menjadi tautan ke pesanan (tempat nota & isi barangnya) hanya bila boleh membukanya. */
  canViewOrder: boolean;
  loadError: boolean;
};

type DialogKind = "markCreated" | "notRequired" | "revertToPending";

type SelectedRow = { id: string; docNo: string };

const BASE_PATH = "/backoffice/finance/faktur-pajak";

const STATUS_BADGE_VARIANT: Record<TaxInvoiceStatusFilter, "secondary" | "default" | "outline"> = {
  PENDING: "secondary",
  CREATED: "default",
  NOT_REQUIRED: "outline",
};

const STATUS_LABEL_KEY: Record<TaxInvoiceStatusFilter, "statusPending" | "statusCreated" | "statusNotRequired"> = {
  PENDING: "statusPending",
  CREATED: "statusCreated",
  NOT_REQUIRED: "statusNotRequired",
};


export function FakturPajakPageClient(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const t = useTranslations("fakturPajak");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [isNavPending, startNavTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(props.q);
  const [dialog, setDialog] = useState<{ kind: DialogKind; row: SelectedRow } | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  // Penolakan nomor faktur pajak ditampilkan di bawah isiannya, bukan sebagai toast yang lewat.
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== props.q) pushParam("q", searchInput);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce fires on searchInput only
  }, [searchInput]);

  function pushParam(key: string, value: string | undefined): void {
    const params = new URLSearchParams(sp.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    params.delete("page");
    startNavTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function reset(): void {
    setSearchInput("");
    startNavTransition(() => router.push(BASE_PATH));
  }

  function goToPage(p: number): void {
    const params = new URLSearchParams(sp.toString());
    params.set("page", String(p));
    startNavTransition(() => router.push(`${BASE_PATH}?${params.toString()}`));
  }

  function openDialog(kind: DialogKind, row: TaxInvoiceRow): void {
    setFieldValue("");
    setFieldError(null);
    setDialog({ kind, row: { id: row.id, docNo: row.docNo } });
  }

  function closeDialog(): void {
    setDialog(null);
    setFieldValue("");
    setFieldError(null);
  }

  function changeField(value: string): void {
    setFieldValue(value);
    setFieldError(null);
  }

  const trimmedField = fieldValue.trim();
  const canSubmitDialog = dialog !== null && !isActionPending && trimmedField !== "";

  function dialogCopyFor(kind: DialogKind, docNo: string) {
    switch (kind) {
      case "markCreated":
        return {
          title: t("markCreatedTitle"),
          description: t("markCreatedDescription", { docNo }),
          fieldLabel: t("markCreatedFieldLabel"),
          placeholder: t("markCreatedFieldPlaceholder"),
          fieldRequired: t("markCreatedFieldRequired"),
          submitLabel: t("markCreatedSubmit"),
          submittingLabel: t("markCreatedSubmitting"),
          multiline: false,
        };
      case "notRequired":
        return {
          title: t("notRequiredTitle"),
          description: t("notRequiredDescription", { docNo }),
          fieldLabel: t("notRequiredFieldLabel"),
          placeholder: t("notRequiredFieldPlaceholder"),
          fieldRequired: t("notRequiredFieldRequired"),
          submitLabel: t("notRequiredSubmit"),
          submittingLabel: t("notRequiredSubmitting"),
          multiline: true,
        };
      case "revertToPending":
        return {
          title: t("revertTitle"),
          description: t("revertDescription", { docNo }),
          fieldLabel: t("revertFieldLabel"),
          placeholder: t("revertFieldPlaceholder"),
          fieldRequired: t("revertFieldRequired"),
          submitLabel: t("revertSubmit"),
          submittingLabel: t("revertSubmitting"),
          multiline: true,
        };
    }
  }

  function submitDialog(): void {
    if (!dialog || !canSubmitDialog) return;
    const { kind, row } = dialog;
    startActionTransition(async () => {
      try {
        let result: TaxInvoiceActionResult;
        if (kind === "markCreated") {
          result = await markCreatedAction({ taxInvoiceId: row.id, invoiceNo: trimmedField });
        } else if (kind === "notRequired") {
          result = await markNotRequiredAction({ taxInvoiceId: row.id, reason: trimmedField });
        } else {
          result = await revertToPendingAction({ taxInvoiceId: row.id, reason: trimmedField });
        }
        if (result.ok) {
          toast.success(t(`${kind}Success`));
          closeDialog();
          router.refresh();
          return;
        }
        if (result.code === "NOMOR_FAKTUR_GANDA" || result.code === "NOMOR_FAKTUR_FORMAT") {
          setFieldError(
            result.code === "NOMOR_FAKTUR_GANDA" && result.dipakaiDi
              ? t("nomorFakturGandaDi", { docNo: result.dipakaiDi })
              : t(`actionErr.${result.code}`),
          );
          return;
        }
        toast.error(t(`actionErr.${result.code}`));
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  const totalCount = props.counts.PENDING + props.counts.CREATED + props.counts.NOT_REQUIRED;
  const copy = dialog ? dialogCopyFor(dialog.kind, dialog.row.docNo) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("judulHalaman")}</h1>
          <TombolBantuan judul={t("judulHalaman")} />
        </div>
        {/* Ekspor XML impor Coretax dari nota yang menunggu faktur (lib/finance/pajak/coretax.ts). */}
        <Button asChild variant="outline" size="sm">
          <Link href="/backoffice/finance/pajak/faktur-keluaran">{t("eksporCoretax")}</Link>
        </Button>
      </div>

      {props.loadError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">{t("loadErrorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("loadErrorMessage")}</p>
            </div>
            <Button variant="outline" className="h-10" onClick={() => router.refresh()}>
              {t("loadErrorRetry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs
            value={props.status}
            onValueChange={(v) => pushParam("status", v === "ALL" ? undefined : v)}
          >
            {/* Turun baris di layar sempit: di HP 390 px keempat tab tidak muat satu baris. */}
            <TabsList className="h-auto max-w-full flex-wrap justify-start">
              <TabsTrigger value="ALL">
                {t("statusAll")} ({totalCount})
              </TabsTrigger>
              <TabsTrigger value="PENDING">
                {t("statusPending")} ({props.counts.PENDING})
              </TabsTrigger>
              <TabsTrigger value="CREATED">
                {t("statusCreated")} ({props.counts.CREATED})
              </TabsTrigger>
              <TabsTrigger value="NOT_REQUIRED">
                {t("statusNotRequired")} ({props.counts.NOT_REQUIRED})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-10 pl-9"
                placeholder={t("searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Button variant="outline" className="h-10" onClick={reset}>
              {t("reset")}
            </Button>
          </div>

          <Card className={cn(isNavPending && "opacity-60 pointer-events-none transition-opacity")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {t("listTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {props.rows.length === 0 ? (
                <div className="text-center py-12">
                  <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">{t("empty")}</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colDocNo")}</TableHead>
                          <TableHead>{t("colStore")}</TableHead>
                          <TableHead>{t("colInvoiceDate")}</TableHead>
                          <TableHead>{t("colDueDate")}</TableHead>
                          <TableHead className="text-right">{t("colTotal")}</TableHead>
                          <TableHead className="hidden 2xl:table-cell">{t("colPrinted")}</TableHead>
                          <TableHead>{t("colStatus")}</TableHead>
                          {props.canManage && <TableHead>{tCommon("actions")}</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {props.rows.map((row) => {
                          const status = row.status as TaxInvoiceStatusFilter;
                          return (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium whitespace-nowrap">
                                {props.canViewOrder ? (
                                  <Link
                                    href={`/backoffice/field-sales-orders/${encodeURIComponent(row.orderId)}`}
                                    className="underline underline-offset-4"
                                  >
                                    {row.docNo}
                                  </Link>
                                ) : (
                                  row.docNo
                                )}
                              </TableCell>
                              <TableCell className="max-w-[180px] truncate">{row.storeName}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDisplayDate(row.invoiceDate, locale)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDisplayDate(row.dueDate, locale)}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {formatRupiah(row.total)}
                              </TableCell>
                              <TableCell className="hidden 2xl:table-cell whitespace-nowrap">
                                {row.notaPrintedAt ? (
                                  formatDisplayDate(row.notaPrintedAt, locale)
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={STATUS_BADGE_VARIANT[status]}>
                                  {t(STATUS_LABEL_KEY[status])}
                                </Badge>
                                {row.invoiceNo && (
                                  <div
                                    className="mt-1 text-xs text-muted-foreground break-all"
                                    title={t("invoiceNoLabel", { invoiceNo: row.invoiceNo })}
                                  >
                                    {row.invoiceNo}
                                  </div>
                                )}
                              </TableCell>
                              {props.canManage && (
                                <TableCell>
                                  <div className="flex flex-nowrap items-center gap-1">
                                    {status === "PENDING" ? (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-10 whitespace-nowrap"
                                          onClick={() => openDialog("markCreated", row)}
                                        >
                                          {t("actionMarkCreated")}
                                        </Button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-10 w-10"
                                              aria-label={t("actionMore")}
                                              title={t("actionMore")}
                                            >
                                              <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => openDialog("notRequired", row)}>
                                              {t("actionNotRequired")}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-10"
                                        onClick={() => openDialog("revertToPending", row)}
                                      >
                                        {t("actionRevert")}
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <Pagination
                    page={props.page}
                    totalPages={Math.max(1, Math.ceil(props.total / props.pageSize))}
                    onPageChange={goToPage}
                    totalCount={props.total}
                    pageSize={props.pageSize}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {dialog && copy && (
        <Dialog open onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="faktur-pajak-field">{copy.fieldLabel}</Label>
              {copy.multiline ? (
                <Textarea
                  id="faktur-pajak-field"
                  rows={3}
                  value={fieldValue}
                  disabled={isActionPending}
                  placeholder={copy.placeholder}
                  onChange={(e) => changeField(e.target.value)}
                />
              ) : (
                <Input
                  id="faktur-pajak-field"
                  className="h-10"
                  value={fieldValue}
                  disabled={isActionPending}
                  placeholder={copy.placeholder}
                  aria-invalid={fieldError !== null}
                  aria-describedby={fieldError !== null ? "faktur-pajak-field-error" : undefined}
                  onChange={(e) => changeField(e.target.value)}
                />
              )}
              {trimmedField === "" && (
                <p className="text-xs text-muted-foreground">{copy.fieldRequired}</p>
              )}
              {fieldError !== null && (
                <p id="faktur-pajak-field-error" role="alert" className="text-sm text-destructive">
                  {fieldError}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" className="h-10" disabled={isActionPending} onClick={closeDialog}>
                {tCommon("cancel")}
              </Button>
              <Button className="h-10" disabled={!canSubmitDialog} onClick={submitDialog}>
                {isActionPending ? copy.submittingLabel : copy.submitLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
