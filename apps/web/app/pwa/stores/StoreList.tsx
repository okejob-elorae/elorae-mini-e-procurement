"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Loader2, Plus, Search, Store } from "lucide-react";
import { rankStoresByDistance, formatDistance, type StoreWithCoords } from "@/lib/pwa/nearest-stores";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

type PermState = "prompt" | "granted" | "denied" | "unknown";
type StoreItem = StoreWithCoords & {
  code: string;
  termsType: "PUTUS" | "KONSI";
  /** Kelas toko A/B/C; opsional — pemanggil yang belum mengirimnya tidak menampilkan lencana. */
  storeClass?: string | null;
};

/**
 * Daftar toko di HP salesman.
 *
 * "Toko saya" (riwayat, piutang terbuka, dan toko yang ditugaskan admin) di
 * atas; toko lain dilipat di balik satu tombol. Pencarian tetap menyapu SEMUA
 * toko — pembagian ini penataan, bukan larangan: toko baru atau toko rekan
 * yang sedang cuti harus tetap bisa ditemukan dan dikunjungi.
 */
export function StoreList({
  stores,
  milikSaya = [],
  terkunci = false,
}: {
  stores: StoreItem[];
  milikSaya?: string[];
  /** Kunci "hanya toko sendiri": `stores` sudah berisi toko miliknya saja. */
  terkunci?: boolean;
}) {
  const tBadge = useTranslations("stores.badge");
  const tKelas = useTranslations("kelasToko.daftar");
  const tNearest = useTranslations("pwa.nearest");
  const tList = useTranslations("pwa.stores");
  const [lainTerbuka, setLainTerbuka] = useState(false);
  const saya = useMemo(() => new Set(milikSaya), [milikSaya]);
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
  // Dikelompokkan hanya saat tidak mencari dan salesman memang punya toko.
  const berkelompok = !terkunci && !search.trim() && saya.size > 0;
  const punyaSaya = berkelompok ? ranked.filter(r => saya.has(r.store.id)) : ranked;
  const lainnya = berkelompok ? ranked.filter(r => !saya.has(r.store.id)) : [];

  const baris = (daftar: typeof ranked) => (
    <ul className="space-y-2">
      {daftar.map(({ store, distanceMeters }) => {
        const item = store as StoreItem;
        return (
          <li key={store.id}>
            <Link
              href={`/pwa/stores/${store.id}`}
              className="flex min-h-14 items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent hover:text-accent-foreground"
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
                  {item.storeClass ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {tKelas("kelas", { kelas: item.storeClass })}
                    </Badge>
                  ) : null}
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
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold leading-tight">{tList("title")}</h1>
            <TombolBantuanHp judul={tList("title")} />
          </div>
          <p className="text-xs text-muted-foreground">
            {tList("count", { count: filtered.length })}
          </p>
        </div>
        {/* Calon toko yang belum terdaftar diusulkan dari sini; admin yang mendaftarkannya. */}
        <Button asChild size="sm" className="shrink-0">
          <Link href="/pwa/stores/baru">
            <Plus className="h-4 w-4" />
            {tList("newStore")}
          </Link>
        </Button>
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
        <Card className="py-0">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {search.trim() ? tList("noSearchResults") : terkunci ? tList("emptyLocked") : tList("empty")}
          </CardContent>
        </Card>
      ) : berkelompok ? (
        <>
          <section className="space-y-2">
            <h2 className="beranda-judul">{tList("mine", { count: punyaSaya.length })}</h2>
            {punyaSaya.length > 0 ? baris(punyaSaya) : <p className="text-sm text-muted-foreground">{tList("mineEmpty")}</p>}
          </section>
          {lainnya.length > 0 ? (
            <section className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
                aria-expanded={lainTerbuka}
                onClick={() => setLainTerbuka(x => !x)}
              >
                {lainTerbuka ? tList("hideOthers") : tList("showOthers", { count: lainnya.length })}
                <ChevronDown className={lainTerbuka ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
              </Button>
              {lainTerbuka ? baris(lainnya) : null}
            </section>
          ) : null}
        </>
      ) : (
        baris(ranked)
      )}
    </div>
  );
}
