import type { BatalkanPOResult } from "@/app/actions/purchase-orders";

/*
 * Pesan penolakan `batalkanPO` untuk layar PO (daftar dan detail).
 * - PIN_DITOLAK membawa kunci `security.*` dari pemeriksa PIN (mis. `pinIncorrect`);
 * - kode lain memakai `purchaseOrders.batal.err.<kode>`.
 * `ulangiPin` = penolakan yang bisa diperbaiki dengan mengetik PIN lagi, jadi
 * jendela PIN tetap terbuka dan pesannya tampil di dalamnya.
 */

export type TolakBatalPo = Extract<BatalkanPOResult, { ok: false }>;

export type PesanTolakBatalPo = {
  ruang: "security" | "purchaseOrders";
  kunci: string;
  ulangiPin: boolean;
};

export function pesanTolakBatalPo(hasil: TolakBatalPo): PesanTolakBatalPo {
  if (hasil.code === "PIN_DITOLAK") {
    return { ruang: "security", kunci: hasil.kunciPesan?.trim() || "pinInvalid", ulangiPin: true };
  }
  return { ruang: "purchaseOrders", kunci: `batal.err.${hasil.code}`, ulangiPin: hasil.code === "PIN_WAJIB" };
}
