/*
 * Teks kapsul pulau status — murni. Kunci i18n ada di namespace `pulau`;
 * pemanggilnya (`PulauStatus`) menyerahkan penerjemahnya.
 */
import type { ButirTampilan } from "./keadaan";

export type PenerjemahPulau = (kunci: string, nilai?: Record<string, string | number>) => string;

export type TeksKapsul = {
  judul: string;
  keterangan?: string;
  /** Label tombol kecil di ujung kapsul (mis. "Kirim"). */
  tombol?: string;
  /** Persen proses yang tampil; null = belum diketahui. */
  persen?: number | null;
  /** Kalimat untuk pembaca layar — tanpa persen yang berubah-ubah. */
  diumumkan: string;
};

export function teksButir(b: ButirTampilan, t: PenerjemahPulau): TeksKapsul {
  const jumlah = b.jumlah ?? 0;
  const sebut = (judul: string, lain: Omit<TeksKapsul, "judul" | "diumumkan"> = {}): TeksKapsul => ({
    judul,
    ...lain,
    diumumkan: lain.keterangan ? `${judul}. ${lain.keterangan}` : judul,
  });
  switch (b.jenis) {
    case "luring":
      return sebut(jumlah > 0 ? `${t("tanpaSinyal")} · ${t("belumTerkirim", { count: jumlah })}` : t("tanpaSinyal"));
    case "mengirim":
      return sebut(t("mengirim"));
    case "terkirim":
      return sebut(t("terkirim"));
    case "sisa":
      return sebut(t("belumTerkirim", { count: jumlah }));
    case "tertunda":
      return sebut(t("belumTerkirim", { count: jumlah }), { tombol: t("kirim") });
    case "notifikasi": {
      const kepala = t("notifikasiBaru", { count: Math.max(1, jumlah) });
      return sebut(b.teks ? `${kepala} · ${b.teks}` : kepala);
    }
    case "proses":
      return { judul: b.teks, persen: b.persen ?? null, diumumkan: b.teks };
    default:
      return sebut(b.teks, b.keterangan ? { keterangan: b.keterangan } : {});
  }
}
