"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { FileSpreadsheet, Upload, AlertCircle } from "lucide-react";
import type { SettlementListRow } from "@/lib/finance/settlement/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";

type Props = {
  items: SettlementListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  canManage: boolean;
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

export function SettlementsPageClient({ items, totalCount, page, pageSize, canManage }: Props) {
  const router = useRouter();
  const t = useTranslations("financeSettlements");
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[] | null>(null);
  const [uploadErrorMessage, setUploadErrorMessage] = useState<string | null>(null);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  function goToPage(p: number) {
    startTransition(() => router.push(`/backoffice/finance/settlements?page=${p}`));
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadErrors(null);
    setUploadErrorMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
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

      if (res.status === 422) {
        const data = (await res.json().catch(() => ({ errors: [] }))) as { errors?: string[] };
        setUploadErrors(data.errors && data.errors.length > 0 ? data.errors : [t("uploadGenericError")]);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setUploadErrorMessage(data.error ?? t("uploadGenericError"));
    } catch {
      setUploadErrorMessage(t("uploadGenericError"));
    } finally {
      setUploading(false);
    }
  }

  const statusVariant = (status: string): "default" | "secondary" =>
    status === "MATCHED" ? "default" : "secondary";

  const statusLabel = (status: string): string =>
    status === "MATCHED" ? t("statusMatched") : t("statusParsed");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
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
              <div className="grid gap-2 flex-1">
                <label className="text-xs text-muted-foreground">{t("uploadFileLabel")}</label>
                <Input
                  key={fileInputKey}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={uploading}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button onClick={handleUpload} disabled={!file || uploading} className="sm:w-auto">
                {uploading ? t("uploading") : t("uploadButton")}
              </Button>
            </div>

            {file && !uploading && (
              <p className="text-xs text-muted-foreground truncate">{t("selectedFile", { name: file.name })}</p>
            )}

            {uploadErrorMessage && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{uploadErrorMessage}</span>
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
                    <li key={i}>{err}</li>
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
                        <TableCell className="font-medium">{row.marketplace}</TableCell>
                        <TableCell>{row.seller}</TableCell>
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
                          <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
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
