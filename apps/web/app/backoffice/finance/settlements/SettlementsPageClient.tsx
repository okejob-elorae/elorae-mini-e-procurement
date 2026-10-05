"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { FileSpreadsheet, Upload, AlertCircle, Paperclip } from "lucide-react";
import type { SettlementListRow } from "@/lib/finance/settlement/queries";
/* Type-only: erased at compile, so the parser's xlsx dependency never reaches the client bundle. */
import type { SettlementParseError } from "@/lib/finance/settlement/shopee-settlement-parser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { BadgeGanda, type UnggahanPertamaTampil } from "./ganda";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

const UPLOAD_MARKETPLACES = ["SHOPEE", "TIKTOK"] as const;
type UploadMarketplace = (typeof UPLOAD_MARKETPLACES)[number];

type Props = {
  items: SettlementListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  /** id settlement → unggahan pertamanya, untuk baris yang kembar. */
  ganda?: Record<string, UnggahanPertamaTampil>;
};

/** Jawaban 409 rute unggah: berkas yang sama sudah pernah diunggah. */
type UploadDuplicateResponse = {
  code: "SETTLEMENT_GANDA";
  pertama: { id: string; fileName: string; uploadedAt: string; uploadedByName: string | null };
};

type UploadSuccessResponse = {
  settlementId: string;
  checksumOk: boolean;
  checksumVariance: number;
  lineCount: number;
};

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function SettlementsPageClient({ items, totalCount, page, pageSize, canManage, ganda = {} }: Props) {
  const router = useRouter();
  const t = useTranslations("financeSettlements");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [marketplace, setMarketplace] = useState<UploadMarketplace>("SHOPEE");
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<SettlementParseError[] | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);
  const [duplicateOfId, setDuplicateOfId] = useState<string | null>(null);

  const formatDate = (iso: string) => formatDisplayDate(iso, locale);

  const formatDateTime = (iso: string) => formatDisplayDateTime(iso, locale);

  const marketplaceLabel = (m: string): string =>
    t.has(`marketplaceOption.${m}`) ? t(`marketplaceOption.${m}`) : m;

  function goToPage(p: number) {
    startTransition(() => router.push(`/backoffice/finance/settlements?page=${p}`));
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadErrors(null);
    setUploadErrorMessage(null);
    setDuplicateOfId(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("marketplace", marketplace);
      const res = await fetch("/api/finance/settlements/upload", {
        method: "POST",
        body: formData,
      });

      if (res.status === 200) {
        const data = (await res.json()) as UploadSuccessResponse;
        toast.success(t("uploadSuccess", { lineCount: String(data.lineCount) }));
        setFile(null);
        setFileInputKey((k) => k + 1);
        startTransition(() => router.push(`/backoffice/finance/settlements/${data.settlementId}`));
        return;
      }

      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as UploadDuplicateResponse | null;
        if (data?.code === "SETTLEMENT_GANDA") {
          setUploadErrorMessage(
            t("uploadDuplicate", {
              fileName: data.pertama.fileName,
              by: data.pertama.uploadedByName ?? t("unknownUploader"),
              at: formatDateTime(data.pertama.uploadedAt),
            }),
          );
          setDuplicateOfId(data.pertama.id);
        } else {
          setUploadErrorMessage(t("uploadFailed"));
        }
        return;
      }

      if (res.status === 422) {
        const data = (await res.json().catch(() => ({ errors: [] }))) as {
          errors?: SettlementParseError[];
        };
        if (data.errors && data.errors.length > 0) setUploadErrors(data.errors);
        else setUploadErrorMessage(t("uploadGenericError"));
        return;
      }

      // Backend errors here are untranslated English tokens (e.g. "invalid multipart
      // body") — never echo them to the user, always show a localized message.
      setUploadErrorMessage(t("uploadFailed"));
    } catch {
      setUploadErrorMessage(t("uploadGenericError"));
    } finally {
      setUploading(false);
    }
  }

  const statusVariant = (status: string): "default" | "secondary" =>
    status === "MATCHED" || status === "RECONCILED" ? "default" : "secondary";

  // RECONCILED (sudah dijurnal) dulu jatuh ke label "Terproses" — sama dengan baru diunggah.
  const statusLabel = (status: string): string =>
    status === "RECONCILED"
      ? t("statusReconciled")
      : status === "MATCHED"
        ? t("statusMatched")
        : t("statusParsed");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <TombolBantuan judul={t("pageTitle")} />
        </div>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t("uploadTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="grid gap-2 sm:w-48">
                <label className="text-xs text-muted-foreground">{t("uploadMarketplaceLabel")}</label>
                <Select
                  value={marketplace}
                  onValueChange={(v) => setMarketplace(v as UploadMarketplace)}
                  disabled={uploading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UPLOAD_MARKETPLACES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`marketplaceOption.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 flex-1 min-w-0">
                <label id="settlement-file-label" className="text-xs text-muted-foreground">
                  {t("uploadFileLabel")}
                </label>
                {/* The native control renders the browser's own "Choose File / No file chosen"
                    in the browser's language, so it stays hidden behind a translated button. */}
                <input
                  key={fileInputKey}
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={uploading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex h-9 min-w-0 items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    aria-describedby="settlement-file-name"
                    aria-labelledby="settlement-file-label settlement-file-choose"
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    <span id="settlement-file-choose">{t("chooseFile")}</span>
                  </Button>
                  <span
                    id="settlement-file-name"
                    className="min-w-0 truncate text-sm text-muted-foreground"
                    title={file?.name}
                  >
                    {file ? file.name : t("noFileChosen")}
                  </span>
                </div>
              </div>
              <Button onClick={handleUpload} disabled={!file || uploading} className="sm:w-auto">
                {uploading ? t("uploading") : t("uploadButton")}
              </Button>
            </div>

            {uploadErrorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <span>{uploadErrorMessage}</span>
                  {duplicateOfId && (
                    <div>
                      <Link
                        href={`/backoffice/finance/settlements/${duplicateOfId}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {t("uploadDuplicateOpen")}
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}

            {uploadErrors && uploadErrors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium mb-1 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {t("uploadErrorsTitle")}
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {uploadErrors.map((err, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        {err.row !== null
                          ? t("uploadErrorAtRow", { sheet: err.sheet, row: String(err.row) })
                          : t("uploadErrorAtSheet", { sheet: err.sheet })}
                      </span>
                      {` — ${err.message}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t("listTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colPeriod")}</TableHead>
                      <TableHead>{t("colMarketplace")}</TableHead>
                      <TableHead>{t("colSeller")}</TableHead>
                      <TableHead>{t("colChecksum")}</TableHead>
                      <TableHead className="text-right">{t("colMatch")}</TableHead>
                      <TableHead>{t("colStatus")}</TableHead>
                      <TableHead>{t("colCreated")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          startTransition(() =>
                            router.push(`/backoffice/finance/settlements/${row.id}`),
                          )
                        }
                      >
                        <TableCell className="whitespace-nowrap">
                          {formatDate(row.periodFromIso)} – {formatDate(row.periodToIso)}
                        </TableCell>
                        <TableCell className="font-medium">{marketplaceLabel(row.marketplace)}</TableCell>
                        <TableCell className="whitespace-normal min-w-[120px] max-w-[220px]">{row.seller}</TableCell>
                        <TableCell>
                          {row.checksumOk ? (
                            <Badge variant="secondary">{t("checksumOk")}</Badge>
                          ) : (
                            <Badge variant="destructive">
                              {t("checksumVariance", { amount: formatRupiah(row.checksumVariance) })}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.matchedCount} / {row.lineCount}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                            {ganda[row.id] && <BadgeGanda pertama={ganda[row.id]} />}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(row.createdAtIso)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                page={page}
                totalPages={Math.max(1, Math.ceil(totalCount / pageSize))}
                onPageChange={goToPage}
                totalCount={totalCount}
                pageSize={pageSize}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
