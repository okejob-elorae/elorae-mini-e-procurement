"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getPackRatio, setPackRatio } from "@/app/actions/settings/pack-ratio";
import type { PackRatioRow } from "@elorae/db/pack-ratio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Layers, Loader2, Plus, Trash2 } from "lucide-react";

type ValidationCode = "EMPTY" | "BAD_SIZE" | "DUP_SIZE" | "BAD_QTY";

const ERROR_MESSAGE_KEY: Record<ValidationCode, string> = {
  EMPTY: "errEmpty",
  BAD_SIZE: "errBadSize",
  DUP_SIZE: "errDupSize",
  BAD_QTY: "errBadQty",
};

function validateRows(rows: PackRatioRow[]): ValidationCode | null {
  if (rows.length === 0) return "EMPTY";
  const seen = new Set<string>();
  for (const row of rows) {
    const size = row.size.trim();
    if (size === "") return "BAD_SIZE";
    const key = size.toLowerCase();
    if (seen.has(key)) return "DUP_SIZE";
    seen.add(key);
    if (!Number.isInteger(row.qty) || row.qty <= 0) return "BAD_QTY";
  }
  return null;
}

export default function PackRatioSettingsPage() {
  const t = useTranslations("settings.packRatio");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<PackRatioRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    getPackRatio()
      .then(setRows)
      .catch(() => toast.error(t("loadError")))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const error = validateRows(rows);

  const handleAddSize = () => {
    setRows((prev) => [...prev, { size: "", qty: 1 }]);
  };

  const handleRemoveRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSizeChange = (index: number, size: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, size } : row)));
  };

  const handleQtyChange = (index: number, value: string) => {
    const parsed = Number.parseInt(value, 10);
    const qty = value === "" || Number.isNaN(parsed) ? 0 : parsed;
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, qty } : row)));
  };

  const handleSave = async () => {
    if (error) {
      toast.error(t(ERROR_MESSAGE_KEY[error]));
      return;
    }
    setSaving(true);
    try {
      const result = await setPackRatio(rows);
      if (result.ok) {
        toast.success(tToasts("saved"));
      } else {
        toast.error(t(ERROR_MESSAGE_KEY[result.code]));
      }
    } catch {
      toast.error(tToasts("failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span className="flex-1">{t("sizeLabel")}</span>
                <span className="w-20 shrink-0">{t("qtyLabel")}</span>
                <span className="w-10 shrink-0" aria-hidden="true" />
              </div>
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={t("sizeLabel")}
                    value={row.size}
                    onChange={(e) => handleSizeChange(index, e.target.value)}
                    placeholder={t("sizeLabel")}
                    className="flex-1 min-w-0"
                  />
                  <Input
                    type="number"
                    min={1}
                    aria-label={t("qtyLabel")}
                    value={row.qty === 0 ? "" : row.qty}
                    onChange={(e) => handleQtyChange(index, e.target.value)}
                    className="w-20 shrink-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("remove")}
                    onClick={() => handleRemoveRow(index)}
                    disabled={saving}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{t(ERROR_MESSAGE_KEY[error])}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleAddSize} disabled={saving}>
              <Plus className="h-4 w-4 mr-2" />
              {t("addSize")}
            </Button>
            <Button onClick={handleSave} disabled={saving || error !== null}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
