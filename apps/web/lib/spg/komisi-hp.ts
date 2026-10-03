import type { DasarKomisi } from "./pengaturan";
import type { GajiKomisi } from "./queries";

/**
 * Isi layar Gaji & komisi di HP SPG — persis yang dikirim ke klien.
 *
 * Murni dan diuji atas JSON-nya: yang boleh ada hanya angka milik SPG itu
 * sendiri dan, pada dasar BAGI_RATA, komisi seluruh toko. Rupiah, nama, dan id
 * rekan setoko tidak pernah ikut.
 */
export type PayloadGajiHp = {
  konsi: boolean;
  perkiraan: {
    bulanLabel: string;
    jenis: "KONSI" | "PUTUS";
    dasar: DasarKomisi;
    bagianSaya: number;
    potongSaya: number;
    /** Hanya BAGI_RATA. */
    totalToko: number | null;
    potongToko: number | null;
    jumlahSpg: number;
  } | null;
  resmi: {
    kunci: string;
    jenis: "KONSI" | "PUTUS";
    bulanLabel: string;
    toko: string;
    gaji: number | null;
    komisi: number;
    total: number;
    /** Beban barang hilang yang dipotong dari pembayaran ini — 0 kalau tidak ada. */
    potonganHilang: number;
    /** Yang benar-benar diterima: total − potongan. */
    diterima: number;
    potong: number | null;
    dasar: DasarKomisi | null;
    ditetapkanLabel: string | null;
    dibayarLabel: string | null;
  }[];
};

export function payloadGajiHp(
  g: GajiKomisi,
  konsi: boolean,
  f: { bulan: (periode: string) => string; tanggal: (iso: string) => string },
): PayloadGajiHp {
  const p = g.perkiraan;
  const bagiRata = p?.dasar === "BAGI_RATA";
  return {
    konsi,
    perkiraan: p
      ? {
          bulanLabel: f.bulan(p.bulan),
          jenis: p.jenis,
          dasar: p.dasar,
          bagianSaya: p.bagianSaya,
          potongSaya: p.potongSaya,
          totalToko: bagiRata ? p.totalToko : null,
          potongToko: bagiRata ? p.potongToko : null,
          jumlahSpg: p.jumlahSpg,
        }
      : null,
    resmi: g.resmi.map((r) => ({
      kunci: r.kunci,
      jenis: r.jenis,
      bulanLabel: f.bulan(r.periode),
      toko: r.toko,
      gaji: r.jenis === "KONSI" ? r.gaji : null,
      komisi: r.komisi,
      total: r.total,
      potonganHilang: r.potonganHilang,
      diterima: Math.max(0, Math.round((r.total - r.potonganHilang) * 100) / 100),
      potong: r.potong,
      dasar: r.dasar,
      ditetapkanLabel: r.ditetapkan ? f.tanggal(r.ditetapkan) : null,
      dibayarLabel: r.dibayar ? f.tanggal(r.dibayar) : null,
    })),
  };
}
