"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDisplayDate } from "@/lib/date-only";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createChainTemplate,
  deactivateChainTemplate,
  getChainTemplates,
  getProcessTemplates,
  updateChainTemplate,
} from "@/app/actions/lead-time";
import { HantuSeret } from "@/components/gerak/HantuSeret";
import { ATRIBUT_BUTIR, atributDaftar, garisSisipDi, useSeretUrut } from "@/components/gerak/useSeretUrut";
import { celahDiam, indeksTujuan, pindahkan } from "@/lib/gerak/seret-urut";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

type ProcessOption = {
  id: string;
  name: string;
  leadTimeType: "FIXED" | "PER_QTY";
  days: number;
  rateQty: number | null;
  isApproval: boolean;
  isActive: boolean;
};

type ChainRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: Date | string;
  steps: Array<{
    seq: number;
    name: string;
    type: "FIXED" | "PER_QTY";
    days: number;
    rateQty: number | null;
    isApproval: boolean;
    isActive: boolean;
    processTemplateId: string;
    notes: string | null;
  }>;
  totalDaysFixedOnly: number;
  hasArchivedSteps: boolean;
};

/** `kunci` = identitas baris di formulir (bukan id basis data) supaya seret-lepas tidak mencampur baris. */
type StepDraft = { kunci: string; processTemplateId: string; notes: string | null };

let urutKunci = 0;
const kunciBaru = () => `langkah-${++urutKunci}`;

/** `data-seret-daftar` daftar langkah di dialog SOP. */
const DAFTAR_SOP = "sop-langkah";

type Props = { canManage: boolean };

