"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ImageOff } from "lucide-react";

type Props = {
  title: string;
  url: string | null;
  unavailable: boolean;
  /** Copy for the "nothing to show" case, chosen by the parent from status and method. */
  emptyText: string;
  caption?: string | null;
};

export function ShipmentPhotoPanel({ title, url, unavailable, emptyText, caption }: Props) {
  const t = useTranslations("deliveryShipments.detail");
  const [failed, setFailed] = useState(false);

  let fallback: string | null = null;
  if (unavailable) fallback = t("photoUnavailable");
  else if (!url) fallback = emptyText;
  else if (failed) fallback = t("photoLoadFailed");

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="aspect-[4/3] overflow-hidden rounded-md border bg-muted">
        {fallback || !url ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{fallback}</p>
          </div>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("openPhoto")}
            className="block h-full w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- external R2-hosted photo, not an optimizable local asset */}
            <img
              src={url}
              alt={title}
              loading="lazy"
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
            />
          </a>
        )}
      </div>
      {caption && <p className="truncate text-sm text-muted-foreground">{caption}</p>}
    </div>
  );
}
