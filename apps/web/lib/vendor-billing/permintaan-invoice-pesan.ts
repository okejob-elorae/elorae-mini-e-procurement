import { tautanWhatsApp } from "@/lib/salesman/dasbor";

/*
 * Pesan "minta invoice" ke pemasok, disiapkan sistem (keputusan pemilik 2026-11-02, P19: "pesan WhatsApp
 * disiapkan sistem"). Selalu bahasa Indonesia. Hanya MEMBUKA WhatsApp — orang kantor yang membaca,
 * mengubah, dan menekan kirim. Murni.
 */

export const SALURAN_PERMINTAAN = ["WHATSAPP", "TELEPON", "EMAIL", "LANGSUNG", "LAINNYA"] as const;
export type SaluranPermintaan = (typeof SALURAN_PERMINTAAN)[number];

const rupiah = (sen: number) => `Rp ${(Math.round(sen) / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const qtyTeks = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** "3 Nov 2026" dari "YYYY-MM-DD". */
function tanggalPendek(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][m - 1] ?? "";
  return `${d} ${bulan} ${y}`;
}

export function susunPesanMintaInvoice(m: {
  namaPemasok: string;
  baris: ReadonlyArray<{ nomor: string; keterangan: string; tanggal: string; qty: number; nilaiSen: number | null }>;
  ulang?: { tanggal: string } | null;
  catatan?: string | null;
}): string {
  const bagian: string[] = [];
  bagian.push(`Halo ${m.namaPemasok},`);
  bagian.push(
    m.ulang
      ? `Menindaklanjuti permintaan kami tanggal ${tanggalPendek(m.ulang.tanggal)}, kami belum menerima invoice untuk penerimaan berikut:`
      : "Mohon dikirimkan invoice untuk penerimaan berikut:",
  );
  let totalSen = 0;
  let adaTakDiketahui = false;
  for (const b of m.baris) {
    const nilai = b.nilaiSen == null ? "nilai belum tercatat" : rupiah(b.nilaiSen);
    if (b.nilaiSen == null) adaTakDiketahui = true;
    else totalSen += b.nilaiSen;
    const diterima = b.tanggal ? `, diterima ${tanggalPendek(b.tanggal)}` : "";
    const barang = b.keterangan ? `${b.keterangan} ` : "";
    bagian.push(`- ${b.nomor}${diterima}: ${barang}${qtyTeks(b.qty)} pcs — ${nilai}`);
  }
  if (m.baris.length > 1 || adaTakDiketahui) bagian.push(`Total: ${rupiah(totalSen)}${adaTakDiketahui ? " (di luar yang nilainya belum tercatat)" : ""}`);
  const catatan = m.catatan?.trim();
  if (catatan) bagian.push(catatan);
  bagian.push("Terima kasih.");
  return bagian.join("\n");
}

/** Tautan WhatsApp ke nomor pemasok; tanpa nomor yang sah, ke wa.me/?text= (pilih penerima sendiri). */
export function tautanWaPermintaan(telepon: string | null | undefined, pesan: string): string {
  return tautanWhatsApp(telepon, pesan) ?? `https://wa.me/?text=${encodeURIComponent(pesan)}`;
}
