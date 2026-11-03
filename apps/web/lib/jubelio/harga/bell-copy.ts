import { capNotificationText } from "@/lib/notifications/text";
import { formatRupiah } from "@/lib/format/rupiah";
import { hargaSama } from "./aturan";

/**
 * Teks lonceng "Harga di Jubelio berbeda dengan ERP" (jawaban pemilik P2, 2026-11-02). Sapuan cron
 * tidak punya bahasa permintaan, jadi teksnya Indonesia di sini. Tanpa harga = "tanpa harga".
 */
export function buildBedaHargaBellCopy(i: {
  sku: string;
  nama: string;
  jubelioTertinggi: string | null;
  jubelioTerendah: string | null;
  hargaTerkonfirmasi: string | null;
}): { title: string; message: string } {
  const rp = (v: string | null) => {
    const n = v == null ? Number.NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? formatRupiah(n) : "tanpa harga";
  };
  const jubelio =
    i.jubelioTertinggi != null && i.jubelioTerendah != null && !hargaSama(i.jubelioTertinggi, i.jubelioTerendah)
      ? `${rp(i.jubelioTerendah)}–${rp(i.jubelioTertinggi)}`
      : rp(i.jubelioTertinggi ?? i.jubelioTerendah);
  return {
    title: capNotificationText("Harga di Jubelio berbeda dengan ERP"),
    message: capNotificationText(`${i.sku} ${i.nama}: di Jubelio ${jubelio}, harga ERP terkonfirmasi ${rp(i.hargaTerkonfirmasi)}.`),
  };
}
