"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateSupplierProcessStep } from "@/app/actions/lead-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

type Step = {
  id: string;
  overrideDays: number | null;
  overrideRateQty: number | null;
  notes: string | null;
  processTemplate: {
    leadTimeType: "FIXED" | "PER_QTY";
    days: number;
    rateQty: number | null;
  };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: Step;
  onSaved: () => void;
  trigger: React.ReactNode;
};

export function StepOverridePopover({
  open,
  onOpenChange,
  step,
  onSaved,
  trigger,
}: Props) {
  const t = useTranslations("leadTime.papan");
  const [overrideDays, setOverrideDays] = useState("");
  const [overrideRateQty, setOverrideRateQty] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setOverrideDays(step.overrideDays != null ? String(step.overrideDays) : "");
    setOverrideRateQty(
      step.overrideRateQty != null ? String(step.overrideRateQty) : ""
    );
    setNotes(step.notes ?? "");
  }, [open, step]);

  async function save(clear = false) {
    const result = await updateSupplierProcessStep(step.id, {
      overrideDays: clear || overrideDays === "" ? null : Number(overrideDays),
      overrideRateQty:
        clear || overrideRateQty === "" ? null : Number(overrideRateQty),
      notes: clear ? null : notes.trim() || null,
    });
    if (!result.success) {
      toast.error(result.error ?? "Failed");
      return;
    }
    toast.success("OK");
    onOpenChange(false);
    onSaved();
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" align="end">
        <div className="space-y-1">
          <Label>{t("overrideDays")}</Label>
          <Input
            type="number"
            min={1}
            placeholder={String(step.processTemplate.days)}
            value={overrideDays}
            onChange={(e) => setOverrideDays(e.target.value)}
          />
        </div>
        {step.processTemplate.leadTimeType === "PER_QTY" && (
          <div className="space-y-1">
            <Label>{t("overrideRateQty")}</Label>
            <Input
              type="number"
              min={1}
              placeholder={String(step.processTemplate.rateQty ?? "")}
              value={overrideRateQty}
              onChange={(e) => setOverrideRateQty(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void save(true)}>
            {t("resetDefault")}
          </Button>
          <Button size="sm" onClick={() => void save(false)}>
            {t("save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
