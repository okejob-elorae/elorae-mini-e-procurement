"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  MapPin,
  Phone,
  User as UserIcon,
} from "lucide-react";
import { CheckInButton } from "./CheckInButton";
import { CheckOutButton } from "./CheckOutButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type StoreProps = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI";
  paymentTempo: number;
  marginPercent: number | null;
  lat: number | null;
  lng: number | null;
};

type ActiveProps = {
  id: string;
  storeId: string;
  storeName: string;
} | null;

type HistoryRow = {
  id: string;
  checkinAtIso: string;
  checkoutAtIso: string | null;
  checkinLat: number;
  checkinLng: number;
  autoClosed: boolean;
  userLabel: string;
};

type Props = {
  store: StoreProps;
  active: ActiveProps;
  history: HistoryRow[];
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StoreDetailShell({ store, active, history }: Props) {
  const t = useTranslations("pwa.checkIn");
  const tBadge = useTranslations("stores.badge");
  const tList = useTranslations("pwa.stores");

  const activeAtThisStore = active && active.storeId === store.id;
  const activeAtOtherStore = active && active.storeId !== store.id;
  const mapsUrl = store.lat !== null && store.lng !== null
    ? `https://www.google.com/maps?q=${store.lat},${store.lng}`
    : null;

  return (
    <div className="p-4 space-y-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/stores">
            <ArrowLeft className="h-4 w-4" />
            {tList("title")}
          </Link>
        </Button>
      </header>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold leading-tight">{store.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{store.code}</span>
          <span className="opacity-60">·</span>
          <Badge variant={store.termsType === "PUTUS" ? "outline" : "secondary"}>
            {store.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1">{store.address}</span>
          </div>
          {store.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <a href={`tel:${store.phone}`} className="hover:underline">{store.phone}</a>
            </div>
          )}
          {store.contactName && (
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{store.contactName}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {mapsUrl && (
        <Button asChild variant="outline" className="w-full">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-4 w-4" />
            {t("openInMaps")}
            <ExternalLink className="ml-auto h-3 w-3" />
          </a>
        </Button>
      )}

      {activeAtThisStore ? (
        <CheckOutButton visitId={active.id} />
      ) : (
        <CheckInButton
          storeId={store.id}
          autoCloseStoreName={activeAtOtherStore ? active.storeName : null}
        />
      )}

      <section className="pt-2 space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          <Clock className="h-4 w-4" />
          {t("history")}
        </h2>
        {history.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {t("historyEmpty")}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {history.map(v => (
              <li key={v.id}>
                <Card>
                  <CardContent className="p-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {formatDateTime(v.checkinAtIso)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {v.checkoutAtIso ? formatDateTime(v.checkoutAtIso) : t("stillOpen")}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {v.autoClosed && (
                        <Badge variant="secondary">{t("autoClosedBadge")}</Badge>
                      )}
                      <a
                        href={`https://www.google.com/maps?q=${v.checkinLat},${v.checkinLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                      >
                        <MapPin className="h-3 w-3" />
                        {t("viewCoords")}
                      </a>
                      <span className="ml-auto text-muted-foreground">{v.userLabel}</span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
