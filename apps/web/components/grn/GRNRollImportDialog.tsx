"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  GRN_ROLL_IMPORT_COLUMNS,
  GRN_ROLL_IMPORT_MAX_BYTES,
  GRN_ROLL_IMPORT_MAX_ROWS,
  rollImportError,
  type GrnRollImportError,
  type GrnRollImportErrorCode,
  type GrnRollImportLineSummary,
  type GrnRollImportRow,
  type GrnRollImportTargetLine,
  type ImportedRoll,
} from "@/lib/grn/roll-import/types";
import { validateGrnRollImport } from "@/lib/grn/roll-import/validate";

type Plan = Record<string, ImportedRoll[]>;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "fileError"; fileName: string; errors: GrnRollImportError[] }
  | {
    kind: "checked";
    fileName: string;
    errors: GrnRollImportError[];
    summary: GrnRollImportLineSummary[];
    plan: Plan | null;
  };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: GrnRollImportTargetLine[];
  existingRollCounts: Record<string, number>;
  templateFileName: string;
  onApply: (plan: Plan) => void;
};

const MAX_MB = GRN_ROLL_IMPORT_MAX_BYTES / (1024 * 1024);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Exhaustive on purpose: a new error code without an entry here is a compile error. It does NOT
 * prove the locale files carry that key (apps/web has no typed next-intl messages), so add the copy to both.
 */
const ERROR_KEY: Record<GrnRollImportErrorCode, `err.${GrnRollImportErrorCode}`> = {
  NOT_XLSX: "err.NOT_XLSX",
  FILE_TOO_LARGE: "err.FILE_TOO_LARGE",
  UNREADABLE_FILE: "err.UNREADABLE_FILE",
  MISSING_SHEET: "err.MISSING_SHEET",
  MISSING_HEADER: "err.MISSING_HEADER",
  EMPTY_FILE: "err.EMPTY_FILE",
  TOO_MANY_ROWS: "err.TOO_MANY_ROWS",
  AMBIGUOUS_LINE: "err.AMBIGUOUS_LINE",
  REQUIRED: "err.REQUIRED",
  UNKNOWN_LINE: "err.UNKNOWN_LINE",
  INVALID_NUMBER: "err.INVALID_NUMBER",
  NOT_POSITIVE: "err.NOT_POSITIVE",
  TOO_MANY_DECIMALS: "err.TOO_MANY_DECIMALS",
  TOO_LARGE: "err.TOO_LARGE",
  TOO_LONG: "err.TOO_LONG",
  DATE_CELL: "err.DATE_CELL",
  DUPLICATE_REF: "err.DUPLICATE_REF",
};

const COLUMN_KEYS = new Set<string>(GRN_ROLL_IMPORT_COLUMNS.map((c) => c.key));

