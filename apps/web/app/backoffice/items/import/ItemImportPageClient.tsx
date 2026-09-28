"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { commitItemImport, previewItemImport } from "@/app/actions/item-import";
import {
  ITEM_IMPORT_MAX_BYTES,
  ITEM_IMPORT_MAX_ROWS,
  importError,
  type ItemImportCommitResult,
  type ItemImportError,
  type ItemImportRow,
  type ItemImportValidatedResult,
} from "@/lib/items/import/types";
import { ImportErrorTable, ImportPreviewList, useImportErrorMessage } from "./ItemImportPreview";

type CreatedResult = Extract<ItemImportCommitResult, { status: "created" }>;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "fileError"; fileName: string; errors: ItemImportError[] }
  | { kind: "preview"; fileName: string; rows: ItemImportRow[]; result: ItemImportValidatedResult }
  | { kind: "committing"; fileName: string; rows: ItemImportRow[]; result: ItemImportValidatedResult }
  | { kind: "done"; result: CreatedResult };

const MAX_MB = ITEM_IMPORT_MAX_BYTES / (1024 * 1024);

/**
 * Jubelio skips any item with no Kategori (or one not mapped to a Jubelio category). Counts
 * artikels, grouped case-insensitively, whose FIRST row in the file has a blank Kategori — this
 * mirrors how the parser folds variant rows into one product without touching validate.ts.
 */
function countJubelioNoCategoryArtikels(rows: ItemImportRow[]): number {
  const seen = new Map<string, boolean>();
  for (const row of rows) {
    const key = row.artikel.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, row.kategori === "");
    }
  }
  let count = 0;
  for (const noCategory of seen.values()) {
    if (noCategory) count += 1;
  }
  return count;
}

