"use client";

import { useEffect } from "react";
import { daftarkanPush } from "@/lib/pwa/push";

/**
 * Menyegarkan token push sekali per sesi, TANPA meminta izin — hanya kalau
 * izinnya sudah diberikan sebelumnya. Token FCM bisa berganti; tanpa ini HP
 * yang sudah menyalakan pemberitahuan pelan-pelan berhenti menerimanya.
 * Tidak menampilkan apa pun.
 */
export function SegarkanPush() {
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      if (sessionStorage.getItem("elorae.push.segar") === "1") return;
      sessionStorage.setItem("elorae.push.segar", "1");
    } catch {
      /* penyimpanan diblokir — segarkan saja */
    }
    void daftarkanPush({ minta: false });
  }, []);
  return null;
}
