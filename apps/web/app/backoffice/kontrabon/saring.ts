import type { BarisKontrabon } from "@/lib/receivables/collection-queries";
import { cocokCari } from "../piutang/_daftar/halaman";

/**
 * Saringan daftar kontrabon (`?saring=`, `?cari=`).
 *
 * Bawaannya hanya yang BERJALAN — kontrabon yang selesai (uangnya sudah masuk)
 * atau batal bukan pekerjaan lagi, sama seperti faktur lunas di daftar piutang.
 * `belum` = janji lapangan berjalan yang belum dicocokkan kantor (tautan Beranda).
 */
export type SaringKontrabon = "berjalan" | "belum" | "semua";

export function bacaSaringKontrabon(raw: string | undefined): SaringKontrabon {
  return raw === "belum" || raw === "semua" ? raw : "berjalan";
}

export const perluKonfirmasi = (b: Pick<BarisKontrabon, "status" | "dikonfirmasi">) =>
  b.status === "BERJALAN" && !b.dikonfirmasi;

export function saringKontrabon<
  T extends Pick<BarisKontrabon, "status" | "dikonfirmasi" | "docNo" | "storeName" | "salesmanName" | "receivedBy">,
>(baris: T[], s: { saring: SaringKontrabon; cari: string }): T[] {
  return baris.filter((b) => {
    const lolos =
      s.saring === "semua" ? true : s.saring === "belum" ? perluKonfirmasi(b) : b.status === "BERJALAN";
    return lolos && cocokCari(s.cari, b.docNo, b.storeName, b.salesmanName, b.receivedBy);
  });
}
