import type { Prisma } from "@elorae/db";
import { tanggalMulaiSah } from "@/lib/finance/periode/tanggal-mulai-aturan";

/**
 * Gerbang tagihan barang sesudah tanggal mulai buku besar.
 *
 * Pemilik (2026-10-08): semua penagihan barang ke toko lewat nota tagihan dari
 * pengiriman pesanan — nota itu otomatis menjadi piutang dan masuk antrean
 * faktur pajak. "Faktur manual" dan "Impor faktur" tidak membawa barang, jadi
 * tagihan dari sana tidak mengurangi stok dan tidak punya HPP. Sejak tanggal
 * mulai buku besar keduanya ditolak; sebelum tanggal itu mereka tetap jalan
 * pemindahan tagihan lama (yang masuk saldo awal). Tagihan yang dilahirkan
 * SISTEM (beban selisih retur yang ditanggung toko) tidak lewat gerbang ini.
 */

const WIB_MS = 7 * 60 * 60 * 1000;

/** Hari WIB "YYYY-MM-DD" dari sebuah saat. */
function hariWib(tanggal: Date): string {
  return new Date(tanggal.getTime() + WIB_MS).toISOString().slice(0, 10);
}

/** true bila tanggal tagihan jatuh PADA atau SESUDAH tanggal mulai buku (per hari WIB). */
export function tagihanSesudahMulaiBuku(tanggalTagihan: Date, tanggalMulai: string | null): boolean {
  if (!tanggalMulai) return false;
  return hariWib(tanggalTagihan) >= tanggalMulai;
}

type KlienSetelan = { systemSetting: Pick<Prisma.TransactionClient["systemSetting"], "findUnique"> };

/**
 * Tanggal mulai buku besar untuk gerbang ini.
 *
 * Aturan tesnya SAMA dengan `bulanMulaiBuku` di `packages/db/src/period-lock.ts`:
 * di bawah vitest pengaturan basis data bersama tidak dibaca — bed dev punya
 * tanggal mulai sungguhan dan tes lain membuat tagihan bertanggal bebas. Tes
 * yang menguji gerbang ini memberi `UJI_TANGGAL_MULAI_BUKU` ("YYYY-MM-DD"),
 * atau `setelan` untuk membaca pengaturan sungguhan.
 */
export async function bacaTanggalMulaiTagihan(klien: KlienSetelan): Promise<string | null> {
  if (process.env.VITEST) {
    const uji = process.env.UJI_TANGGAL_MULAI_BUKU;
    if (!uji) return null;
    if (uji !== "setelan") return tanggalMulaiSah(uji);
  }
  const baris = await klien.systemSetting.findUnique({
    where: { key: "finance.glCutoverDate" },
    select: { value: true },
  });
  return tanggalMulaiSah(baris?.value);
}
