"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Archive, Coins, FolderTree, Loader2, RotateCw } from "lucide-react";
import { getSpgCommissionSettings, type SpgCommissionSettings } from "@/app/actions/settings/spg-commission";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RateRow } from "./RateRow";
import { formatYearMonth } from "./format";

export default function SpgCommissionSettingsPage() {
  const t = useTranslations("settings.spgCommission");
  const locale = useLocale();
  const { status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState<SpgCommissionSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const hasSettings = useRef(false);

  /* Never throws: a failed first load shows the error card, a failed refresh keeps the old data and toasts. */
  const load = useCallback(async () => {
    try {
      setSettings(await getSpgCommissionSettings());
      hasSettings.current = true;
      setLoadFailed(false);
    } catch {
      if (hasSettings.current) toast.error(t("loadError"));
      else setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status !== "authenticated") return;
    void load();
  }, [status, router, load]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadFailed(false);
    void load();
  };

  if (status === "loading" || isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadFailed || settings === null) {
    return (
      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <Button type="button" variant="outline" className="h-10" onClick={handleRetry}>
            <RotateCw className="h-4 w-4" />
            {t("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const currentMonthLabel = t("currentMonth", { month: formatYearMonth(settings.currentMonth, locale) });
  const active = settings.categories.filter((category) => category.isActive);
  const inactive = settings.categories.filter((category) => !category.isActive);

  return (
    <div className="space-y-6 pb-24">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 shrink-0" />
            {t("heading")}
          </CardTitle>
          <CardDescription className="space-y-1">
            <span className="block">{t("subtitle")}</span>
            <span className="block font-medium text-foreground">{currentMonthLabel}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {active.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
              <FolderTree className="h-8 w-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
              </div>
              <Button asChild variant="outline" className="h-10">
                <Link href="/backoffice/items/categories">{t("emptyCta")}</Link>
              </Button>
            </div>
          ) : (
            active.map((category) => (
              <RateRow
                key={category.id}
                category={category}
                currentMonth={settings.currentMonth}
                openMonths={settings.openMonths}
                onChanged={load}
              />
            ))
          )}
        </CardContent>
      </Card>

      {inactive.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted-foreground">
              <Archive className="h-5 w-5 shrink-0" />
              {t("inactiveHeading")}
            </CardTitle>
            <CardDescription>{t("inactiveSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {inactive.map((category) => (
              <RateRow
                key={category.id}
                category={category}
                currentMonth={settings.currentMonth}
                openMonths={settings.openMonths}
                readOnly
                onChanged={load}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
