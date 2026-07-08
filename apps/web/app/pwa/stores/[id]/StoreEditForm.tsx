"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MapPin, Pencil } from "lucide-react";
import { submitStoreChangeRequestAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

type StoreProps = {
  id: string; name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null;
};
type Props = { store: StoreProps; visitId: string };

export function StoreEditForm({ store, visitId }: Props) {
  const t = useTranslations("pwa.storeChanges");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(store.name);
  const [address, setAddress] = useState(store.address);
  const [phone, setPhone] = useState(store.phone ?? "");
  const [contactName, setContactName] = useState(store.contactName ?? "");
  const [lat, setLat] = useState<number | null>(store.lat);
  const [lng, setLng] = useState<number | null>(store.lng);
  const [repinning, setRepinning] = useState(false);
  const [pending, startTransition] = useTransition();

  function repin() {
    setRepinning(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setRepinning(false); toast.success(t("repinDone")); },
      () => { setRepinning(false); toast.error(t("repinError")); },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function submit() {
    startTransition(async () => {
      try {
        const res = await submitStoreChangeRequestAction({
          storeId: store.id, visitId,
          name: name.trim(), address: address.trim(),
          phone: phone.trim() || null, contactName: contactName.trim() || null,
          lat, lng,
        });
        if (res.ok) { toast.success(t("successToast")); setOpen(false); router.refresh(); return; }
        const map: Record<string, string> = {
          NO_ACTIVE_VISIT: t("errNoActiveVisit"),
          ALREADY_PENDING: t("errAlreadyPending"),
          NO_CHANGES: t("errNoChanges"),
        };
        toast.error(map[res.code] ?? t("errGeneric"));
        if (res.code === "ALREADY_PENDING") router.refresh();
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" />
        {t("editButton")}
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">{t("title")}</p>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("nameLabel")}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} maxLength={191} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("addressLabel")}</label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} disabled={pending} rows={2} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("phoneLabel")}</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} inputMode="tel" maxLength={64} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("contactLabel")}</label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} disabled={pending} maxLength={191} />
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={repin} disabled={pending || repinning}>
          {repinning ? <><Loader2 className="h-4 w-4 animate-spin" />{t("repinning")}</> : <><MapPin className="h-4 w-4" />{t("repinButton")}</>}
          {lat !== null && lng !== null && !repinning && (
            <span className="ml-auto text-xs text-muted-foreground">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
          )}
        </Button>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={() => setOpen(false)} disabled={pending}>{t("cancel")}</Button>
          <Button type="button" className="flex-1" onClick={submit} disabled={pending || repinning || !name.trim() || !address.trim()}>
            {pending ? <><Loader2 className="h-4 w-4 animate-spin" />{t("submitting")}</> : t("submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
