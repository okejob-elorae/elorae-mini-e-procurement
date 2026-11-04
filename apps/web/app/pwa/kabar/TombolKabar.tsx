"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { KABAR_BERUBAH } from "./peristiwa";

/** Selang muat ulang lencana selama layar terlihat. */
const SELANG_MS = 60_000;

/**
 * Jumlah kabar belum dibaca dari `/api/notifications`, atau `null` kalau tidak bisa dibaca
 * (tanpa sinyal, sesi habis dan dialihkan ke /login, 403, bentuk jawaban lain). Tidak pernah
 * melempar — lencana yang tidak termuat cukup tidak tampil.
 */
async function ambilJumlahBelumDibaca(): Promise<number | null> {
  try {
    const res = await fetch("/api/notifications", { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok || res.redirected) return null;
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const json: unknown = await res.json();
    const n = json !== null && typeof json === "object" ? (json as { unreadCount?: unknown }).unreadCount : null;
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/**
 * Lonceng kabar di kepala beranda (salesman dan SPG) — menuju `/pwa/kabar`, dengan lencana
 * jumlah belum dibaca. Dimuat saat dipasang, saat layar kembali terlihat atau jendela kembali
 * fokus (HP baru dibuka dari saku), tiap 60 detik selama terlihat, dan saat layar Kabar
 * menandai sesuatu dibaca. Tidak berjalan di latar supaya tidak menghabiskan baterai dan kuota.
 */
export function TombolKabar() {
  const t = useTranslations("pwa.kabar");
  const [belum, setBelum] = useState(0);

  useEffect(() => {
    let aktif = true;
    let pengatur: ReturnType<typeof setInterval> | null = null;
    // `focus` dan `visibilitychange` biasanya datang berbarengan saat HP dibuka; satu permintaan cukup.
    let sedangMuat = false;

    const muat = () => {
      if (document.visibilityState !== "visible" || sedangMuat) return;
      sedangMuat = true;
      void ambilJumlahBelumDibaca().then((n) => {
        sedangMuat = false;
        if (aktif && n !== null) setBelum(n);
      });
    };
    const mulai = () => {
      if (pengatur === null) pengatur = setInterval(muat, SELANG_MS);
    };
    const henti = () => {
      if (pengatur !== null) {
        clearInterval(pengatur);
        pengatur = null;
      }
    };
    const saatTerlihat = () => {
      if (document.visibilityState === "visible") {
        muat();
        mulai();
      } else {
        henti();
      }
    };

    saatTerlihat();
    document.addEventListener("visibilitychange", saatTerlihat);
    window.addEventListener("focus", muat);
    window.addEventListener(KABAR_BERUBAH, muat);
    return () => {
      aktif = false;
      henti();
      document.removeEventListener("visibilitychange", saatTerlihat);
      window.removeEventListener("focus", muat);
      window.removeEventListener(KABAR_BERUBAH, muat);
    };
  }, []);

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={belum > 0 ? t("openWithCount", { count: belum }) : t("open")}
    >
      <Link href="/pwa/kabar">
        <Bell className="h-5 w-5" aria-hidden />
        {belum > 0 ? (
          <span
            className="pointer-events-none absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-none text-white tabular-nums"
            aria-hidden
          >
            {belum > 9 ? "9+" : belum}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
