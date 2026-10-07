"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatDisplayDateTime } from "@/lib/date-only";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExternalLink, Loader2, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { usePesanGalatJubelio } from "../RincianGalat";
import {
  enqueueBulkMigration,
  type EligibleItem,
  type MigrationSummary,
} from "@/app/actions/jubelio-bulk-migration";

type Props = {
  initialItems: EligibleItem[];
  initialSummary: MigrationSummary;
};

export function MigrationClient({ initialItems, initialSummary }: Props) {
  const t = useTranslations("jubelio.migration");
  const pesanGalat = usePesanGalatJubelio();
  const locale = useLocale();
  const [items, setItems] = useState<EligibleItem[]>(initialItems);
  const [summary] = useState<MigrationSummary>(initialSummary);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Barang tanpa pemetaan kategori pasti dilewati Jubelio, jadi tidak bisa dicentang.
  const siap = items.filter((it) => it.hasJubelioCategoryMapping);

  const toggleAll = () => {
    if (selected.size === siap.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(siap.map((it) => it.id)));
    }
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const ids = Array.from(selected);
      const r = await enqueueBulkMigration(ids);
      setConfirmOpen(false);
      if (!r.ok) {
        toast.error(pesanGalat(r));
        return;
      }
      toast.success(t("queued", { count: r.data.enqueued }));
      setItems((prev) => prev.filter((it) => !selected.has(it.id)));
      setSelected(new Set());
    });
  };

  const allSelected = siap.length > 0 && selected.size === siap.length;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryStat label={t("done")} value={summary.done} />
        <SummaryStat label={t("pending")} value={summary.pending} />
        <SummaryStat label={t("processing")} value={summary.processing} />
        <SummaryStat label={t("skipped")} value={summary.skipped} />
        <SummaryStat label={t("dead")} value={summary.dead} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{t("eligibleTitle")}</CardTitle>
              <CardDescription>{t("candidates", { count: items.length })}</CardDescription>
            </div>
            <Button
              disabled={selected.size === 0 || isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              {t("migrateSelected", { count: selected.size })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        disabled={siap.length === 0}
                        aria-label={t("selectAll")}
                      />
                    </TableHead>
                    <TableHead>{t("colSku")}</TableHead>
                    <TableHead>{t("colName")}</TableHead>
                    <TableHead>{t("colCategory")}</TableHead>
                    <TableHead className="text-right">{t("colVariants")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(it.id)}
                          onCheckedChange={() => toggle(it.id)}
                          disabled={!it.hasJubelioCategoryMapping}
                          aria-label={t("selectOne", { sku: it.sku })}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                      <TableCell className="min-w-[200px] max-w-[360px] whitespace-normal">
                        {locale.startsWith("en") ? it.nameEn || it.nameId : it.nameId || it.nameEn}
                      </TableCell>
                      <TableCell className="min-w-[140px] whitespace-normal text-sm text-muted-foreground">
                        {it.categoryName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{it.variantCount}</TableCell>
                      <TableCell>
                        {it.hasJubelioCategoryMapping ? (
                          <Badge variant="default">{t("ready")}</Badge>
                        ) : !it.categoryId ? (
                          <Link
                            href={`/backoffice/items/${it.id}`}
                            className="text-sm text-tautan underline underline-offset-2"
                          >
                            {t("noCategory")}
                          </Link>
                        ) : (
                          <Link
                            href="/backoffice/jubelio/categories"
                            className="text-sm text-tautan underline underline-offset-2"
                            title={t("unmappedHint")}
                          >
                            {t("unmapped")}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
          <span>
            {t("window", {
              when: formatDisplayDateTime(summary.windowStart, locale),
              total: summary.total,
            })}
          </span>
          <Link href="/backoffice/jubelio/admin" className="inline-flex items-center gap-1 underline">
            {t("openOutbox")}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle", { count: selected.size })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("confirmBody", {
                categories: (chunks) => (
                  <Link href="/backoffice/jubelio/categories" className="underline">
                    {chunks}
                  </Link>
                ),
                settings: (chunks) => (
                  <Link href="/backoffice/jubelio/settings" className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
