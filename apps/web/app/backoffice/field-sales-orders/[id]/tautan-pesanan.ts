import { daftarPiutang, type BarisPiutang } from "@/lib/receivables/queries";
import type { KeadaanPiutang } from "@/lib/receivables/rules";
import type { FakturPanelKredit } from "@/lib/field-sales/kredit-panel";
import { formatDisplayDate } from "@/lib/date-only";
import { keadaanFakturKredit, type KeadaanFakturKredit } from "./faktur-kredit";

/**
 * Bahan tautan rincian pesanan ke langkah berikutnya (penagihan): keadaan piutang
 * SESUNGGUHNYA (dihitung ulang dari klaim oleh `daftarPiutang`, bukan kolom `outstanding`)
 * untuk faktur di panel Kredit toko dan untuk piutang yang lahir dari tiap nota pengiriman.
 * Satu kueri piutang untuk keduanya.
 */

export type FakturKreditTampil = FakturPanelKredit & {
  /** Tanggal janji bayar (tukar faktur) yang berjalan, sudah diformat WIB; null = tanpa janji. */
  janjiBayar: string | null;
  keadaanTampil: KeadaanFakturKredit;
  /** Keadaan piutang untuk tautan `/backoffice/piutang?keadaan=`; null = tidak terbaca. */
  keadaanPiutang: KeadaanPiutang | null;
};

/** Piutang dari satu nota pengiriman, per `deliveryId`. */
export type PiutangKiriman = { sisa: number; keadaan: KeadaanPiutang; invoiceNo: string };

/**
 * Piutang dan faktur pajak tiap nota hanya dikirim ke peramban yang boleh membuka halamannya —
 * rincian pesanan tidak boleh menjadi jalan samping ke data penagihan/pajak. Murni.
 */
export function penagihanSesuaiIzin<D extends { receivable: unknown; taxInvoice: unknown }>(
  deliveries: D[],
  izin: { piutang: boolean; fakturPajak: boolean },
): D[] {
  return deliveries.map((d) => ({
    ...d,
    receivable: izin.piutang ? d.receivable : null,
    taxInvoice: izin.fakturPajak ? d.taxInvoice : null,
  }));
}

export async function muatTautanPesanan(input: {
  faktur: FakturPanelKredit[];
  /** Piutang nota pengiriman (`receivableId` per `deliveryId`); kosong bila penonton tidak boleh membaca piutang. */
  piutangNota: Array<{ deliveryId: string; receivableId: string }>;
  hariIni?: Date;
}): Promise<{ faktur: FakturKreditTampil[]; piutangKiriman: Record<string, PiutangKiriman> }> {
  const hariIni = input.hariIni ?? new Date();
  const ids = Array.from(new Set([...input.faktur.map((f) => f.id), ...input.piutangNota.map((p) => p.receivableId)]));
  const baris: BarisPiutang[] = ids.length > 0 ? await daftarPiutang({ receivableIds: ids }) : [];
  const byId = new Map(baris.map((b) => [b.id, b]));

  const faktur = input.faktur.map((f): FakturKreditTampil => {
    const b = byId.get(f.id);
    if (!b) return { ...f, janjiBayar: null, keadaanTampil: f.lewat ? { jenis: "LEWAT_JANJI", hari: f.hariTerlambat ?? 0 } : { jenis: "BELUM_TEMPO" }, keadaanPiutang: null };
    const janji = b.alasan.janjiBayar ? new Date(b.alasan.janjiBayar) : null;
    return {
      ...f,
      janjiBayar: janji ? formatDisplayDate(janji) : null,
      keadaanTampil: keadaanFakturKredit({ jatuhTempo: new Date(b.dueDate), janjiBayar: janji, lewatJanji: b.keadaan === "lewat", hariIni }),
      keadaanPiutang: b.keadaan,
    };
  });

  const piutangKiriman: Record<string, PiutangKiriman> = {};
  for (const p of input.piutangNota) {
    const b = byId.get(p.receivableId);
    if (b) piutangKiriman[p.deliveryId] = { sisa: b.outstanding, keadaan: b.keadaan, invoiceNo: b.invoiceNo };
  }
  return { faktur, piutangKiriman };
}
