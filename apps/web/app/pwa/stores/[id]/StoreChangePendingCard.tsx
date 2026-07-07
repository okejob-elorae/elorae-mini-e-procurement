"use client";

import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type Fields = {
  name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null;
};
type Props = { pending: { proposed: Fields; old: Fields; requestedByLabel: string } };

function locLabel(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  return `${lat}, ${lng}`;
}

export function StoreChangePendingCard({ pending }: Props) {
  const t = useTranslations("pwa.storeChanges");
  const { proposed, old } = pending;
  const rows: Array<{ label: string; from: string; to: string }> = [];
  const push = (label: string, from: string | null, to: string | null) => {
    if ((from ?? "") !== (to ?? "")) rows.push({ label, from: from ?? t("empty"), to: to ?? t("empty") });
  };
  push(t("fieldName"), old.name, proposed.name);
  push(t("fieldAddress"), old.address, proposed.address);
  push(t("fieldPhone"), old.phone, proposed.phone);
  push(t("fieldContact"), old.contactName, proposed.contactName);
  push(t("fieldLocation"), locLabel(old.lat, old.lng), locLabel(proposed.lat, proposed.lng));

  return (
    <Card className="border-amber-500/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4 text-amber-600" />
          {t("pendingTitle")}
        </div>
        <p className="text-xs text-muted-foreground">{t("pendingSubtitle")}</p>
        <dl className="space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="space-y-0.5">
              <dt className="text-xs text-muted-foreground">{r.label}</dt>
              <dd className="flex flex-wrap items-center gap-1">
                <span className="line-through text-muted-foreground">{r.from}</span>
                <span aria-hidden>→</span>
                <span className="font-medium">{r.to}</span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
