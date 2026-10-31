import { daftarJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { listAccountMappings } from "@/lib/finance/journals/mapping";
import { getNotificationHref } from "@/lib/notifications/navigation";
import { cariInfoDokumen } from "../_sumber/info-dokumen";
import { kunciDokumen, tautanDokumenSumber } from "../_sumber/tautan";
import { jenisDanIdSumber, postingUlangOtomatis } from "./sebab";

/** Satu baris tab "Tertunda" — siap dikirim ke komponen klien (tanpa Date, tanpa Decimal). */
export type BarisJurnalTertunda = {
  id: string;
  dicatatPada: string;
  /** Jenis sumber jurnal (`GRN`, `SUPPLIER_PAYMENT`, …); null = bentuk tak dikenal. */
  jenis: string | null;
  nomor: string | null;
  hrefDokumen: string | null;
  /** Halaman tempat tombol "Post journal" dokumen itu berada. */
  hrefPostingUlang: string | null;
  /** Diposting ulang otomatis begitu sebabnya beres (penjualan marketplace). */
  otomatis: boolean;
  sebab: string | null;
  peran: string | null;
  /**
   * Untuk sebab "peran belum dipetakan": apakah perannya SEKARANG sudah
   * dipetakan ke akun yang jenisnya cocok (dibaca ulang saat halaman dimuat).
   * null = tidak relevan / tidak diketahui.
   */
  peranKiniTerpetakan: boolean | null;
};

/**
 * Isi tab "Tertunda": baris yang sama dengan hitungan Beranda, dilengkapi nomor
 * dokumen dan tautannya. `notifikasiIds` hanya untuk tes di basis data bersama.
 */
export async function muatJurnalTertunda(opts: { notifikasiIds?: string[] } = {}): Promise<BarisJurnalTertunda[]> {
  const daftar = await daftarJurnalTertunda(opts);
  const pasangan = daftar
    .map((r) => jenisDanIdSumber(r.sumber))
    .filter((p): p is { jenis: string; id: string } => p !== null);
  const [info, pemetaan] = await Promise.all([
    cariInfoDokumen(pasangan),
    daftar.some((r) => r.sebab === "UNMAPPED_ROLE") ? listAccountMappings().catch(() => null) : Promise.resolve(null),
  ]);
  const terpetakan = new Set((pemetaan ?? []).filter((m) => m.chartAccountId && m.typeValid).map((m) => m.role as string));

  return daftar.map((r) => {
    const sumber = jenisDanIdSumber(r.sumber);
    const dok = sumber ? info.get(kunciDokumen(sumber.jenis, sumber.id)) : undefined;
    const otomatis = postingUlangOtomatis(sumber?.jenis ?? null);
    return {
      id: r.notifikasiId,
      dicatatPada: r.dicatatPada.toISOString(),
      jenis: sumber?.jenis ?? null,
      nomor: dok?.nomor ?? null,
      hrefDokumen: sumber ? tautanDokumenSumber(sumber.jenis, sumber.id, dok ?? {}) : null,
      // Tombol posting ulang ada di halaman yang dituju lonceng untuk notifikasi yang sama.
      hrefPostingUlang: sumber && !otomatis
        ? getNotificationHref("JOURNAL_PENDING", { ...r.metadata, ...(dok?.canvasserId ? { canvasserId: dok.canvasserId } : {}) })
        : null,
      otomatis,
      sebab: r.sebab,
      peran: r.peran,
      peranKiniTerpetakan: r.sebab === "UNMAPPED_ROLE" && r.peran && pemetaan ? terpetakan.has(r.peran) : null,
    };
  });
}