export function ItemImportPageClient() {
  const t = useTranslations("itemImport");
  const errorMessage = useImportErrorMessage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pushToJubelio, setPushToJubelio] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const busy = phase.kind === "reading" || phase.kind === "committing";

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const { buildItemImportTemplate } = await import("@/lib/items/import/workbook");
      const blob = new Blob([buildItemImportTemplate()], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "template-import-produk.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("commitFailed"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    const fileName = file.name;
    if (!fileName.toLowerCase().endsWith(".xlsx")) {
      setPhase({ kind: "fileError", fileName, errors: [importError("NOT_XLSX")] });
      return;
    }
    if (file.size > ITEM_IMPORT_MAX_BYTES) {
      setPhase({ kind: "fileError", fileName, errors: [importError("FILE_TOO_LARGE", { detail: String(MAX_MB) })] });
      return;
    }
    setPhase({ kind: "reading", fileName });
    try {
      const { parseItemImportWorkbook } = await import("@/lib/items/import/workbook");
      const parsed = parseItemImportWorkbook(await file.arrayBuffer());
      if (parsed.errors.length > 0) {
        setPhase({ kind: "fileError", fileName, errors: parsed.errors });
        return;
      }
      const result = await previewItemImport(parsed.rows);
      if (result.status === "forbidden") {
        toast.error(t("forbidden"));
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "preview", fileName, rows: parsed.rows, result });
    } catch {
      setPhase({ kind: "fileError", fileName, errors: [importError("UNREADABLE_FILE")] });
    }
  }

  async function commit() {
    if (phase.kind !== "preview") return;
    const { fileName, rows, result } = phase;
    setPhase({ kind: "committing", fileName, rows, result });
    try {
      const r = await commitItemImport(rows, { pushToJubelio });
      if (r.status === "created") {
        setPhase({ kind: "done", result: r });
      } else if (r.status === "invalid") {
        setPhase({ kind: "preview", fileName, rows, result: r });
      } else if (r.status === "forbidden") {
        toast.error(t("forbidden"));
        setPhase({ kind: "preview", fileName, rows, result });
      } else {
        toast.error(t("commitFailed"));
        setPhase({ kind: "preview", fileName, rows, result });
      }
    } catch {
      toast.error(t("commitFailed"));
      setPhase({ kind: "preview", fileName, rows, result });
    }
  }

  function reset() {
    setPhase({ kind: "idle" });
    setPushToJubelio(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  if (phase.kind === "done") {
    const { result } = phase;
    const jubelioLine = !result.jubelioRequested
      ? t("doneJubelioSkipped")
      : result.jubelioFailed > 0
        ? t("doneJubelioPartial", { failed: result.jubelioFailed })
        : t("doneJubelioQueued");
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {t("doneTitle", { count: result.items.length, variants: result.variantCount })}
            </div>
            <p className="text-sm text-muted-foreground">{jubelioLine}</p>
            <ul className="divide-y rounded-md border">
              {result.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/backoffice/items/${item.id}`}
                    className="flex min-h-10 items-center gap-3 px-3 py-2 hover:bg-muted/50"
                  >
                    <span className="font-mono text-sm">{item.sku}</span>
                    <span className="min-w-0 truncate text-sm">{item.nameId}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Button onClick={reset}>{t("importAnother")}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = phase.kind === "preview" || phase.kind === "committing" ? phase.rows : null;
  const validated = phase.kind === "preview" || phase.kind === "committing" ? phase.result : null;
  const errorCount = validated?.errors.length ?? 0;
  const jubelioNoCategoryCount = rows ? countJubelioNoCategoryArtikels(rows) : 0;

  return (
    <div className="space-y-6 pb-28">
      <PageHeader />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("step1Title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("step1Body")}</p>
          <Button variant="outline" onClick={() => void downloadTemplate()} disabled={downloading}>
            {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {t("downloadTemplate")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("step2Title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
          >
            {phase.kind === "reading" ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm">{t("reading", { file: phase.fileName })}</p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm">
                  {phase.kind === "idle" ? t("dropHint") : phase.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("limits", { rows: ITEM_IMPORT_MAX_ROWS, mb: MAX_MB })}
                </p>
                <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Upload className="mr-2 h-4 w-4" />
                  {phase.kind === "idle" ? t("chooseFile") : t("chooseAnother")}
                </Button>
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          {phase.kind === "fileError" ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <p className="mb-2 font-medium text-destructive">{t("fileErrorTitle")}</p>
              <ul className="list-disc space-y-1 pl-5">
                {phase.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>{errorMessage(e)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {validated ? (
        <>
          <p className="text-sm font-medium">
            {t("summary", { artikel: validated.artikelCount, variants: validated.variantCount })}
          </p>
          {errorCount > 0 ? (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base text-destructive">{t("errorsTitle", { count: errorCount })}</CardTitle>
              </CardHeader>
              <CardContent>
                <ImportErrorTable errors={validated.errors} />
              </CardContent>
            </Card>
          ) : null}
          {validated.preview.length > 0 ? <ImportPreviewList items={validated.preview} /> : null}

          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 py-3 pl-3 pr-28 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:pr-0 lg:backdrop-blur-none">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {errorCount > 0 ? (
                <p className="text-sm text-destructive">{t("fixAndReupload", { count: errorCount })}</p>
              ) : (
                <label className="flex min-h-10 cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    checked={pushToJubelio}
                    onCheckedChange={(v) => setPushToJubelio(v === true)}
                    disabled={busy}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{t("jubelioLabel")}</span>
                    <span className="block text-xs text-muted-foreground">{t("jubelioHint")}</span>
                    {pushToJubelio && jubelioNoCategoryCount > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("jubelioNoCategory", { count: jubelioNoCategoryCount })}
                      </span>
                    ) : null}
                  </span>
                </label>
              )}
              <Button
                className="h-10 shrink-0"
                onClick={() => void commit()}
                disabled={busy || errorCount > 0}
              >
                {phase.kind === "committing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {phase.kind === "committing" ? t("committing") : t("commit", { count: validated.artikelCount })}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function PageHeader() {
  const t = useTranslations("itemImport");
  return (
    <div className="flex items-center gap-4">
      <Link href="/backoffice/items">
        <Button variant="ghost" size="icon" aria-label={t("back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
    </div>
  );
}
