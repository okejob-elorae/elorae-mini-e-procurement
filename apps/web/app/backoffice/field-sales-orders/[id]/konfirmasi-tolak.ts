import type { FieldSalesOrderType } from "@/lib/field-sales/queries";

export type KunciKonfirmasiTolak =
  | "rejectConfirm"
  | "rejectConfirmKonsi"
  | "rejectConfirmPreorder"
  | "rejectConfirmUnknown";

/**
 * Kalimat konfirmasi "Tolak" untuk pesanan yang masih menunggu persetujuan.
 *
 * Hanya putus biasa yang sudah mencadangkan stok (saat dibuat). Konsi baru
 * dicadangkan saat disetujui; pre-order tidak pernah dicadangkan selama masih
 * menunggu — sebelum rilis stoknya menunggu rilis, sesudah rilis ia dicadangkan
 * saat disetujui. `preorder === undefined` berarti pemanggil tidak mengirim
 * keadaannya: pakai kalimat yang benar untuk semua kasus.
 */
export function kunciKonfirmasiTolak(
  orderType: FieldSalesOrderType,
  preorder: { dirilis: boolean } | null | undefined,
): KunciKonfirmasiTolak {
  if (orderType === "KONSI") return "rejectConfirmKonsi";
  if (preorder === undefined) return "rejectConfirmUnknown";
  if (preorder) return "rejectConfirmPreorder";
  return "rejectConfirm";
}
