"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { ATRIBUT_MASUK, bacaMasuk, hapusMasuk, PERISTIWA_TIRAI_BUKA } from "@/lib/login/masuk";
import { HausElorae } from "./HausElorae";
import { LayarMasuk } from "./LayarMasuk";
import gaya from "./layar-masuk.module.css";

/**
 * Animasi masuk, di halaman pertama sesudah halaman masuk (halaman masuk
 * sendiri langsung pindah, tanpa layar hitam).
 *
 * Dipasang di tata letak akar, jadi berlaku ke mana pun pengguna dikirim —
 * backoffice, PWA sales, atau layar gudang. Markupnya SELALU ada di HTML
 * server tapi tersembunyi; ia hanya tampil kalau skrip `<head>` menemukan
 * serah terima dari halaman masuk (`lib/login/masuk.ts`). Dengan begitu
 * bingkai pertama halaman tujuan sudah bertirai — tidak ada kedipan dasbor.
 *
 * Sejak 2026-10-01 (pilihan pemilik) tirai memutar pertunjukan 3D "HAUS
 * ELORAÉ" ±11 detik (`HausElorae`) dengan warna mengikuti tema pengguna,
 * sementara halaman tujuan selesai dimuat di bawahnya. Ketuk/Esc melewatinya.
 * Penutup polos berwarna latar dasbor tetap terpasang sampai bingkai 3D
 * pertama terlukis, jadi dasbor tidak berkedip selagi Three.js diunduh — dan
 * tidak ada layar hitam (dilepas atas permintaan pemilik). Perangkat yang
 * meminta gerak dikurangi tetap mendapat pudar singkat.
 */

/** Sepanjang animasi `pudarKeluar` di CSS. */
const BUKA_MS = 300;

type Keadaan = "server" | "gerak" | "buka" | "selesai";

export function TiraiLanjutan() {
  const [keadaan, setKeadaan] = useState<Keadaan>("server");
  const [kanvasSiap, setKanvasSiap] = useState(false);

  useLayoutEffect(() => {
    const aktif = document.documentElement.hasAttribute(ATRIBUT_MASUK);
    if (!aktif || !bacaMasuk()) {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
      return;
    }
    // Serah terima dipakai sekali: memuat ulang di tengah pertunjukan tidak
    // memutarnya lagi.
    hapusMasuk();
    setKeadaan(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "buka" : "gerak");
  }, []);

  useEffect(() => {
    if (keadaan !== "buka") return;
    window.dispatchEvent(new Event(PERISTIWA_TIRAI_BUKA));
    const id = window.setTimeout(() => {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
    }, BUKA_MS);
    return () => window.clearTimeout(id);
  }, [keadaan]);

  if (keadaan === "selesai") return null;

  if (keadaan === "gerak") {
    return (
      <>
        {kanvasSiap ? null : <LayarMasuk tahap="tahan" className={gaya.lanjutan} />}
        <HausElorae
          onSiap={() => setKanvasSiap(true)}
          // Angka beranda mulai naik saat aplikasi tampil, bukan di balik tirai.
          onBuka={() => window.dispatchEvent(new Event(PERISTIWA_TIRAI_BUKA))}
          onSelesai={() => {
            document.documentElement.removeAttribute(ATRIBUT_MASUK);
            setKeadaan("selesai");
          }}
        />
      </>
    );
  }

  return <LayarMasuk tahap={keadaan === "server" ? "tahan" : keadaan} className={gaya.lanjutan} />;
}
