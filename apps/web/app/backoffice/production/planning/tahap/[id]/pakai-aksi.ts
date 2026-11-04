"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/*
 * Menjalankan aksi jadwal dari ruang kerja: satu aksi sekaligus (klik ganda
 * tidak mengirim dua kali), penolakan `{ ok:false, code }` menjadi toast dengan
 * teks `jadwalProduksi.server.err<KODE>`, keberhasilan menyegarkan halaman.
 */

export type HasilAksi = { ok: true } | { ok: false; code: string };

export function usePesanGalat(): (code: string) => string {
  const t = useTranslations("jadwalProduksi.server");
  return useCallback((code: string) => (t.has(`err${code}`) ? t(`err${code}`) : t("errGAGAL")), [t]);
}

export function useAksiRuang() {
  const router = useRouter();
  const pesanGalat = usePesanGalat();
  const berjalan = useRef(false);
  const [sibuk, setSibuk] = useState(false);

  const jalankan = useCallback(
    async (aksi: () => Promise<HasilAksi>, pesanBerhasil: string): Promise<boolean> => {
      if (berjalan.current) return false;
      berjalan.current = true;
      setSibuk(true);
      try {
        const hasil = await aksi();
        if (!hasil.ok) {
          toast.error(pesanGalat(hasil.code));
          return false;
        }
        toast.success(pesanBerhasil);
        router.refresh();
        return true;
      } catch {
        toast.error(pesanGalat("GAGAL"));
        return false;
      } finally {
        berjalan.current = false;
        setSibuk(false);
      }
    },
    [pesanGalat, router],
  );

  return { jalankan, sibuk, pesanGalat };
}
