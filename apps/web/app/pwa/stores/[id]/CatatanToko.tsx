"use client";

import { useTranslations } from "next-intl";
import { PanelCatatanToko } from "@/components/catatan-toko/PanelCatatanToko";
import type { CatatanTampil } from "@/lib/stores/catatan-queries";

/**
 * "Catatan toko" di halaman toko HP — catatan bebas tim untuk toko ini
 * (jam buka, siapa yang memutuskan, cara bayar). Tersemat di atas. Tambah
 * dari lembar bawah; ubah/hapus/semat catatan sendiri (kantor `stores:manage`
 * boleh semua). Data dari `catatanTokoUntuk` (tanggal sudah diformat di server).
 */
export function CatatanToko({ storeId, catatan }: { storeId: string; catatan: CatatanTampil[] }) {
  const t = useTranslations("catatanToko");
  const tersemat = catatan.filter((c) => c.pinned).length;
  return (
    <section className="beranda-kartu space-y-2" aria-labelledby="catatan-toko-judul">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="catatan-toko-judul" className="beranda-judul">
          {t("judul")}
        </h2>
        {catatan.length > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {tersemat > 0 ? t("ringkasTersemat", { count: catatan.length, tersemat }) : t("ringkasJumlah", { count: catatan.length })}
          </span>
        ) : null}
      </div>
      <PanelCatatanToko storeId={storeId} catatan={catatan} bolehTulis sisi="bottom" batasAwal={3} />
    </section>
  );
}
