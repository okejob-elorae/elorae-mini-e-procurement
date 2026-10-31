"use client";

import type { ReactNode } from "react";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";

/**
 * ⓘ di samping judul layar HP. Penjelasan layar dibaca di panel dari bawah,
 * bukan di layar (keputusan pemilik 2026-10-05); "semua penjelasan" membuka
 * `/pwa/bantuan`, bukan Bantuan kantor. `judul` hanya cadangan bila rute
 * belum punya entri.
 */
export function TombolBantuanHp({ judul }: { judul: ReactNode }) {
  return <TombolBantuan judul={judul} sisi="bottom" semuaHref="/pwa/bantuan" />;
}
