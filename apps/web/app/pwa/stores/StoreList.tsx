"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight, Loader2, Search, Store } from "lucide-react";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "@/lib/pwa/nearest-stores";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PermState = "prompt" | "granted" | "denied" | "unknown";
type StoreItem = StoreWithCoords & { code: string; termsType: "PUTUS" | "KONSI" };

export function StoreList({ stores }: { stores: StoreItem[] }) {
  const tBadge = useTranslations("stores.badge");
  const tNearest = useTranslations("pwa.nearest");
  const tNav = useTranslations("pwa.nav");
  const tList = useTranslations("pwa.stores");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [fetchingOrigin, setFetchingOrigin] = useState(false);
  const [search, setSearch] = useState("");

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

  const filtered = stores.filter(s => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q);
  });

  const ranked = rankStoresByDistance(filtered, origin);

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center gap-2 -ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {tNav("home")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-2xl font-bold leading-tight">{tList("title")}</h1>
        <p className="text-xs text-muted-foreground">
          {tList("count", { count: filtered.length })}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={tList("searchPlaceholder")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {fetchingOrigin && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{tNearest("loading")}</span>
        </div>
      )}

      {ranked.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {search.trim() ? tList("noSearchResults") : tList("empty")}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {ranked.map(({ store, distanceMeters }) => {
            const item = store as StoreItem;
            return (
              <li key={store.id}>
                <Link
                  href={`/pwa/stores/${store.id}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <div className="rounded-full bg-primary p-2 shrink-0">
                    <Store className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium leading-tight">{store.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.code}</span>
                      <span className="opacity-60">·</span>
                      <Badge variant={item.termsType === "PUTUS" ? "outline" : "secondary"} className="text-[10px] px-1.5 py-0">
                        {item.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
                      </Badge>
                    </div>
                  </div>
                  {distanceMeters !== null && (
                    <span className="text-xs text-muted-foreground shrink-0">{formatDistance(distanceMeters)}</span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
