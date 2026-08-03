"use client";

import Link from "next/link";
import { Clock, ExternalLink, LogOut, MapPin, ShoppingCart, Store as StoreIcon } from "lucide-react";
import { CheckInButton } from "./stores/[id]/CheckInButton";
import { CheckOutButton } from "./stores/[id]/CheckOutButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

type SpgStore = {
  id: string;
  name: string;
  code: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

type ActiveVisit = {
  id: string;
  checkinAt: string;
  checkinOutOfRadius: boolean;
  checkinDistanceMeters: number | null;
} | null;

type Props = {
  userName: string;
  store: SpgStore;
  activeVisit: ActiveVisit;
  /**
   * Name of the store an open visit belongs to, if it's a DIFFERENT store than
   * this SPG's assigned one (e.g. the assignment changed mid-visit) — passed
   * through so CheckInButton can warn it'll auto-close that visit.
   */
  autoCloseStoreName: string | null;
  onLogout: () => Promise<void>;
};

/**
 * Fixed-store PWA home for the SPG role — the salesman HomeShell variant with
 * no roaming store list: always the same store, check-in/out at it, and a
 * "Catat Penjualan" CTA gated on being checked in there.
 */
export function SpgHomeShell({ userName, store, activeVisit, autoCloseStoreName, onLogout }: Props) {
  const mapsUrl =
    store.lat !== null && store.lng !== null ? `https://www.google.com/maps?q=${store.lat},${store.lng}` : null;

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between pb-2">
        <div>
          <p className="text-xs text-muted-foreground">Selamat datang</p>
          <p className="text-lg font-semibold">{userName}</p>
        </div>
        <form action={onLogout}>
          <Button type="submit" variant="ghost" size="icon" aria-label="Keluar">
            <LogOut className="h-5 w-5" />
          </Button>
        </form>
      </header>

      <Card className={activeVisit ? "border-primary/40 bg-primary/5" : undefined}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary p-2 shrink-0">
              <StoreIcon className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-semibold leading-tight">{store.name}</p>
                {activeVisit && (
                  <Badge variant="default" className="shrink-0 uppercase tracking-wide">
                    Check-in
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{store.code}</p>
              <p className="mt-1 text-sm text-muted-foreground">{store.address}</p>
              {activeVisit && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Sejak{" "}
                  {new Date(activeVisit.checkinAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}
                </span>
              )}
            </div>
          </div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <MapPin className="h-3 w-3" />
              Buka di Maps
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      {activeVisit?.checkinOutOfRadius && (
        <Alert className="border-amber-500/50 text-amber-700 [&>svg]:text-amber-600">
          <AlertDescription className="text-amber-700">
            Check-in tercatat di luar radius toko (~{activeVisit.checkinDistanceMeters ?? "?"} m).
          </AlertDescription>
        </Alert>
      )}

      {activeVisit ? (
        <>
          <Button asChild className="w-full py-3 text-lg font-medium">
            <Link href="/pwa/spg/sale">
              <ShoppingCart className="h-5 w-5" />
              Catat Penjualan
            </Link>
          </Button>
          <CheckOutButton visitId={activeVisit.id} />
        </>
      ) : (
        <>
          <Button disabled variant="secondary" className="w-full py-3 text-lg font-medium">
            <ShoppingCart className="h-5 w-5" />
            Catat Penjualan (check-in dulu)
          </Button>
          <CheckInButton storeId={store.id} autoCloseStoreName={autoCloseStoreName} />
        </>
      )}
    </div>
  );
}
