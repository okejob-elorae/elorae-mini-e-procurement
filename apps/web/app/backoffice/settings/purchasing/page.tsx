"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { getPaymentReminderDays, setPaymentReminderDays } from "@/app/actions/settings/payment-reminders";
import {
  DEFAULT_PAYMENT_REMINDER_DAYS,
  type PaymentReminderDaysErrorCode,
} from "@/lib/purchase-orders/payment-reminder-thresholds";
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

const ERROR_MESSAGE_KEY: Record<PaymentReminderDaysErrorCode, "errEmpty" | "errInvalid" | "errOutOfRange"> = {
  EMPTY: "errEmpty",
  INVALID: "errInvalid",
  OUT_OF_RANGE: "errOutOfRange",
};

export default function PaymentRemindersSettingsPage() {
  const t = useTranslations("settings.paymentReminders");
  const tToasts = useTranslations("toasts");
  const { status } = useSession();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<PaymentReminderDaysErrorCode | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;
    getPaymentReminderDays()
      .then((days) => setValue(days.join(",")))
      .catch(() => toast.error(t("loadError")))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t from useTranslations
  }, [status, router]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await setPaymentReminderDays(value);
      if (result.ok) {
        setValue(result.days.join(","));
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
            <BellRing className="h-5 w-5" />
            {t("heading")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="payment-reminder-days-input">{t("fieldLabel")}</Label>
              <Input
                id="payment-reminder-days-input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                placeholder={DEFAULT_PAYMENT_REMINDER_DAYS.join(",")}
                disabled={saving}
                aria-invalid={error !== null}
                className={error ? "border-destructive focus-visible:ring-destructive/20" : ""}
              />
              <p className="text-xs text-muted-foreground">{t("fieldHint")}</p>
            </div>

            {error && <p className="text-sm text-destructive">{t(ERROR_MESSAGE_KEY[error])}</p>}

            <Button type="submit" disabled={saving} className="min-h-10">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
