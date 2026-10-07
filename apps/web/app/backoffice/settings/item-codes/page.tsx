"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  getVariantBarcodeFormat,
  saveVariantBarcodeFormat,
} from "@/app/actions/settings/barcode-format";
import { DEFAULT_VARIANT_BARCODE_TEMPLATE } from "@/lib/items/variant-barcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { contohBarcode, FORMAT_SIAP_PAKAI } from "./contoh-barcode";

// Tokens are literal template syntax and stay as typed; only the explanation
// beside each one is translated (itemCodes.hints.*).
const PLACEHOLDER_HINTS = [
  { token: "{categoryCode}", key: "categoryCode" },
  { token: "{parentSku}", key: "parentSku" },
  { token: "{parentSeq:6}", key: "parentSeq" },
  { token: "{attrs}", key: "attrs" },
  { token: "{attr:Size}", key: "attr" },
] as const;

export default function ItemCodesSettingsPage() {
  const t = useTranslations("itemCodes");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [template, setTemplate] = useState(DEFAULT_VARIANT_BARCODE_TEMPLATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;

    getVariantBarcodeFormat()
      .then((state) => setTemplate(state.template))
      .catch(() => toast.error(t("loadError")))
      .finally(() => setIsLoading(false));
  }, [status, router, t]);

  const contoh = contohBarcode(template);

  const handleSave = async () => {
    if (!template.trim()) return;
    setIsSaving(true);
    try {
      await saveVariantBarcodeFormat(template);
      toast.success(t("saveSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts("failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <TombolBantuan judul={t("title")} />
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("barcodeFormatTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="barcodeTemplate">{t("templateLabel")}</Label>
            <Input
              id="barcodeTemplate"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="font-mono text-sm"
              placeholder={DEFAULT_VARIANT_BARCODE_TEMPLATE}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("presetsLabel")}</span>
              {FORMAT_SIAP_PAKAI.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  variant={template.trim() === f.template ? "secondary" : "outline"}
                  onClick={() => setTemplate(f.template)}
                >
                  {t(`presets.${f.id}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("previewLabel")}</p>
            <p className="font-mono text-lg font-semibold tracking-wide">{contoh || "—"}</p>
            <p className="text-xs text-muted-foreground">{t("previewSample")}</p>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">{t("placeholdersTitle")}</p>
            <ul className="list-inside list-disc space-y-1">
              {PLACEHOLDER_HINTS.map((hint) => (
                <li key={hint.key}>
                  <code className="text-xs">{hint.token}</code>
                  {` — ${t(`hints.${hint.key}`)}`}
                </li>
              ))}
            </ul>
          </div>

          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || !template.trim()}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
