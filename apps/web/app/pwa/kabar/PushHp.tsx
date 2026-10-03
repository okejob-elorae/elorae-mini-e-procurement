"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { daftarkanPush, pushDidukung, type HasilPush } from "@/lib/pwa/push";

type Keadaan = "memeriksa" | "belum" | "aktif" | "diblokir" | "tidak_didukung";

/**
 * Kartu "Pemberitahuan di HP ini" di layar Kabar. Izin diminta dari ketukan
 * tombol — iPhone menolak permintaan izin yang tidak berasal dari ketukan.
 */
export function PushHp() {
  const t = useTranslations("pwa.kabar.push");
  const [keadaan, setKeadaan] = useState<Keadaan>("memeriksa");
  const [hasil, setHasil] = useState<HasilPush | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let batal = false;
    queueMicrotask(() => {
      if (batal) return;
      if (!pushDidukung()) setKeadaan("tidak_didukung");
      else if (Notification.permission === "granted") setKeadaan("aktif");
      else if (Notification.permission === "denied") setKeadaan("diblokir");
      else setKeadaan("belum");
    });
    return () => {
      batal = true;
    };
  }, []);

  if (keadaan === "memeriksa" || keadaan === "aktif") return null;

  const nyalakan = () =>
    startTransition(async () => {
      const h = await daftarkanPush({ minta: true });
      setHasil(h);
      if (h === "AKTIF") setKeadaan("aktif");
      else if (h === "IZIN_DITOLAK") setKeadaan(Notification.permission === "denied" ? "diblokir" : "belum");
    });

  return (
    <section className="beranda-kartu space-y-2">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <BellRing className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {keadaan === "tidak_didukung" ? t("unsupported") : keadaan === "diblokir" ? t("blocked") : t("body")}
          </p>
          {hasil && hasil !== "AKTIF" && hasil !== "IZIN_DITOLAK" ? (
            <p className="text-sm text-destructive">{t(`err.${hasil}`)}</p>
          ) : null}
        </div>
      </div>
      {keadaan === "belum" ? (
        <Button type="button" className="w-full" onClick={nyalakan} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("enable")}
        </Button>
      ) : null}
    </section>
  );
}
