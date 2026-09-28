"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { greetingKey } from "@/lib/auth/login-message";
import { ATRIBUT_MASUK, bacaMasuk, hapusMasuk, namaDepan, type DataMasuk } from "@/lib/login/masuk";
import { LayarMasuk } from "./LayarMasuk";
import gaya from "./layar-masuk.module.css";

/**
 * Paruh kedua animasi masuk, di halaman pertama sesudah halaman masuk.
 *
 * Dipasang di tata letak akar, jadi berlaku ke mana pun pengguna dikirim —
 * backoffice, PWA sales, atau layar gudang. Markupnya SELALU ada di HTML
 * server tapi tersembunyi; ia hanya tampil kalau skrip `<head>` menemukan
 * serah terima dari halaman masuk (`lib/login/masuk.ts`). Dengan begitu
 * bingkai pertama halaman tujuan sudah hitam dengan kartu judulnya — tidak
 * ada kedipan dasbor sebelum tirainya muncul.
 *
 * Tidak pernah menjebak: klik atau tombol apa pun langsung memudarkannya, dan
 * urutannya berjalan dengan pengatur waktu, bukan menunggu data halaman.
 */

/** Kartu judul bertahan sejenak sebelum larut menjadi sapaan. */
const TAHAN_MS = 450;
/** Sapaan: larut masuk (~1,3 detik) lalu cukup lama untuk terbaca. */
const SAPA_MS = 1900;
/** Sepanjang animasi `buka` di CSS: 350 ms jeda + 1000 ms memudar. */
const BUKA_MS = 1400;

type Keadaan = "server" | "tahan" | "sapa" | "buka" | "selesai";

export function TiraiLanjutan() {
  const t = useTranslations("auth");
  const [keadaan, setKeadaan] = useState<Keadaan>("server");
  const [data, setData] = useState<DataMasuk | null>(null);
  const [sapaTampil, setSapaTampil] = useState(false);

  useLayoutEffect(() => {
    const aktif = document.documentElement.hasAttribute(ATRIBUT_MASUK);
    const d = aktif ? bacaMasuk() : null;
    if (!d) {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
      return;
    }
    setData(d);
    setKeadaan("tahan");
  }, []);

  // Tahan → sapa → buka, masing-masing dengan pengatur waktunya sendiri. Klik
  // atau tombol apa pun melompat langsung ke `buka`.
  useEffect(() => {
    if (keadaan !== "tahan" && keadaan !== "sapa") return;
    const lanjut = () => {
      if (keadaan === "tahan") {
        setSapaTampil(true);
        setKeadaan("sapa");
      } else {
        setKeadaan("buka");
      }
    };
    const lewati = () => setKeadaan("buka");
    const id = window.setTimeout(lanjut, keadaan === "tahan" ? TAHAN_MS : SAPA_MS);
    window.addEventListener("keydown", lewati);
    window.addEventListener("pointerdown", lewati);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", lewati);
      window.removeEventListener("pointerdown", lewati);
    };
  }, [keadaan]);

  useEffect(() => {
    if (keadaan !== "buka") return;
    hapusMasuk();
    const id = window.setTimeout(() => {
      document.documentElement.removeAttribute(ATRIBUT_MASUK);
      setKeadaan("selesai");
    }, BUKA_MS);
    return () => window.clearTimeout(id);
  }, [keadaan]);

  if (keadaan === "selesai") return null;

  const nama = namaDepan(data?.nama);
  const salam = t(`greeting.${greetingKey()}`);

  return (
    <LayarMasuk
      tahap={keadaan === "server" ? "tahan" : keadaan}
      className={gaya.lanjutan}
      sapaan={data ? (nama ? t("enterGreeting", { greeting: salam, name: nama }) : salam) : null}
      sapaTampil={sapaTampil}
    />
  );
}
