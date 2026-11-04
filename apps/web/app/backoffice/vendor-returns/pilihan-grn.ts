import { grnBelumDiproses } from "@/lib/grn/grn-tanpa-po";

/*
 * Pilihan GRN di formulir retur ke pemasok. GRN tanpa PO yang masih menunggu konfirmasi admin
 * belum diproses (P51a) dan tidak bisa diretur — aksinya menolak dengan `GRN_BELUM_DIPROSES` —
 * jadi tidak ditawarkan. Murni, aman untuk komponen klien.
 */

export type BarisGrnPilihan = {
  id: string;
  requiresNoPoConfirmation: boolean;
  noPoConfirmedAt: Date | string | null;
};

/** `tetapTampil` = GRN yang sudah terpilih di draf, supaya draf yang tersimpan tetap menampilkan pilihannya. */
export function grnBolehDiretur<T extends BarisGrnPilihan>(daftar: readonly T[], tetapTampil?: string | null): T[] {
  return daftar.filter((g) => !grnBelumDiproses(g) || (tetapTampil != null && tetapTampil !== "" && g.id === tetapTampil));
}
