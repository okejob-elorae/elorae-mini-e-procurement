"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Archive, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  deactivateProcessTemplate,
  getProcessTemplates,
} from "@/app/actions/lead-time";
import { formatAngka } from "@/app/backoffice/lead-time/papan-aturan";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TemplateFormDialog } from "./template-form-dialog";

type Template = {
  id: string;
  name: string;
  leadTimeType: "FIXED" | "PER_QTY";
  days: number;
  rateQty: number | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
  isApproval?: boolean;
  sopInstructions?: string | null;
};

type Props = { canManage: boolean };

export function PustakaTab({ canManage }: Props) {
  const t = useTranslations("leadTime.pustaka");
  const tc = useTranslations("leadTime.common");
  const locale = useLocale();
  const [rows, setRows] = useState<Template[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [nonaktifkan, setNonaktifkan] = useState<Template | null>(null);
  const [sibuk, mulai] = useTransition();

  async function load() {
    setLoading(true);
    try {
      const data = await getProcessTemplates(showArchived);
      setRows(data as Template[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [showArchived]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const lamaProses = (row: Pick<Template, "leadTimeType" | "days" | "rateQty">) =>
    row.leadTimeType === "PER_QTY"
      ? t("perQtyValue", { days: formatAngka(row.days, locale), rateQty: formatAngka(row.rateQty ?? 0, locale) })
      : t("days", { days: formatAngka(row.days, locale) });

  const onDeactivate = (row: Template) =>
    mulai(async () => {
      const result = await deactivateProcessTemplate(row.id).catch(() => ({ success: false, error: undefined }));
      if (!result.success) {
        toast.error(result.error ?? tc("failed"));
        return;
      }
      toast.success(tc("saved"));
      setNonaktifkan(null);
      void load();
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t("process")}</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 w-56"
              placeholder={t("searchV2")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-archived"
              aria-label={t("showArchived")}
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="show-archived">{t("showArchived")}</Label>
          </div>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("addV2")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>{t("process")}</TableHead>
              <TableHead>{t("leadTimeV2")}</TableHead>
              <TableHead>{t("equalsDaysV2")}</TableHead>
              {canManage && <TableHead className="w-28">{t("actionsV2")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  …
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {rows.length === 0 ? t("kosong") : t("tidakCocok")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, idx) => (
                <TableRow
                  key={row.id}
                  className={!row.isActive ? "opacity-50" : undefined}
                >
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    {row.isApproval && (
                      <Badge variant="outline" className="ml-2" title={t("isApproval")}>
                        ✋
                      </Badge>
                    )}
                    {row.leadTimeType === "PER_QTY" && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-amber-500 text-amber-700"
                      >
                        {t("perQtyV2")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{lamaProses(row)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.leadTimeType === "PER_QTY" ? t("asQtyV2") : lamaProses(row)}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("editAria", { name: row.name })}
                          title={t("editAria", { name: row.name })}
                          onClick={() => {
                            setEditing(row);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {row.isActive && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t("deactivateAria", { name: row.name })}
                            title={t("deactivateAria", { name: row.name })}
                            onClick={() => setNonaktifkan(row)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSaved={() => void load()}
      />

      <AlertDialog open={nonaktifkan !== null} onOpenChange={(buka) => !buka && !sibuk && setNonaktifkan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deactivateConfirm", { name: nonaktifkan?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deactivateIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("form.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                if (nonaktifkan) onDeactivate(nonaktifkan);
              }}
            >
              <Archive className="h-4 w-4" aria-hidden />
              {sibuk ? tc("menyimpan") : t("deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
