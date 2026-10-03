"use client";

import { useEffect } from "react";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { setupOrderSync } from "@/lib/pwa/offline/sync";

/**
 * Mengirim antrean HP di halaman MANA PUN, bukan hanya di beranda.
 *
 * Sebelumnya sinkron hanya berjalan selama beranda atau layar "belum terkirim"
 * terbuka. Sales yang melapor pelunasan lalu tinggal di daftar pelunasan tidak
 * pernah mengirimnya sampai kembali ke beranda. Setiap flush berkunci-jalan,
 * jadi layar lain yang ikut memasang sinkron tidak mengirim dua kali.
 */
export function SinkronLatar() {
  useEffect(() => setupOrderSync(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN))), []);
  return null;
}
