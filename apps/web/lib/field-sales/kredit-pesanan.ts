import { formatIDR } from "@/lib/sales-orders/format";
import type { AlasanKredit, HasilKredit, ModeKredit } from "@/lib/salesman/kredit";

/**
 * Kredit toko pada pesanan PUTUS — bagian yang murni: keputusan saat pesanan
 * dibuat dan catatan keadaan tagihan yang ikut disimpan di pesanan.
 *
 * Penilaiannya sendiri (`nilaiKredit`) ada di `lib/salesman/kredit.ts` dan
 * dipakai bersama layar HP serta layar persetujuan. Berkas ini hanya
 * menerjemahkan hasil penilaian menjadi apa yang ditulis penulis pesanan.
 * Toko konsinyasi tidak pernah sampai ke sini — mereka tidak punya piutang.
 */

/** Mode BLOKIR menolak pesanan sejak dibuat. Membawa alasannya supaya HP bisa menyebut angkanya. */
export class KreditDiblokirError extends Error {
  constructor(public alasan: AlasanKredit[]) {
    super("KREDIT_DIBLOKIR");
    this.name = "KreditDiblokirError";
  }
}

/** Pesanan yang ditahan (mode TAHAN) hanya boleh disetujui setelah penyetuju menyatakan sudah memeriksa tagihan. */
export class KreditBelumDiperiksaError extends Error {
  constructor(public orderId: string) {
    super("KREDIT_BELUM_DIPERIKSA");
    this.name = "KreditBelumDiperiksaError";
  }
}

/**
 * Satu alasan dalam kalimat pendek berbahasa Indonesia. Dipakai untuk catatan
 * yang DISIMPAN di pesanan — teks di layar dirakit dari `alasan` lewat i18n,
 * jadi hanya catatan tersimpan yang memakai kalimat tetap ini.
 */
export function teksAlasanKredit(a: AlasanKredit): string {
  switch (a.kode) {
    case "LEWAT_JANJI":
      return `tagihan lewat janji ${formatIDR(a.nilai)} (${a.faktur} faktur)`;
    case "MELEBIHI_BATAS_NILAI":
      return `sisa ${formatIDR(a.sisaSesudah)} termasuk pesanan ini, dari batas ${formatIDR(a.batas)}`;
    case "MELEBIHI_BATAS_FAKTUR":
      return `${a.faktur} faktur belum lunas dari batas ${a.batas}`;
  }
}

/**
 * Catatan saat tagihan toko gagal dibaca. Bukan "toko bersih": kegagalan
 * membaca tidak boleh terbaca sebagai izin, jadi penyetuju diminta memeriksa.
 */
export const CATATAN_KREDIT_TAK_TERBACA = "Saat dibuat: tagihan toko tidak bisa dibaca — periksa tagihannya sebelum menyetujui.";

export type PutusanKredit =
  | { blokir: true; alasan: AlasanKredit[] }
  | { blokir: false; ditahan: boolean; catatan: string | null };

/**
 * Apa yang ditulis ke pesanan baru.
 *
 * `hasil` null berarti tagihan toko GAGAL dibaca (galat basis data). Pesanan
 * tidak diblokir karenanya — gangguan sistem tidak boleh menghentikan semua
 * penjualan — tapi di mode TAHAN dan BLOKIR pesanan ditahan, supaya aturan
 * pemilik yang ketat tidak lolos diam-diam hanya karena bacaannya gagal.
 */
export function putuskanKreditPesanan(hasil: HasilKredit | null, mode: ModeKredit): PutusanKredit {
  if (hasil === null) {
    return { blokir: false, ditahan: mode !== "PERINGATAN", catatan: CATATAN_KREDIT_TAK_TERBACA };
  }
  if (hasil.tingkat === "BLOKIR") return { blokir: true, alasan: hasil.alasan };
  if (hasil.tingkat === "AMAN") return { blokir: false, ditahan: false, catatan: null };
  return {
    blokir: false,
    ditahan: hasil.tingkat === "TAHAN",
    catatan: `Saat dibuat: ${hasil.alasan.map(teksAlasanKredit).join("; ")}`,
  };
}
