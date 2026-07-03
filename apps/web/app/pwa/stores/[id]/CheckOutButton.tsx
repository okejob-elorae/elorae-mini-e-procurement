"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { checkOut } from "../actions";
import { Button } from "@/components/ui/button";

export function CheckOutButton({ visitId }: { visitId: string }) {
  const t = useTranslations("pwa.checkIn");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onTap() {
    setError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        startTransition(async () => {
          const result = await checkOut({ visitId, lat: pos.coords.latitude, lng: pos.coords.longitude });
          if ("ok" in result && !result.ok) {
            setError(t("coordsError"));
            return;
          }
          router.push("/pwa");
          router.refresh();
        });
      },
      () => setError(t("coordsError")),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="destructive" onClick={onTap} disabled={pending} className="w-full py-3 text-lg font-medium">
        {t("checkOutButton")}
      </Button>
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <span>{error}</span>
          <Button type="button" variant="link" size="sm" onClick={onTap}>{t("coordsRetry")}</Button>
        </div>
      )}
    </div>
  );
}
