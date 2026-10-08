"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { BarisPohon } from "@/lib/finance/reports/tampil-pohon";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";

/*
 * Potongan bersama versi cetak laporan keuangan (`/print/finance/*`): buka
 * dialog cetak sesudah laporan termuat, keadaan memuat/gagal, kepala laporan,
 * dan baris pohon akun (aturan `barisPohon`, sama dengan layar dan Excel).
 * Teks cetak berbahasa Indonesia dan tidak melalui next-intl — halaman cetak
 * tidak punya penyedia bahasa (lihat `lib/finance/reports/disclosures.ts`).
 */

/** Buka dialog cetak sekali, sesudah DOM laporan selesai digambar. */
export function useCetakOtomatis(siap: boolean) {
  const printedRef = useRef(false);
  useEffect(() => {
    if (!siap || printedRef.current) return;
    printedRef.current = true;
    /*
     * Jeda supaya DOM selesai digambar sebelum dialog cetak terbuka (pelajaran
     * dari cetak perintah kerja). Teardown melepas penjaga, jadi pemanggilan
     * ganda Strict Mode tetap mencetak sekali.
     */
    const timer = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(timer);
      printedRef.current = false;
    };
  }, [siap]);
}

export function MemuatCetak() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
    </div>
  );
}

export function GagalCetak() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-1 text-center">
      <p className="font-bold">Gagal memuat laporan.</p>
      <p className="text-sm text-gray-600">Anda mungkin tidak memiliki akses ke laporan keuangan. Tutup tab ini dan kembali.</p>
    </div>
  );
}

export function KepalaCetak({ judul, periode, disiapkanOleh, dicetak }: { judul: string; periode: string; disiapkanOleh: string; dicetak: string }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-lg font-bold">Elorae</h1>
      <h2 className="text-base font-semibold">{judul}</h2>
      <p className="text-sm">{periode}</p>
      <p className="mt-1 text-xs text-gray-600">Disiapkan oleh: {disiapkanOleh}</p>
      <p className="text-xs text-gray-600">Dicetak: {dicetak}</p>
    </div>
  );
}

/**
 * Baris pohon satu kolom nilai untuk tabel cetak tiga kolom (keterangan |
 * rincian | jumlah): induk tanpa angka, rincian di kolom kedua, subtotal
 * "Jumlah …" di kolom ketiga.
 */
export function barisPohonCetak(rows: BarisPohon[]): React.ReactNode[] {
  return rows.map((b) => {
    const gaya = { paddingLeft: `${b.level * 16 + 8}px` };
    if (b.jenis === "judul") {
      return (
        <tr key={`j-${b.accountId}`}>
          <td className="py-1 font-medium" style={gaya} colSpan={3}>
            <span className="font-mono text-xs text-gray-500">{b.code}</span> {b.name}
          </td>
        </tr>
      );
    }
    if (b.jenis === "jumlah") {
      return (
        <tr key={`s-${b.accountId}`}>
          <td className="py-1 font-medium" style={gaya}>
            Jumlah {b.name}
          </td>
          <td />
          <td className="border-t border-gray-400 py-1 text-right font-medium">{rupiahLaporan(b.nilai[0])}</td>
        </tr>
      );
    }
    return (
      <tr key={`a-${b.accountId}${b.sendiriInduk ? "-sendiri" : ""}`} className="border-b border-gray-200">
        <td className="py-1" style={gaya}>
          <span className="font-mono text-xs text-gray-500">{b.code}</span> {b.name}
        </td>
        <td className="py-1 text-right">{rupiahLaporan(b.nilai[0])}</td>
        <td />
      </tr>
    );
  });
}
