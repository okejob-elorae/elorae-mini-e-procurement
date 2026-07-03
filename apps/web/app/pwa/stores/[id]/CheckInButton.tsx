"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { checkIn } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

type PermState = "prompt" | "granted" | "denied" | "unknown";

type Props = {
  storeId: string;
  autoCloseStoreName: string | null;
};

export function CheckInButton({ storeId, autoCloseStoreName }: Props) {
  const t = useTranslations("pwa.checkIn");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = fetchingLocation || pending;

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) {
      setPerm("prompt");
      return;
    }
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      status => {
        setPerm(status.state as PermState);
        status.onchange = () => setPerm(status.state as PermState);
      },
      () => setPerm("prompt"),
    );
  }, []);

  function onTap() {
    setError(null);
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setFetchingLocation(false);
        startTransition(async () => {
          const result = await checkIn({ storeId, lat: pos.coords.latitude, lng: pos.coords.longitude });
          if (result && !result.ok) {
            if (result.code === "NOT_FOUND") setError(t("storeInactive"));
            return;
          }
        });
      },
      () => {
        setFetchingLocation(false);
        setError(t("coordsError"));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  if (perm === "denied") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("permissionDenied")}</AlertDescription>
      </Alert>
    );
  }

  const label = autoCloseStoreName
    ? t("buttonAutoClose", { storeName: autoCloseStoreName })
    : t("button");
  const busyLabel = fetchingLocation ? t("locating") : t("submitting");

  return (
    <div className="space-y-2">
      <Button type="button" onClick={onTap} disabled={busy} className="w-full py-3 text-lg font-medium">
        {busy ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {busyLabel}
          </>
        ) : (
          label
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
