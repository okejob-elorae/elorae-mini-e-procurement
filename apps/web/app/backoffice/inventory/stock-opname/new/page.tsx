"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { kunciGalatOpname } from "@/lib/inventory/galat-opname";
import { Button } from "@/components/ui/button";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
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
        toast.error(t(kunciGalatOpname(result.code)));
        return;
      }
      toast.success(t("createdToast"));
      router.push(`/backoffice/inventory/stock-opname/${result.opnameId}`);
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory/stock-opname" aria-label={t("backToList")} title={t("backToList")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{t("judulBaru")}</h1>
        <TombolBantuan judul={t("judulBaru")} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("cakupanDanCatatan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="opname-cakupan">{t("scope")}</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger id="opname-cakupan">
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
            <Label htmlFor="opname-catatan">{t("notes")}</Label>
            <Textarea id="opname-catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          {/* Apa yang terjadi saat menekan tombol: angka sistem dibekukan sebagai pembanding. */}
          <p className="text-sm text-muted-foreground">{t("penjelasanBuat")}</p>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? t("creating") : t("tombolBuat")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
