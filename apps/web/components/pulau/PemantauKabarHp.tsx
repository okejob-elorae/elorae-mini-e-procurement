"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { KABAR_BERUBAH } from "@/app/pwa/kabar/peristiwa";
import { tautanKabar } from "@/lib/notifications/tautan-kabar";
import { kabarBaru, type ButirKabar, type PenandaKabar } from "@/lib/pulau/kabar-baru";
import { kabarNotifikasi } from "@/lib/pulau/pulau";

/** Selang memeriksa kabar selama layar terlihat — sama dengan lencana lonceng beranda. */
const SELANG_MS = 60_000;

type KabarMentah = ButirKabar & { type: string; title: string; data: unknown };

/** Halaman pertama `/api/notifications`, atau null bila tidak bisa dibaca (tanpa sinyal, sesi habis). */
async function ambilKabar(): Promise<KabarMentah[] | null> {
  try {
    const res = await fetch("/api/notifications", { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok || res.redirected) return null;
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const json: unknown = await res.json();
    const items = json !== null && typeof json === "object" ? (json as { items?: unknown }).items : null;
    if (!Array.isArray(items)) return null;
    return items.filter(
      (b): b is KabarMentah =>
        b !== null &&
        typeof b === "object" &&
        typeof (b as KabarMentah).id === "string" &&
        typeof (b as KabarMentah).createdAt === "string",
    );
  } catch {
    return null;
  }
}

/**
 * Kabar baru di HP (salesman dan SPG) → pulau status: "1 notifikasi baru ·
 * <judul>", diketuk membuka tautan kabarnya. Muatan pertama hanya patokan, jadi
 * kabar lama tidak dimunculkan saat aplikasi dibuka. Memeriksa saat dipasang,
 * saat layar kembali terlihat atau jendela kembali fokus, dan tiap 60 detik
 * selama terlihat — tidak berjalan di latar. Di layar Kabar sendiri pulau diam.
 *
 * Dipasang SEKALI di `app/pwa/layout.tsx`.
 */
export function PemantauKabarHp() {
  const path = usePathname();
  const diLayarKabar = useRef(false);

  useEffect(() => {
    diLayarKabar.current = path === "/pwa/kabar";
  }, [path]);

  useEffect(() => {
    let aktif = true;
    let penanda: PenandaKabar | null = null;
    let sedangMuat = false;
    let pengatur: ReturnType<typeof setInterval> | null = null;

    const periksa = () => {
      if (document.visibilityState !== "visible" || sedangMuat) return;
      sedangMuat = true;
      void ambilKabar().then((items) => {
        sedangMuat = false;
        if (!aktif || items === null) return;
        const hasil = kabarBaru(penanda, items);
        penanda = hasil.penanda;
        if (hasil.baru.length === 0) return;
        // Lencana lonceng beranda ikut diperbarui tanpa menunggu putarannya.
        window.dispatchEvent(new Event(KABAR_BERUBAH));
        if (diLayarKabar.current) return;
        const terbaru = hasil.baru[0];
        kabarNotifikasi({
          judul: terbaru.title,
          tautan: tautanKabar(terbaru.type, terbaru.data) ?? "/pwa/kabar",
          jumlah: hasil.baru.length,
          // Kapsul yang menyebut lebih dari satu kabar membuka daftar kabarnya.
          semua: { tautan: "/pwa/kabar" },
        });
      });
    };
    const mulai = () => {
      if (pengatur === null) pengatur = setInterval(periksa, SELANG_MS);
    };
    const henti = () => {
      if (pengatur !== null) clearInterval(pengatur);
      pengatur = null;
    };
    const saatTerlihat = () => {
      if (document.visibilityState === "visible") {
        periksa();
        mulai();
      } else {
        henti();
      }
    };

    saatTerlihat();
    document.addEventListener("visibilitychange", saatTerlihat);
    window.addEventListener("focus", periksa);
    return () => {
      aktif = false;
      henti();
      document.removeEventListener("visibilitychange", saatTerlihat);
      window.removeEventListener("focus", periksa);
    };
  }, []);

  return null;
}
