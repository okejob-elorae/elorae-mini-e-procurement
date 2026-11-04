"use server";

import {
  batalkanPenolakanReturPembeliAction as batalkanPenolakan,
  catatReturPembeliAction as catatRetur,
  catatUangDikembalikanAction as catatUangKembali,
  putuskanBarangReturPembeliAction as putuskanBarang,
  setujuiReturPembeliAction as setujuiRetur,
  tarikReturPembeliAction as tarikRetur,
  tolakReturPembeliAction as tolakRetur,
  ubahBesarBebanSpgAction as ubahBesarBeban,
  type HasilPutusanReturPembeliAksi,
  type HasilReturPembeliAksi,
} from "./retur-spg";


/**
 * Alamat lama aksi retur pembeli SPG. Aturannya SATU, di `./retur-spg` (keputusan pemilik
 * 2026-11-02, P12–P14, P77–P83): melapor dengan foto barang dan jawaban uang, mencatat uang yang
 * dikembalikan kasir dengan foto struk, menarik laporan, menyetujui, menolak (termasuk beban SPG),
 * membatalkan penolakan yang keliru, mengubah besar beban, dan memutuskan barangnya.
 *
 * Berkas ini hanya meneruskan, supaya pemanggil yang masih mengimpor alamat ini — antrean HP dan
 * layar kantor — memakai skema dan izin yang sama, bukan salinan lama yang berbeda. Pemanggil baru
 * mengimpor `@/app/actions/retur-spg`.
 */

export async function catatReturPembeliAction(input: unknown): Promise<HasilReturPembeliAksi> {
  return catatRetur(input);
}

export async function setujuiReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return setujuiRetur(input);
}

export async function tolakReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return tolakRetur(input);
}

export async function tarikReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return tarikRetur(input);
}

export async function catatUangDikembalikanAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return catatUangKembali(input);
}

export async function batalkanPenolakanReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return batalkanPenolakan(input);
}

export async function putuskanBarangReturPembeliAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return putuskanBarang(input);
}

export async function ubahBesarBebanSpgAction(input: unknown): Promise<HasilPutusanReturPembeliAksi> {
  return ubahBesarBeban(input);
}
