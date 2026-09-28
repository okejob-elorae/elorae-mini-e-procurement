"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { durasiCerita, leluconHariIni, type Lelucon } from "@/lib/login/lelucon";
import { ATRIBUT_MASUK, bacaMasuk, hapusMasuk } from "@/lib/login/masuk";
import { LayarMasuk } from "./LayarMasuk";
import gaya from "./layar-masuk.module.css";

/**
 * Paruh kedua animasi masuk, di halaman pertama sesudah halaman masuk:
 * wordmark terus mendekat lalu lewat, lelucon harian muncul dari buram, lalu
 * layar memudar dari gelap ke aplikasi.
 *
 * Dipasang di tata letak akar, jadi berlaku ke mana pun pengguna dikirim —
 * backoffice, PWA sales, atau layar gudang. Markupnya SELALU ada di HTML
 * server tapi tersembunyi; ia hanya tampil kalau skrip `<head>` menemukan
 * serah terima dari halaman masuk (`lib/login/masuk.ts`). Dengan begitu
 * bingkai pertama halaman tujuan sudah bertirai — tidak ada kedipan dasbor.
 *
 * Kendalinya kendali Story: ketuk untuk lanjut, TAHAN untuk jeda (waktu baca
 * ikut berhenti), Esc atau ✕ untuk menutup. Tidak pernah menjebak — tanpa
 * sentuhan apa pun ia berjalan sendiri sampai selesai.
 */

/** Wordmark bertahan sejenak di bingkai pertama sebelum menembus kamera. */
const TAHAN_MS = 350;
/** Sepanjang animasi `buka` di CSS: 350 ms jeda + 900 ms memudar. */
const BUKA_MS = 1300;
/** Tekanan lebih lama dari ini adalah "tahan untuk jeda", bukan ketukan. */
const KETUK_MAKS_MS = 250;

type Keadaan = "server" | "tahan" | "cerita" | "buka" | "selesai";

export function TiraiLanjutan() {
  const t = useTranslations("auth");
  const bahasa = useLocale() === "en" ? "en" : "id";
  const [keadaan, setKeadaan] = useState<Keadaan>("server");
  const [lelucon, setLelucon] = useState<Lelucon | null>(null);
  const [langkah, setLangkah] = useState<0 | 1>(0);
  const [jeda, setJeda] = useState(false);
  /* Wordmark sudah menembus kamera. Tetap benar saat swipe-up, supaya ia tidak
     muncul lagi; tetap salah kalau Esc ditekan sebelum cerita dimulai. */
  const [lewat, setLewat] = useState(false);
  /* Sisa waktu langkah yang sedang berjalan; <= 0 berarti langkah baru. */
  const sisaRef = useRef(0);

  useLayoutEffect(() => {
    const aktif = document.documentElement.hasAttribute(ATRIBUT_MASUK);
    if (!aktif || !bacaMasuk()) {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
      return;
    }
    setLelucon(leluconHariIni());
    setKeadaan("tahan");
  }, []);

  const teks = lelucon ? lelucon[bahasa] : null;
  const durasi = useMemo(() => (teks ? durasiCerita(teks) : null), [teks]);

  const tutup = useEffectEvent(() => {
    setJeda(false);
    setKeadaan("buka");
  });

  const maju = useEffectEvent(() => {
    if (keadaan === "tahan") {
      sisaRef.current = 0;
      setLangkah(0);
      setLewat(true);
      setKeadaan("cerita");
    } else if (keadaan === "cerita" && langkah === 0) {
      sisaRef.current = 0;
      setLangkah(1);
    } else {
      tutup();
    }
  });

  useEffect(() => {
    if (keadaan !== "tahan") return;
    const id = window.setTimeout(maju, TAHAN_MS);
    return () => window.clearTimeout(id);
  }, [keadaan]);

  // Pengatur waktu tiap langkah, yang bisa dijeda: pembersihnya mengurangi
  // waktu yang sudah lewat, jadi setelah jari diangkat langkahnya berlanjut
  // dari sisa waktunya, bukan dari awal.
  useEffect(() => {
    if (keadaan !== "cerita" || jeda || !durasi) return;
    if (sisaRef.current <= 0) sisaRef.current = durasi[langkah];
    const mulai = performance.now();
    const id = window.setTimeout(maju, sisaRef.current);
    return () => {
      window.clearTimeout(id);
      sisaRef.current -= performance.now() - mulai;
    };
  }, [keadaan, langkah, jeda, durasi]);

  useEffect(() => {
    if (keadaan !== "tahan" && keadaan !== "cerita") return;
    let ditekan = 0;
    const turun = () => {
      ditekan = performance.now();
      setJeda(true);
    };
    const naik = (e: PointerEvent) => {
      if (!ditekan) return;
      const lama = performance.now() - ditekan;
      ditekan = 0;
      setJeda(false);
      if (e.target instanceof Element && e.target.closest("[data-tutup]")) tutup();
      else if (lama < KETUK_MAKS_MS) maju();
    };
    const tombol = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        tutup();
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        maju();
      }
    };
    window.addEventListener("pointerdown", turun);
    window.addEventListener("pointerup", naik);
    window.addEventListener("keydown", tombol);
    return () => {
      window.removeEventListener("pointerdown", turun);
      window.removeEventListener("pointerup", naik);
      window.removeEventListener("keydown", tombol);
    };
  }, [keadaan]);

  // Memudar ke aplikasi. Klik yang menutup cerita tidak boleh tembus ke
  // aplikasi yang sedang terbuka di bawahnya — misalnya mengenai menu sidebar.
  useEffect(() => {
    if (keadaan !== "buka") return;
    hapusMasuk();
    const telan = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", telan, true);
    const id = window.setTimeout(() => {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
    }, BUKA_MS);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", telan, true);
    };
  }, [keadaan]);

  if (keadaan === "selesai") return null;

  return (
    <LayarMasuk
      tahap={keadaan === "server" ? "tahan" : keadaan}
      className={gaya.lanjutan}
      lewat={lewat}
      jeda={jeda}
      cerita={
        teks && durasi
          ? {
              pembuka: teks.pembuka,
              punchline: teks.punchline,
              langkah,
              durasi,
              label: t("storyLabel"),
              petunjuk: t("storyHint"),
              tombol: {
                spasi: t("storyKeySpace"),
                lanjut: t("storyKeyNext"),
                tahan: t("storyKeyHold"),
                tutup: t("storyKeyClose"),
              },
            }
          : null
      }
    />
  );
}
