import { auth } from "@/lib/auth";
import { getActiveVisit, listActiveStoresForPwa, listRecentVisitsForUser } from "@/lib/stores/queries";
import { HomeShell } from "./HomeShell";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function PwaHome() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

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

  const userName = session.user.name ?? session.user.email ?? "";

  return (
    <HomeShell
      userName={userName}
      activeVisit={active ? {
        id: active.id,
        storeId: active.storeId,
        storeName: active.store.name,
        checkinAt: active.checkinAt.toISOString(),
      } : null}
      stores={stores.map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))}
      recentStores={recentStores}
      onLogout={logout}
    />
  );
}
