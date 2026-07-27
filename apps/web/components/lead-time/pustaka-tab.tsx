"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deactivateProcessTemplate,
  getProcessTemplates,
} from "@/app/actions/lead-time";
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
  const [rows, setRows] = useState<Template[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getProcessTemplates(showArchived);
      setRows(data as Template[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
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

  async function onDeactivate(row: Template) {
    if (!confirm(t("deactivateConfirm", { name: row.name }))) return;
    const result = await deactivateProcessTemplate(row.id);
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    toast.success("OK");
    void load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t("process")}</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 w-56"
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-archived"
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
              {t("add")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
          {t("banner")} {t("bannerApproval")}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>{t("process")}</TableHead>
              <TableHead>{t("leadTime")}</TableHead>
              <TableHead>{t("equalsDays")}</TableHead>
              {canManage && <TableHead className="w-28">{t("actions")}</TableHead>}
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
                  —
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
                        {t("perQty")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.leadTimeType === "PER_QTY"
                      ? t("perQtyValue", {
                          days: row.days,
                          rateQty: row.rateQty ?? 0,
                        })
                      : t("days", { days: row.days })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.leadTimeType === "PER_QTY"
                      ? t("asQty")
                      : t("days", { days: row.days })}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
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
                            onClick={() => void onDeactivate(row)}
                          >
                            <Trash2 className="h-4 w-4" />
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
    </Card>
  );
}
