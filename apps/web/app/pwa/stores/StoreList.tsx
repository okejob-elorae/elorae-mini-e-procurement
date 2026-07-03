"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "@/lib/pwa/nearest-stores";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type PermState = "prompt" | "granted" | "denied" | "unknown";
type StoreItem = StoreWithCoords & { code: string; termsType: "PUTUS" | "KONSI" };

export function StoreList({ stores }: { stores: StoreItem[] }) {
  const tBadge = useTranslations("stores.badge");
  const [perm, setPerm] = useState<PermState>("unknown");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
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
    if (perm !== "granted") { setOrigin(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setOrigin(null),
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
    <div className="p-4 space-y-3">
      <Input placeholder="Search"
        value={search} onChange={e => setSearch(e.target.value)} />

      <ul className="space-y-2">
        {ranked.map(({ store, distanceMeters }) => (
          <li key={store.id}>
            <Link href={`/pwa/stores/${store.id}`}
              className="block border rounded p-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium">{store.name}</div>
                <div className="text-xs text-muted-foreground">{(store as StoreItem).code}</div>
              </div>
              <Badge variant={(store as StoreItem).termsType === "PUTUS" ? "outline" : "secondary"}>
                {(store as StoreItem).termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
              </Badge>
              {distanceMeters !== null && (
                <Badge variant="secondary">{formatDistance(distanceMeters)}</Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
