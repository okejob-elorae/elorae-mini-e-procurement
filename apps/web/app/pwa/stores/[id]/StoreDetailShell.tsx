"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckInButton } from "./CheckInButton";
import { CheckOutButton } from "./CheckOutButton";
import { Badge } from "@/components/ui/badge";

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

export function StoreDetailShell({ store, active, history }: Props) {
  const t = useTranslations("pwa.checkIn");
  const tBadge = useTranslations("stores.badge");

  const activeAtThisStore = active && active.storeId === store.id;
  const activeAtOtherStore = active && active.storeId !== store.id;
  const mapsUrl = store.lat !== null && store.lng !== null
    ? `https://www.google.com/maps?q=${store.lat},${store.lng}`
    : null;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">{store.name}</h1>
      <div className="text-sm space-y-1">
        <div className="flex items-center gap-2">
          <span>{store.code}</span>
          <Badge variant={store.termsType === "PUTUS" ? "outline" : "secondary"}>
            {store.termsType === "PUTUS" ? tBadge("putus") : tBadge("konsi")}
          </Badge>
        </div>
        <div>{store.address}</div>
        {store.phone && <div>{store.phone}</div>}
        {store.contactName && <div>{store.contactName}</div>}
        <div>Tempo: {store.paymentTempo}d · Margin: {store.marginPercent ?? "—"}%</div>
      </div>

      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="block border rounded py-2 text-center">
          {t("openInMaps")}
        </a>
      )}

      {activeAtThisStore ? (
        <CheckOutButton visitId={active.id} />
      ) : (
        <CheckInButton
          storeId={store.id}
          autoCloseStoreName={activeAtOtherStore ? active.storeName : null}
        />
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
                  {new Date(v.checkinAtIso).toLocaleString()} → {v.checkoutAtIso ? new Date(v.checkoutAtIso).toLocaleString() : t("stillOpen")}
                </div>
                <div className="flex gap-2 items-center">
                  {v.autoClosed && <Badge variant="secondary">{t("autoClosedBadge")}</Badge>}
                  <a
                    href={`https://www.google.com/maps?q=${v.checkinLat},${v.checkinLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-xs"
                  >
                    {t("viewCoords")}
                  </a>
                  <span className="text-xs text-muted-foreground ml-auto">{v.userLabel}</span>
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
