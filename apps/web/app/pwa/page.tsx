import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getActiveVisit, getStore, listActiveStoresForPwa, listRecentVisitsForUser } from "@/lib/stores/queries";
import { HomeShell } from "./HomeShell";
import { SpgHomeShell } from "./SpgHomeShell";
import { logout } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogOut } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PwaHome() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userName = session.user.name ?? session.user.email ?? "";
  const canCollect = hasPermission(session.user.permissions ?? [], PERMISSIONS.COLLECTIONS_COLLECT);

  /**
   * SPG is a fixed-store role (User.assignedStoreId) — detect it before
   * falling back to the roaming salesman home below. The session/JWT doesn't
   * carry assignedStoreId (see lib/auth.ts callbacks), so this is one extra
   * indexed lookup on every /pwa load; non-SPG users pay it too (assignedStoreId
   * is null for them, a cheap PK-indexed miss).
   */
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { assignedStoreId: true },
  });

  if (me?.assignedStoreId) {
    const [store, active] = await Promise.all([
      getStore(me.assignedStoreId),
      getActiveVisit(session.user.id),
    ]);

    if (!store) {
      /**
       * assignedStoreId is FK-free (relationMode=prisma) — the store could have
       * been deleted or the assignment misconfigured. Surface a clear dead-end
       * instead of a crash or silently falling through to the salesman home.
       */
      return (
        <div className="p-4 space-y-4">
          <header className="flex items-center justify-between pb-2">
            <div>
              <p className="text-xs text-muted-foreground">Selamat datang</p>
              <p className="text-lg font-semibold">{userName}</p>
            </div>
            <form action={logout}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Keluar">
                <LogOut className="h-5 w-5" />
              </Button>
            </form>
          </header>
          <Card>
            <CardContent className="p-6 text-center text-sm text-destructive">
              Toko Anda belum diatur atau tidak ditemukan. Hubungi admin untuk mengatur toko Anda.
            </CardContent>
          </Card>
        </div>
      );
    }

    const activeAtThisStore = active && active.storeId === store.id ? active : null;
    const activeAtOtherStoreName = active && active.storeId !== store.id ? active.store.name : null;

    return (
      <SpgHomeShell
        userName={userName}
        store={{
          id: store.id,
          name: store.name,
          code: store.code,
          address: store.address,
          termsType: store.termsType,
          lat: store.lat,
          lng: store.lng,
        }}
        activeVisit={
          activeAtThisStore
            ? {
                id: activeAtThisStore.id,
                checkinAt: activeAtThisStore.checkinAt.toISOString(),
                checkinOutOfRadius: activeAtThisStore.checkinOutOfRadius,
                checkinDistanceMeters: activeAtThisStore.checkinDistanceMeters,
              }
            : null
        }
        autoCloseStoreName={activeAtOtherStoreName}
        onLogout={logout}
      />
    );
  }

  const [active, stores, recentVisits] = await Promise.all([
    getActiveVisit(session.user.id),
    listActiveStoresForPwa(),
    listRecentVisitsForUser(session.user.id, 20),
  ]);

  const recentMap = new Map<string, string>();
  for (const v of recentVisits) {
    if (!recentMap.has(v.storeId)) recentMap.set(v.storeId, v.store.name);
  }
  const recentStores = Array.from(recentMap.entries())
    .slice(0, 3)
    .map(([storeId, storeName]) => ({ storeId, storeName }));

  return (
    <HomeShell
      userName={userName}
      activeVisit={active ? {
        id: active.id,
        storeId: active.storeId,
        storeName: active.store.name,
        storeTermsType: active.store.termsType,
        checkinAt: active.checkinAt.toISOString(),
      } : null}
      stores={stores.map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))}
      recentStores={recentStores}
      canCollect={canCollect}
      onLogout={logout}
    />
  );
}
