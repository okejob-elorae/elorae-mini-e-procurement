import type { UpdatePOResult } from "@/app/actions/purchase-orders";

/*
 * Pesan penolakan `updatePO` untuk layar detail PO (simpan edit).
 * - PIN_DITOLAK membawa kunci `security.*` dari pemeriksa PIN (mis. `pinIncorrect`);
 * - kode lain memakai `purchaseOrders.edit.err.<kode>` dengan nilai `barang`/`diterima`.
 * `ulangiPin` = penolakan yang bisa diperbaiki dengan mengetik PIN lagi, jadi
 * jendela PIN tetap terbuka dan pesannya tampil di dalamnya.
 */

export type TolakEditPo = Extract<UpdatePOResult, { ok: false }>;

export type PesanTolakEditPo = {
  ruang: "security" | "purchaseOrders";
  kunci: string;
  nilai: Record<string, string>;
  ulangiPin: boolean;
};

export function pesanTolakEditPo(hasil: TolakEditPo, locale: string): PesanTolakEditPo {
  if (hasil.code === "PIN_DITOLAK") {
    return { ruang: "security", kunci: hasil.kunciPesan?.trim() || "pinInvalid", nilai: {}, ulangiPin: true };
  }
  const nilai: Record<string, string> = {};
  if ("barang" in hasil) nilai.barang = hasil.barang;
  if ("diterima" in hasil) {
    nilai.diterima = new Intl.NumberFormat(locale === "en" ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(
      hasil.diterima,
    );
  }
  return { ruang: "purchaseOrders", kunci: `edit.err.${hasil.code}`, nilai, ulangiPin: hasil.code === "PIN_WAJIB" };
}