export function SopTab({ canManage }: Props) {
  const t = useTranslations("leadTime.sop");
  const tp = useTranslations("leadTime.pustaka");
  const tc = useTranslations("leadTime.common");
  const locale = useLocale();
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChainRow | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSteps, setFormSteps] = useState<StepDraft[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [chains, tmpls] = await Promise.all([
        getChainTemplates(showInactive),
        getProcessTemplates(false),
      ]);
      setRows(chains as ChainRow[]);
      setProcesses(
        tmpls.map((x) => ({
          id: x.id,
          name: x.name,
          leadTimeType: x.leadTimeType,
          days: x.days,
          rateQty: x.rateQty,
          isApproval: x.isApproval,
          isActive: x.isActive,
        }))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [showInactive]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setFormSteps([{ kunci: kunciBaru(), processTemplateId: "", notes: null }]);
    setDialogOpen(true);
  }

  function openEdit(row: ChainRow) {
    setEditing(row);
    setFormName(row.name);
    setFormDescription(row.description ?? "");
    setFormSteps(
      row.steps.map((s) => ({
        kunci: kunciBaru(),
        processTemplateId: s.processTemplateId,
        notes: s.notes,
      }))
    );
    setDialogOpen(true);
  }

  function moveStep(index: number, dir: -1 | 1) {
    setFormSteps((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
  }

  // Seret-lepas urutan langkah di dialog; panah ↑/↓ tetap jalan papan ketik.
  const seret = useSeretUrut<string>({
    bolehLepas: (_, daftar) => daftar === DAFTAR_SOP,
    onLepas: (kunci, { celah }) =>
      setFormSteps((prev) => {
        const dari = prev.findIndex((s) => s.kunci === kunci);
        if (dari < 0 || celahDiam(dari, celah)) return prev;
        return pindahkan(prev, dari, indeksTujuan(dari, celah));
      }),
  });
  const dariSeret = seret.sesi ? formSteps.findIndex((s) => s.kunci === seret.sesi?.data) : -1;
  const langkahSeret = dariSeret >= 0 ? formSteps[dariSeret] : null;
  const celahSeret = seret.sesi?.sasaran?.celah ?? null;
  const garisSisip = (i: number) =>
    garisSisipDi(seret.sesi, DAFTAR_SOP, i, dariSeret >= 0 ? dariSeret : null) ? (
      <div aria-hidden className="mb-2 h-0.5 rounded-full bg-primary" />
    ) : null;

  async function onSave() {
    const steps = formSteps.filter((s) => s.processTemplateId);
    if (!formName.trim() || steps.length === 0) {
      toast.error(t("form.nameAndStepRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        description: formDescription.trim() || null,
        steps: steps.map((s) => ({
          processTemplateId: s.processTemplateId,
          notes: s.notes,
        })),
      };
      const result = editing
        ? await updateChainTemplate(editing.id, payload)
        : await createChainTemplate(payload);
      if (!result.success) {
        toast.error(result.error ?? tc("failed"));
        return;
      }
      toast.success(tc("saved"));
      setDialogOpen(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate(row: ChainRow) {
    if (!confirm(t("deactivateConfirm", { name: row.name }))) return;
    const result = await deactivateChainTemplate(row.id);
    if (!result.success) {
      toast.error(result.error ?? tc("failed"));
      return;
    }
    toast.success(tc("saved"));
    void load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t("title")}</CardTitle>
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
              id="show-inactive-sop"
              aria-label={t("showInactive")}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor="show-inactive-sop">{t("showInactive")}</Label>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              {t("add")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colSteps")}</TableHead>
              <TableHead>{t("colDays")}</TableHead>
              <TableHead>{t("colUpdated")}</TableHead>
              {canManage && <TableHead className="w-28">{t("actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  …
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const open = expandedId === row.id;
                const updated = formatDisplayDate(row.updatedAt, locale);
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className={!row.isActive ? "opacity-50" : undefined}
                    >
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={t("toggleSteps", { name: row.name })}
                          aria-expanded={open}
                          onClick={() =>
                            setExpandedId(open ? null : row.id)
                          }
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{row.name}</span>
                        {!row.isActive && (
                          <Badge variant="outline" className="ml-2">
                            {t("inactive")}
                          </Badge>
                        )}
                        {row.hasArchivedSteps && (
                          <Badge variant="outline" className="ml-2 text-amber-700">
                            {t("hasArchived")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{t("steps", { n: row.steps.length })}</TableCell>
                      <TableCell>
                        {t("totalDays", { days: row.totalDaysFixedOnly })}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t("updatedAt", { date: updated })}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t("editAria", { name: row.name })}
                              title={t("editAria", { name: row.name })}
                              onClick={() => openEdit(row)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {row.isActive && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t("deactivateAria", { name: row.name })}
                                title={t("deactivateAria", { name: row.name })}
                                onClick={() => void onDeactivate(row)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                    {open && (
                      <TableRow>
                        <TableCell colSpan={canManage ? 6 : 5}>
                          <ol className="space-y-1 text-sm pl-4 list-decimal">
                            {row.steps.map((s) => (
                              <li key={`${row.id}-${s.seq}`}>
                                {s.name}
                                {s.isApproval ? " ✋" : ""}
                                <span className="text-muted-foreground ml-2">
                                  {s.type === "PER_QTY"
                                    ? tp("perQtyValue", {
                                        days: s.days,
                                        rateQty: s.rateQty ?? 0,
                                      })
                                    : tp("days", { days: s.days })}
                                  {!s.isActive ? ` ${tc("archivedSuffix")}` : ""}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("form.editTitle") : t("form.createTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t("form.name")}</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("form.description")}</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("form.steps")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setFormSteps((prev) => [
                      ...prev,
                      { kunci: kunciBaru(), processTemplateId: "", notes: null },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("form.addStep")}
                </Button>
              </div>
              <div {...atributDaftar(DAFTAR_SOP)}>
              {formSteps.map((step, index) => (
                <div key={step.kunci}>
                {garisSisip(index)}
                <div
                  {...ATRIBUT_BUTIR}
                  className={cn(
                    "mb-2 flex items-center gap-2 rounded-md",
                    seret.sesi?.data === step.kunci &&
                      "bg-primary/10 shadow-md ring-1 ring-primary/40 motion-safe:scale-[1.01] motion-safe:transition-transform",
                  )}
                >
                  <span
                    {...seret.pegangan(step.kunci)}
                    aria-hidden
                    title={t("form.seretLangkah")}
                    className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <Select
                    value={step.processTemplateId || undefined}
                    onValueChange={(v) =>
                      setFormSteps((prev) =>
                        prev.map((s, i) =>
                          i === index ? { ...s, processTemplateId: v } : s
                        )
                      )
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t("form.pickProcess")} />
                    </SelectTrigger>
                    <SelectContent>
                      {processes.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.isApproval ? " ✋" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={index === 0}
                    aria-label={t("form.moveStepUp")}
                    title={t("form.moveStepUp")}
                    onClick={() => moveStep(index, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={index === formSteps.length - 1}
                    aria-label={t("form.moveStepDown")}
                    title={t("form.moveStepDown")}
                    onClick={() => moveStep(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={t("form.removeStep")}
                    title={t("form.removeStep")}
                    onClick={() =>
                      setFormSteps((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </Button>
                </div>
                {index === formSteps.length - 1 ? garisSisip(formSteps.length) : null}
                </div>
              ))}
              </div>
              <HantuSeret
                sesi={seret.sesi}
                label={
                  processes.find((p) => p.id === langkahSeret?.processTemplateId)?.name ??
                  t("form.pickProcess")
                }
                keterangan={
                  dariSeret >= 0 && celahSeret !== null
                    ? celahDiam(dariSeret, celahSeret)
                      ? t("form.seretTetap")
                      : t("form.seretPosisi", {
                          posisi: indeksTujuan(dariSeret, celahSeret) + 1,
                          jumlah: formSteps.length,
                        })
                    : null
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button onClick={() => void onSave()} disabled={saving}>
              {t("form.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
