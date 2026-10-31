"use client";

import { ReportExportButtons } from "../ReportExportButtons";

type HasilEkspor = { ok: true; base64: string; filename: string } | { ok: false; kode: string };

/**
 * Tombol Excel + cetak untuk laporan lanjutan. Aksinya mengembalikan
 * `{ ok: false, kode }` alih-alih melempar; di sini kegagalan dijadikan galat
 * supaya `ReportExportButtons` menampilkan "Ekspor gagal".
 */
export function EksporLaporan({ ekspor, hrefCetak }: { ekspor: () => Promise<HasilEkspor>; hrefCetak: string }) {
  return (
    <ReportExportButtons
      onExcel={async () => {
        const r = await ekspor();
        if (!r.ok) throw new Error(r.kode);
        return { base64: r.base64, filename: r.filename };
      }}
      printHref={hrefCetak}
    />
  );
}
