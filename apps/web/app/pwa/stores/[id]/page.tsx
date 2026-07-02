import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getStore, listVisitsForStore, getActiveVisit } from "@/lib/stores/queries";
import { CheckInButton } from "./CheckInButton";
import { CheckOutButton } from "./CheckOutButton";

export const dynamic = "force-dynamic";

export default async function PwaStoreDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const [active, history, t, tBadge] = await Promise.all([
    getActiveVisit(session.user.id),
    listVisitsForStore(store.id, 20),
    getTranslations("pwa.checkIn"),
    getTranslations("stores.badge"),
  ]);

  const activeAtThisStore = active && active.storeId === store.id;
  const activeAtOtherStore = active && active.storeId !== store.id;
  const mapsUrl = store.lat !== null && store.lng !== null
    ? `https://www.google.com/maps?q=${store.lat},${store.lng}`
    : null;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{store.name}</h1>
      <div className="text-sm space-y-1">
        <div>{store.code} · {store.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}</div>
        <div>{store.address}</div>
        {store.phone && <div>{store.phone}</div>}
        {store.contactName && <div>{store.contactName}</div>}
        <div>Tempo: {store.paymentTempo}d · Margin: {store.marginPercent ?? "—"}%</div>
      </div>

      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener" className="block border rounded py-2 text-center">
          {t("openInMaps")}
        </a>
      )}

      {activeAtThisStore ? (
        <CheckOutButton visitId={active.id} />
      ) : (
        <CheckInButton storeId={store.id}
          autoCloseStoreName={activeAtOtherStore ? active.store.name : null} />
      )}

      <section className="pt-4">
        <h2 className="text-lg font-semibold mb-2">{t("history")}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {history.map(v => (
              <li key={v.id} className="border rounded p-2 text-sm space-y-1">
                <div>
                  {v.checkinAt.toLocaleString()} → {v.checkoutAt ? v.checkoutAt.toLocaleString() : t("stillOpen")}
                </div>
                <div className="flex gap-2 items-center">
                  {v.autoClosed && <span className="text-xs bg-muted rounded px-2 py-0.5">{t("autoClosedBadge")}</span>}
                  <a href={`https://www.google.com/maps?q=${v.checkinLat},${v.checkinLng}`}
                    target="_blank" rel="noopener" className="underline text-xs">
                    {t("viewCoords")}
                  </a>
                  <span className="text-xs text-muted-foreground ml-auto">{v.user.name ?? v.user.email}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/pwa/stores" className="block text-sm underline">← All stores</Link>
    </div>
  );
}
