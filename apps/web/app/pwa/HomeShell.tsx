"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "@/lib/pwa/nearest-stores";
import { CheckOutButton } from "./stores/[id]/CheckOutButton";

type PermState = "prompt" | "granted" | "denied" | "unknown";

type Props = {
  activeVisit: { id: string; storeId: string; storeName: string; checkinAt: string } | null;
  stores: StoreWithCoords[];
  recentStores: Array<{ storeId: string; storeName: string }>;
  onLogout: () => Promise<void>;
};

export function HomeShell({ activeVisit, stores, recentStores, onLogout }: Props) {
  const t = useTranslations("pwa.nearest");
  const tAuth = useTranslations("auth");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);

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
    if (perm !== "granted") { setOrigin(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setOrigin(null),
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

  const logoutFooter = (
    <form action={onLogout} className="pt-2">
      <button
        type="submit"
        className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
      >
        {tAuth("logout")}
      </button>
    </form>
  );

  if (activeVisit) {
    return (
      <div className="p-4 space-y-4">
        <div className="rounded border p-4 space-y-2">
          <div className="text-lg font-semibold">{t("activeAt", { storeName: activeVisit.storeName })}</div>
          <div className="text-xs text-muted-foreground">
            {t("checkedInAgo", { time: new Date(activeVisit.checkinAt).toLocaleTimeString() })}
          </div>
        </div>
        <CheckOutButton visitId={activeVisit.id} />
        {logoutFooter}
      </div>
    );
  }

  const ranked = origin ? rankStoresByDistance(stores, origin).filter(r => r.distanceMeters !== null).slice(0, 3) : [];

  return (
    <div className="p-4 space-y-6">
      <div>
        <p className="text-lg font-semibold">{t("noActive")}</p>
      </div>

      {perm === "granted" && ranked.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">{t("title")}</h2>
          <ul className="space-y-2">
            {ranked.map(r => (
              <li key={r.store.id}>
                <Link href={`/pwa/stores/${r.store.id}`}
                  className="block border rounded p-3 flex items-center gap-3">
                  <div className="flex-1">{r.store.name}</div>
                  <span className="text-xs text-muted-foreground">{formatDistance(r.distanceMeters!)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/pwa/stores" className="block mt-2 text-sm underline">{t("seeAll")}</Link>
        </section>
      )}

      {perm === "granted" && ranked.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noStoresWithCoords")}</p>
      )}

      {perm === "prompt" && (
        <button onClick={requestPermission} className="text-sm underline text-muted-foreground">
          {t("enableChip")}
        </button>
      )}

      {(perm === "denied" || perm === "prompt") && (
        <Link href="/pwa/stores" className="block border rounded p-3 text-center">
          {t("browse")}
        </Link>
      )}

      {perm === "denied" && (
        <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
      )}

      {recentStores.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">{t("recent")}</h2>
          <ul className="space-y-1">
            {recentStores.map(r => (
              <li key={r.storeId}>
                <Link href={`/pwa/stores/${r.storeId}`} className="text-sm underline">
                  {r.storeName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {logoutFooter}
    </div>
  );
}