export function GRNRollImportDialog({
  open,
  onOpenChange,
  lines,
  existingRollCounts,
  templateFileName,
  onApply,
}: Props) {
  const t = useTranslations("grnRollImport");
  const locale = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  /* Bumped on every new read and on reset, so a read that finishes after either is dropped. */
  const runId = useRef(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const busy = phase.kind === "reading";
  const checked = phase.kind === "checked" ? phase : null;
  /* Parse-only codes (DATE_CELL, MISSING_HEADER) never reach the validator, so its plan alone is not a clean bill. */
  const canApply = checked !== null && checked.errors.length === 0 && checked.plan !== null;
  const replacedLines = checked?.plan
    ? Object.keys(checked.plan).filter((id) => (existingRollCounts[id] ?? 0) > 0).length
    : 0;
  const hasOver = checked?.summary.some((s) => s.overBy !== null) ?? false;

  function formatQty(n: number): string {
    return n.toLocaleString(locale, { maximumFractionDigits: 2 });
  }

  function errorMessage(e: GrnRollImportError): string {
    return t(ERROR_KEY[e.code], { detail: e.detail ?? "" });
  }

  function reset() {
    runId.current += 1;
    setPhase({ kind: "idle" });
    setDragging(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const { buildGrnRollImportTemplate } = await import("@/lib/grn/roll-import/workbook");
      const blob = new Blob([buildGrnRollImportTemplate(lines)], { type: XLSX_MIME });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = templateFileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("templateFailed"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    runId.current += 1;
    const run = runId.current;
    const fileName = file.name;
    if (!fileName.toLowerCase().endsWith(".xlsx")) {
      setPhase({ kind: "fileError", fileName, errors: [rollImportError("NOT_XLSX")] });
      return;
    }
    if (file.size > GRN_ROLL_IMPORT_MAX_BYTES) {
      setPhase({
        kind: "fileError",
        fileName,
        errors: [rollImportError("FILE_TOO_LARGE", { detail: String(MAX_MB) })],
      });
      return;
    }
    setPhase({ kind: "reading", fileName });
    let parsed: { rows: GrnRollImportRow[]; errors: GrnRollImportError[] };
    try {
      const { parseGrnRollImportWorkbook } = await import("@/lib/grn/roll-import/workbook");
      parsed = parseGrnRollImportWorkbook(await file.arrayBuffer());
    } catch {
      if (run === runId.current) {
        setPhase({ kind: "fileError", fileName, errors: [rollImportError("UNREADABLE_FILE")] });
      }
      return;
    }
    if (run !== runId.current) return;
    /* A file-level failure returns no rows; row-level errors come back beside the rows. */
    if (parsed.rows.length === 0) {
      setPhase({ kind: "fileError", fileName, errors: parsed.errors });
      return;
    }
    const result = validateGrnRollImport(parsed.rows, lines);
    setPhase({
      kind: "checked",
      fileName,
      errors: [...parsed.errors, ...result.errors],
      summary: result.summary,
      plan: result.plan,
    });
  }

  function apply() {
    if (!checked || !checked.plan || !canApply) return;
    const plan = checked.plan;
    const rolls = Object.values(plan).reduce((sum, list) => sum + list.length, 0);
    onApply(plan);
    toast.success(t("applied", { rolls, lines: Object.keys(plan).length }));
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pb-4 pt-6 pr-12">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("step1Title")}</h3>
            <p className="text-sm text-muted-foreground">{t("step1Body")}</p>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => void downloadTemplate()}
              disabled={downloading}
            >
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {t("downloadTemplate")}
            </Button>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("step2Title")}</h3>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file && !busy) void handleFile(file);
              }}
              className={cn(
                "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
              )}
            >
              {phase.kind === "reading" ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="max-w-full truncate text-sm" title={phase.fileName}>
                    {t("reading", { file: phase.fileName })}
                  </p>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                  <p
                    className="max-w-full truncate text-sm"
                    title={phase.kind === "idle" ? undefined : phase.fileName}
                  >
                    {phase.kind === "idle" ? t("dropHint") : phase.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("limits", { maxRows: GRN_ROLL_IMPORT_MAX_ROWS, maxMb: MAX_MB })}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {phase.kind === "idle" ? t("chooseFile") : t("chooseAnother")}
                  </Button>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept={`.xlsx,${XLSX_MIME}`}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </div>

            {phase.kind === "fileError" ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>{t("fileErrorTitle")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4">
                    {phase.errors.map((e, i) => (
                      <li key={`${e.code}-${i}`}>{errorMessage(e)}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </section>

          {checked && checked.summary.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("summaryTitle")}</h3>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colItem")}</TableHead>
                      <TableHead className="text-right">{t("colRolls")}</TableHead>
                      <TableHead className="text-right">{t("colTotal")}</TableHead>
                      <TableHead className="text-right">{t("colOrdered")}</TableHead>
                      <TableHead className="text-right">{t("colReceived")}</TableHead>
                      <TableHead className="text-right">{t("colAfter")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checked.summary.map((s) => (
                      <TableRow key={s.lineId}>
                        <TableCell className="max-w-[12rem]">
                          <span
                            className="block truncate font-mono text-xs font-medium"
                            title={`${s.sku} ${s.variantSku ?? ""} ${s.name}`.trim()}
                          >
                            {s.variantSku ?? s.sku}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground" title={s.name}>
                            {s.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.rollCount}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatQty(s.totalLength)} {s.uomCode}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {s.orderedQty === null ? "—" : formatQty(s.orderedQty)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {s.alreadyReceivedQty === null ? "—" : formatQty(s.alreadyReceivedQty)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {s.afterQty === null ? "—" : formatQty(s.afterQty)}
                          {s.overBy !== null ? (
                            <Badge
                              variant="outline"
                              className="ml-2 border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                            >
                              {t("overBadge", { qty: formatQty(s.overBy), uom: s.uomCode })}
                            </Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {hasOver ? <p className="text-xs text-muted-foreground">{t("overNote")}</p> : null}
            </section>
          ) : null}

          {checked && checked.errors.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-destructive">
                {t("errorsTitle", { count: checked.errors.length })}
              </h3>
              <div className="overflow-x-auto rounded-md border border-destructive/40">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">{t("colRow")}</TableHead>
                      <TableHead className="w-32">{t("colColumn")}</TableHead>
                      <TableHead>{t("colMessage")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {checked.errors.map((e, i) => (
                      <TableRow key={`${e.row ?? "file"}-${e.column ?? "none"}-${e.code}-${i}`}>
                        <TableCell className="tabular-nums">{e.row ?? "—"}</TableCell>
                        <TableCell>{e.column && COLUMN_KEYS.has(e.column) ? t(`col.${e.column}`) : "—"}</TableCell>
                        <TableCell className="whitespace-normal break-words">{errorMessage(e)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </div>

        <div className="space-y-3 border-t px-6 py-4">
          {canApply && replacedLines > 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertDescription>{t("replaceNotice", { count: replacedLines })}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => handleOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="h-10"
              onClick={apply}
              disabled={!canApply || busy}
            >
              {t("apply")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
