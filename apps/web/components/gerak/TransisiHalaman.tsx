"use client";

import * as React from "react";

/**
 * Transisi halaman bawaan peramban (View Transitions) untuk area konten.
 *
 * Dipasang di `template.tsx`, yang dipasang ulang Next setiap kali bagian
 * (segmen anak) berganti — misalnya Pemasok → Pesanan Pembelian. Saat itu
 * konten baru "masuk" (memudar masuk) sementara halaman lama ikut memudar
 * keluar bersama tangkapan layar halaman. Kepala, menu samping, dan menu
 * bawah HP tidak ikut bergerak: gambarnya sama sebelum dan sesudah.
 *
 * Sengaja hanya MASUK yang dianimasikan:
 *   - `update="none"`: router.refresh, saringan, dan halaman tabel tidak
 *     memicu transisi — semuanya juga berjalan di dalam startTransition.
 *   - `exit="none"`: konten lama TIDAK diberi nama sendiri. Elemen bernama di
 *     dalam area gulir digambar tanpa dipotong area itu, jadi halaman lama
 *     yang sudah digulir akan menimpa kepala selama transisi.
 *
 * `ViewTransition` ada di React yang dibundel Next (19.3 canary) tetapi belum
 * di React stabil dan tipenya. Ia diambil saat berjalan; bila tidak ada
 * (tes, peramban lama tetap aman karena React sendiri memeriksa
 * `document.startViewTransition`), anaknya dirender apa adanya.
 */

type PropsTransisi = {
  children?: React.ReactNode;
  enter?: string;
  exit?: string;
  update?: string;
  share?: string;
  default?: string;
};

const ViewTransitionBawaan = (React as unknown as { ViewTransition?: React.ComponentType<PropsTransisi> })
  .ViewTransition;

export function TransisiHalaman({ children }: { children: React.ReactNode }) {
  if (!ViewTransitionBawaan) return <>{children}</>;
  return (
    <ViewTransitionBawaan enter="auto" exit="none" update="none" share="none" default="none">
      {children}
    </ViewTransitionBawaan>
  );
}
