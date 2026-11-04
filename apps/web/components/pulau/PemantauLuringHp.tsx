"use client";

import { useEffect } from "react";
import { hitungBelumTerkirim, PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { setLuring } from "@/lib/pulau/pulau";
import { awalKirim, langkahKirim, type KeadaanKirim, type PeristiwaKirim } from "@/lib/pulau/pengiriman";

/** Sesudah antrean terakhir berubah selama ini, pengirimannya dianggap selesai. */
const TENANG_MS = 1500;
/** "Mengirim…" tidak pernah bertahan lebih lama dari ini. */
const BATAS_KIRIM_MS = 30_000;
/** Selama mengirim, antrean dihitung ulang sesering ini (hitungan IndexedDB, murah). */
const SELANG_KIRIM_MS = 2000;

/**
 * Pemantau sinyal HP — tidak menggambar apa pun; keadaannya tampil di pulau
 * status: "Tanpa sinyal · N belum terkirim" (N dari antrean Dexie, hitungan
 * yang sama dengan titik di menu), "Mengirim…" saat sinyal kembali dan
 * antrean masih berisi, lalu "Terkirim" atau "N belum terkirim" sebentar.
 * Saat ada sinyal tanpa pengiriman yang ditunggu, pulau diam — titik di menu
 * Lainnya sudah menandai antrean yang tertahan.
 *
 * Pengirimannya sendiri tetap dijalankan `SinkronLatar`; di sini hanya diamati
 * lewat `PERISTIWA_ANTREAN`. Dipasang SEKALI di `app/pwa/layout.tsx`.
 */
export function PemantauLuringHp({ tautanAntrean }: { tautanAntrean: string }) {
  useEffect(() => {
    let aktif = true;
    let k: KeadaanKirim = awalKirim(navigator.onLine, 0);
    let tenang: ReturnType<typeof setTimeout> | null = null;
    let batas: ReturnType<typeof setTimeout> | null = null;
    let ulang: ReturnType<typeof setInterval> | null = null;

    const henti = (t: ReturnType<typeof setTimeout> | null) => {
      if (t !== null) clearTimeout(t);
      return null;
    };
    const hentiUlang = () => {
      if (ulang !== null) clearInterval(ulang);
      ulang = null;
    };

    const langkah = (p: PeristiwaKirim) => {
      const sebelum = k;
      k = langkahKirim(k, p);
      if (!sebelum.mengirim && k.mengirim) {
        batas = henti(batas);
        batas = setTimeout(() => {
          batas = null;
          langkah({ jenis: "batas" });
        }, BATAS_KIRIM_MS);
        // Antrean yang habis tanpa peristiwa susulan tetap ketahuan.
        hentiUlang();
        ulang = setInterval(() => void hitung(), SELANG_KIRIM_MS);
      }
      if (!k.mengirim) {
        batas = henti(batas);
        tenang = henti(tenang);
        hentiUlang();
      }
      setLuring({ luring: k.luring, belumTerkirim: k.belum, mengirim: k.mengirim, tautan: tautanAntrean });
    };

    function hitung() {
      return hitungBelumTerkirim().then(
        (belum) => {
          if (aktif) langkah({ jenis: "hitung", belum });
        },
        () => undefined,
      );
    }

    const saatAntreanBerubah = () => {
      void hitung().then(() => {
        if (!aktif || !k.mengirim) return;
        // SinkronLatar menembakkan peristiwa ini sesudah satu putaran kirim;
        // bila sesudahnya tenang, sisanya memang tertahan (gagal atau menunggu).
        tenang = henti(tenang);
        tenang = setTimeout(() => {
          tenang = null;
          langkah({ jenis: "tenang" });
        }, TENANG_MS);
      });
    };
    const saatLuring = () => langkah({ jenis: "luring" });
    const saatDaring = () => {
      void hitung().then(() => {
        if (aktif) langkah({ jenis: "daring" });
      });
    };

    langkah({ jenis: "hitung", belum: 0 });
    void hitung();
    window.addEventListener(PERISTIWA_ANTREAN, saatAntreanBerubah);
    window.addEventListener("online", saatDaring);
    window.addEventListener("offline", saatLuring);
    return () => {
      aktif = false;
      henti(tenang);
      henti(batas);
      hentiUlang();
      window.removeEventListener(PERISTIWA_ANTREAN, saatAntreanBerubah);
      window.removeEventListener("online", saatDaring);
      window.removeEventListener("offline", saatLuring);
      setLuring({ luring: false, belumTerkirim: 0, mengirim: false });
    };
  }, [tautanAntrean]);

  return null;
}
