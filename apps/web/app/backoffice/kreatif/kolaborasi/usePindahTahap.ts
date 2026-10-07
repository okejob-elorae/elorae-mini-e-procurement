"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { pindahTahapAction, pindahTahapBanyakAction, type KodeGagalKolaborasi } from "@/app/actions/kreatif-kolaborasi";
import { dinamis } from "@/lib/i18n/dinamis";
import { jenisPindah, type JenisPindah, type Tahap } from "@/lib/creative/tahap";

/** Satu kolaborasi yang akan dipindah: cukup id, tahap sekarang, dan nama KOL untuk pesan. */
export type SasaranPindah = { id: string; tahap: Tahap; kolNama: string };

/** Perpindahan yang menunggu alasan (mundur, keluar, buka lagi). */
export type PindahTertunda = { sasaran: SasaranPindah[]; ke: Tahap; jenis: Exclude<JenisPindah, "MAJU"> };

const KODE_DIKENAL: readonly string[] = [
  "TANPA_AKSES",
  "GAGAL",
  "TIDAK_DITEMUKAN",
  "ALASAN_WAJIB",
  "STATUS_TIDAK_VALID",
  "KOL_DIBLOKIR",
  "CAMPAIGN_DIARSIPKAN",
  "QTY_TIDAK_VALID",
  "BARANG_TIDAK_DITEMUKAN",
  "TIDAK_VALID",
  "NAMA_WAJIB",
  "TANPA_DELIVERABLE",
  "STOK_KURANG",
];

/** Pesan galat kolaborasi; kode yang tidak dikenal jatuh ke "Gagal menyimpan". */
export function useTeksGalatKolaborasi() {
  const t = dinamis(useTranslations("kreatifRuang.kolaborasi.err"));
  return useCallback((kode: KodeGagalKolaborasi | string) => t(KODE_DIKENAL.includes(kode) ? kode : "GAGAL"), [t]);
}

/**
 * Pindah tahap dari tabel, papan, aksi massal, dan halaman rincian — satu
 * jalur supaya aturannya sama di mana-mana:
 *  - maju langsung disimpan (dengan perubahan optimistis + pengembalian bila
 *    ditolak server);
 *  - mundur, keluar, dan buka lagi meminta alasan dulu (`tertunda`);
 *  - perpindahan yang tidak ada di aturan (`jenisPindah` null) ditolak dengan
 *    pesan, tanpa memanggil server.
 *
 * `timpa` = tahap optimistis per id; dikosongkan saat data server berganti
 * (`kunciData`), bukan di efek — data baru sudah memuat tahap yang benar.
 */
export function usePindahTahap(kunciData: unknown) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const galat = useTeksGalatKolaborasi();
  const router = useRouter();
  const [, mulai] = useTransition();
  const [tertunda, setTertunda] = useState<PindahTertunda | null>(null);
  const [timpa, setTimpa] = useState<Record<string, Tahap>>({});
  const [sedang, setSedang] = useState(false);
  const [kunciTerakhir, setKunciTerakhir] = useState(kunciData);
  if (kunciTerakhir !== kunciData) {
    setKunciTerakhir(kunciData);
    setTimpa({});
  }

  const labelTahap = useCallback((x: Tahap) => tk(`tahap.${x}`), [tk]);

  const jalankan = useCallback(
    async (sasaran: SasaranPindah[], ke: Tahap, alasan: string | null) => {
      const ids = sasaran.map((s) => s.id);
      setTimpa((lama) => ({ ...lama, ...Object.fromEntries(ids.map((id) => [id, ke])) }));
      setSedang(true);
      const kembalikan = (gagal: string[]) =>
        setTimpa((lama) => Object.fromEntries(Object.entries(lama).filter(([id]) => !gagal.includes(id))));
      try {
        if (sasaran.length === 1) {
          const r = await pindahTahapAction(ids[0], ke, alasan);
          if (!r.ok) {
            kembalikan(ids);
            toast.error(galat(r.kode));
            return false;
          }
          toast.success(t("kolaborasi.ok.pindah", { kol: sasaran[0].kolNama, tahap: labelTahap(ke) }));
        } else {
          const r = await pindahTahapBanyakAction(ids, ke, alasan);
          if (!r.ok) {
            kembalikan(ids);
            toast.error(galat(r.kode));
            return false;
          }
          kembalikan(r.gagal.map((g) => g.id));
          if (r.gagal.length === 0) {
            toast.success(t("kolaborasi.ok.massal", { n: r.dipindah, tahap: labelTahap(ke) }));
          } else {
            const pesan = t("kolaborasi.ok.massalSebagian", {
              n: r.dipindah,
              tahap: labelTahap(ke),
              gagal: r.gagal.length,
              contoh: galat(r.gagal[0].alasan),
            });
            if (r.dipindah > 0) toast.warning(pesan);
            else toast.error(pesan);
          }
        }
        mulai(() => router.refresh());
        return true;
      } catch {
        kembalikan(ids);
        toast.error(galat("GAGAL"));
        return false;
      } finally {
        setSedang(false);
      }
    },
    [galat, labelTahap, router, t],
  );

  /**
   * Minta perpindahan. Untuk banyak kolaborasi, alasan diminta sekali bila
   * SALAH SATU-nya butuh alasan; yang aturannya menolak dilaporkan server.
   */
  const minta = useCallback(
    (sasaran: SasaranPindah[], ke: Tahap) => {
      const relevan = sasaran.filter((s) => s.tahap !== ke);
      if (relevan.length === 0) return;
      const jenis = relevan.map((s) => jenisPindah(s.tahap, ke));
      if (relevan.length === 1 && jenis[0] === null) {
        toast.error(t("kolaborasi.papan.tidakBisa", { dari: labelTahap(relevan[0].tahap), ke: labelTahap(ke) }));
        return;
      }
      const butuh = jenis.find((j): j is Exclude<JenisPindah, "MAJU"> => j !== null && j !== "MAJU");
      if (butuh) {
        setTertunda({ sasaran: relevan, ke, jenis: butuh });
        return;
      }
      void jalankan(relevan, ke, null);
    },
    [jalankan, labelTahap, t],
  );

  const lanjutDenganAlasan = useCallback(
    (alasan: string) => {
      const p = tertunda;
      setTertunda(null);
      if (p) void jalankan(p.sasaran, p.ke, alasan);
    },
    [jalankan, tertunda],
  );

  const tahapDari = useCallback((id: string, asli: Tahap): Tahap => timpa[id] ?? asli, [timpa]);

  return { minta, tertunda, batalTertunda: () => setTertunda(null), lanjutDenganAlasan, tahapDari, sedang };
}
