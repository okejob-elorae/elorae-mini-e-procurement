"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { checkIn } from "../actions";

type PermState = "prompt" | "granted" | "denied" | "unknown";

type Props = {
  storeId: string;
  autoCloseStoreName: string | null;
};

export function CheckInButton({ storeId, autoCloseStoreName }: Props) {
  const t = useTranslations("pwa.checkIn");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    navigator.geolocation.getCurrentPosition(
      pos => {
        startTransition(async () => {
          const result = await checkIn({ storeId, lat: pos.coords.latitude, lng: pos.coords.longitude });
          if (result && !result.ok) {
            if (result.code === "NOT_FOUND") setError(t("storeInactive"));
            return;
          }
        });
      },
      () => setError(t("coordsError")),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  if (perm === "denied") {
    return <div className="rounded border border-destructive p-3 text-sm">{t("permissionDenied")}</div>;
  }

  const label = autoCloseStoreName
    ? t("buttonAutoClose", { storeName: autoCloseStoreName })
    : t("button");

  return (
    <div className="space-y-2">
      <button onClick={onTap} disabled={pending}
        className="w-full bg-primary text-primary-foreground rounded py-3 text-lg font-medium">
        {label}
      </button>
      {error && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <span>{error}</span>
          <button onClick={onTap} className="underline">{t("coordsRetry")}</button>
        </div>
      )}
    </div>
  );
}
