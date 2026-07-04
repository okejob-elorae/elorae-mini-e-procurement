"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, ChevronRight, Clock, LogOut, MapPin, Loader2, ShoppingBag, Store } from "lucide-react";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "@/lib/pwa/nearest-stores";
import { CheckOutButton } from "./stores/[id]/CheckOutButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PermState = "prompt" | "granted" | "denied" | "unknown";

type Props = {
  userName: string;
  activeVisit: { id: string; storeId: string; storeName: string; checkinAt: string } | null;
  stores: StoreWithCoords[];
  recentStores: Array<{ storeId: string; storeName: string }>;
  onLogout: () => Promise<void>;
};

export function HomeShell({ userName, activeVisit, stores, recentStores, onLogout }: Props) {
  const t = useTranslations("pwa.nearest");
  const tAuth = useTranslations("auth");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [fetchingOrigin, setFetchingOrigin] = useState(false);

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

  useEffect(() => {
    if (perm !== "granted") { setOrigin(null); setFetchingOrigin(false); return; }
    setFetchingOrigin(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setFetchingOrigin(false); },
      () => { setOrigin(null); setFetchingOrigin(false); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [perm]);

  function requestPermission() {
    navigator.geolocation.getCurrentPosition(
      () => setPerm("granted"),
      () => setPerm("denied"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  const header = (
    <header className="flex items-center justify-between pb-2">
      <div>
        <p className="text-xs text-muted-foreground">{t("greeting")}</p>
        <p className="text-lg font-semibold">{userName}</p>
      </div>
      <form action={onLogout}>
        <Button type="submit" variant="ghost" size="icon" aria-label={tAuth("logout")}>
          <LogOut className="h-5 w-5" />
        </Button>
      </form>
    </header>
  );

  if (activeVisit) {
    return (
      <div className="p-4 space-y-4">
        {header}
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="uppercase tracking-wide">
                {t("activeBadge")}
              </Badge>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(activeVisit.checkinAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-5 w-5 text-primary shrink-0" />
              <div>
                <p className="text-lg font-semibold leading-tight">{activeVisit.storeName}</p>
                <p className="text-xs text-muted-foreground">{t("activeStoreLabel")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Button asChild className="w-full">
          <Link href={`/pwa/stores/${activeVisit.storeId}/catalog`}>
            <ShoppingBag className="h-4 w-4" />
            Katalog Produk
          </Link>
        </Button>
        <CheckOutButton visitId={activeVisit.id} />
      </div>
    );
  }

  const ranked = origin ? rankStoresByDistance(stores, origin).filter(r => r.distanceMeters !== null).slice(0, 3) : [];

  return (
    <div className="p-4 space-y-5">
      {header}

      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <div className="rounded-full bg-muted p-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="font-medium">{t("noActive")}</p>
            <p className="text-xs text-muted-foreground">{t("noActiveHint")}</p>
          </div>
        </CardContent>
      </Card>

      {perm === "granted" && fetchingOrigin && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      )}

      {perm === "granted" && !fetchingOrigin && ranked.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("title")}</h2>
            <Link
              href="/pwa/stores"
              className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t("seeAll")} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="space-y-2">
            {ranked.map(r => (
              <li key={r.store.id}>
                <Link
                  href={`/pwa/stores/${r.store.id}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <div className="rounded-full bg-primary p-2">
                    <Store className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{r.store.name}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">{formatDistance(r.distanceMeters!)}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {perm === "granted" && !fetchingOrigin && ranked.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noStoresWithCoords")}</p>
      )}

      {perm === "prompt" && (
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{t("enableChip")}</span>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={requestPermission}>
              {t("enableCta")}
            </Button>
          </CardContent>
        </Card>
      )}

      {perm === "denied" && (
        <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
      )}

      {(perm === "denied" || perm === "prompt") && (
        <Button asChild variant="outline" className="w-full">
          <Link href="/pwa/stores">
            {t("browse")}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      )}

      {recentStores.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("recent")}</h2>
          <ul className="flex flex-wrap gap-2">
            {recentStores.map(r => (
              <li key={r.storeId}>
                <Link
                  href={`/pwa/stores/${r.storeId}`}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Store className="h-3 w-3 text-muted-foreground" />
                  {r.storeName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
