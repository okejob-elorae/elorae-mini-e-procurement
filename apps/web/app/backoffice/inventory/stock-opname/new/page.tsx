"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createOpname } from "@/app/actions/stock-opname";

export default function NewStockOpnamePage() {
  const t = useTranslations("stockOpname");
  const router = useRouter();
  const [scope, setScope] = useState<"FINISHED_GOOD" | "FABRIC" | "ACCESSORIES">("FINISHED_GOOD");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const result = await createOpname({ scope, notes: notes || undefined });
      if (!result.success || !result.opnameId) {
        toast.error(result.error ?? "Failed");
        return;
      }
      toast.success("Opname created");
      router.push(`/backoffice/inventory/stock-opname/${result.opnameId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("new")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("new")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("scope")}</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["FINISHED_GOOD", "FABRIC", "ACCESSORIES"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`scopes.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : t("new")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
