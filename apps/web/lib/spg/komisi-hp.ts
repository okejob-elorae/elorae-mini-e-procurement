import type { KomisiResmiHp, PerkiraanKomisiHp } from "./komisi-queries";

/**
 * Isi layar Gaji & komisi di HP SPG — persis yang dikirim ke klien.
 *
 * Murni dan diuji atas JSON-nya: yang boleh ada hanya angka milik SPG itu sendiri. Rupiah, potong,
 * nama, dan id rekan setoko tidak pernah ikut — komisi dihitung dari penjualan masing-masing SPG
 * (tarif per kategori, `lib/spg-commission/payout.ts`), jadi tidak ada "komisi toko" yang dibagi.
 *
 * Setiap pembayaran resmi membawa dua bulan: bulan PEMBAYARANNYA (bulan laporannya dicek kantor)
 * dan bulan PENJUALANNYA sebagai catatan — "Komisi penjualan Oktober 2026", dibayar November.
 */
export type PayloadGajiHp = {
  konsi: boolean;
  perkiraan: {
    bulanLabel: string;
    jenis: "KONSI" | "PUTUS";
    bagianSaya: number;
    potongSaya: number;
    potongTanpaTarif: number;
  } | null;
  resmi: {
    kunci: string;
    jenis: "KONSI" | "PUTUS";
    /** Bulan penjualan, untuk catatan "Komisi penjualan …". */
    bulanJualLabel: string;
    /** Bulan pembayaran; null selama kantor membuka lagi laporannya. */
    bulanBayarLabel: string | null;
    toko: string;
    gaji: number | null;
    komisi: number;
    total: number;
    /** Beban barang hilang yang dipotong dari pembayaran ini — 0 kalau tidak ada. */
    potonganHilang: number;
    /** Yang benar-benar diterima: total − potongan. */
    diterima: number;
    potong: number | null;
    ditetapkanLabel: string | null;
    dibayarLabel: string | null;
    /** Ditetapkan sebelum 2026-11-01 dengan tarif barang. */
    aturanLama: boolean;
  }[];
};

export function payloadGajiHp(
  g: { perkiraan: PerkiraanKomisiHp | null; resmi: readonly KomisiResmiHp[] },
  konsi: boolean,
  f: { bulan: (periode: string) => string; tanggal: (iso: string) => string },
): PayloadGajiHp {
  const p = g.perkiraan;
  return {
    konsi,
    perkiraan: p
      ? {
          bulanLabel: f.bulan(p.bulan),
          jenis: p.jenis,
          bagianSaya: p.bagianSaya,
          potongSaya: p.potongSaya,
          potongTanpaTarif: p.potongTanpaTarifSaya,
        }
      : null,
    resmi: g.resmi.map((r) => ({
      kunci: r.kunci,
      jenis: r.jenis,
      bulanJualLabel: f.bulan(r.bulanJual),
      bulanBayarLabel: r.bulanBayar ? f.bulan(r.bulanBayar) : null,
      toko: r.toko,
      gaji: r.jenis === "KONSI" ? r.gaji : null,
      komisi: r.komisi,
      total: r.total,
      potonganHilang: r.potonganHilang,
      diterima: Math.max(0, Math.round((r.total - r.potonganHilang) * 100) / 100),
      potong: r.potong,
      ditetapkanLabel: r.ditetapkan ? f.tanggal(r.ditetapkan) : null,
      dibayarLabel: r.dibayar ? f.tanggal(r.dibayar) : null,
      aturanLama: r.aturanLama,
    })),
  };
}
