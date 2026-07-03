"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { checkOut } from "../actions";
import { Button } from "@/components/ui/button";

export function CheckOutButton({ visitId }: { visitId: string }) {
  const t = useTranslations("pwa.checkIn");
  const [error, setError] = useState<string | null>(null);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const busy = fetchingLocation || pending;

  function onTap() {
    setError(null);
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setFetchingLocation(false);
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
      () => {
        setFetchingLocation(false);
        setError(t("coordsError"));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  const busyLabel = fetchingLocation ? t("locating") : t("submitting");

  return (
    <div className="space-y-2">
      <Button type="button" variant="destructive" onClick={onTap} disabled={busy} className="w-full py-3 text-lg font-medium">
        {busy ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {busyLabel}
          </>
        ) : (
          t("checkOutButton")
        )}
      </Button>
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <span>{error}</span>
          <Button type="button" variant="link" size="sm" onClick={onTap} disabled={busy}>{t("coordsRetry")}</Button>
        </div>
      )}
    </div>
  );
}
