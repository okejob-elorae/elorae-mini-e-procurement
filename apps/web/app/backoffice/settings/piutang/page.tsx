"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getOverdueThresholds, setOverdueThresholds } from "@/app/actions/settings/overdue-thresholds";
import { DEFAULT_OVERDUE_THRESHOLDS } from "@/lib/finance/ar/overdue-thresholds";
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
import { AlarmClock, Loader2 } from "lucide-react";

type ErrorCode = "EMPTY" | "INVALID";

const ERROR_MESSAGE_KEY: Record<ErrorCode, string> = {
  EMPTY: "errEmpty",
  INVALID: "errInvalid",
};

export default function OverdueThresholdsSettingsPage() {
  const t = useTranslations("settings.overdueThresholds");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    getOverdueThresholds()
      .then((thresholds) => setValue(thresholds.join(",")))
      .catch(() => toast.error(t("loadError")))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await setOverdueThresholds(value);
      if (result.ok) {
        setValue(result.thresholds.join(","));
        toast.success(tToasts("saved"));
      } else {
        setError(result.code);
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
            <AlarmClock className="h-5 w-5" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="overdue-thresholds-input">{t("fieldLabel")}</Label>
            <Input
              id="overdue-thresholds-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={DEFAULT_OVERDUE_THRESHOLDS.join(",")}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">{t("fieldHint")}</p>
          </div>

          {error && <p className="text-sm text-destructive">{t(ERROR_MESSAGE_KEY[error])}</p>}

          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
