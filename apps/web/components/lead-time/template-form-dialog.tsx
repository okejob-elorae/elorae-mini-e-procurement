"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  createProcessTemplate,
  updateProcessTemplate,
} from "@/app/actions/lead-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Template = {
  id: string;
  name: string;
  leadTimeType: "FIXED" | "PER_QTY";
  days: number;
  rateQty: number | null;
  notes: string | null;
  isApproval?: boolean;
  sopInstructions?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Template | null;
  onSaved: () => void;
};

export function TemplateFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: Props) {
  const t = useTranslations("leadTime.pustaka.form");
  const [name, setName] = useState("");
  const [leadTimeType, setLeadTimeType] = useState<"FIXED" | "PER_QTY">("FIXED");
  const [days, setDays] = useState("1");
  const [rateQty, setRateQty] = useState("");
  const [notes, setNotes] = useState("");
  const [isApproval, setIsApproval] = useState(false);
  const [sopInstructions, setSopInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setLeadTimeType(initial?.leadTimeType ?? "FIXED");
    setDays(String(initial?.days ?? 1));
    setRateQty(initial?.rateQty != null ? String(initial.rateQty) : "");
    setNotes(initial?.notes ?? "");
    setIsApproval(initial?.isApproval ?? false);
    setSopInstructions(initial?.sopInstructions ?? "");
  }, [open, initial]);

  async function onSubmit() {
    setSaving(true);
    try {
      const payload = {
        name,
        leadTimeType,
        days: Number(days),
        rateQty: leadTimeType === "PER_QTY" ? Number(rateQty) : null,
        notes: notes.trim() || null,
        isApproval,
        sopInstructions: sopInstructions.trim() || null,
      };
      const result = initial
        ? await updateProcessTemplate(initial.id, payload)
        : await createProcessTemplate(payload);
      if (!result.success) {
        toast.error(result.error ?? "Failed");
        return;
      }
      toast.success("OK");
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? t("name") : t("name")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("type")}</Label>
            <Select
              value={leadTimeType}
              onValueChange={(v) => setLeadTimeType(v as "FIXED" | "PER_QTY")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED">{t("fixed")}</SelectItem>
                <SelectItem value="PER_QTY">{t("perQty")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("daysLabel")}</Label>
            <Input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          {leadTimeType === "PER_QTY" && (
            <div className="space-y-1">
              <Label>{t("rateQtyLabel")}</Label>
              <Input
                type="number"
                min={1}
                value={rateQty}
                onChange={(e) => setRateQty(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="is-approval"
              checked={isApproval}
              onCheckedChange={setIsApproval}
            />
            <Label htmlFor="is-approval">{t("isApproval")}</Label>
          </div>
          <div className="space-y-1">
            <Label>{t("sopInstructions")}</Label>
            <Textarea
              value={sopInstructions}
              onChange={(e) => setSopInstructions(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={saving}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
