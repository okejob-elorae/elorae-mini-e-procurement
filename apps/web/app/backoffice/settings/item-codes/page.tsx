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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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

  const handleSave = async () => {
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t("barcodeFormatTitle")}</CardTitle>
          <CardDescription>{t("barcodeFormatDescription")}</CardDescription>
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
            <p className="mt-3 text-xs">
              {t("exampleHintPrefix")}{" "}
              <code className="text-xs">{DEFAULT_VARIANT_BARCODE_TEMPLATE}</code>{" "}
              {t("exampleHintSuffix")}
            </p>
          </div>

          <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
