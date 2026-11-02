import type { KomisiResmiHp, PerkiraanKomisiHp } from "./komisi-queries";

/**
 * Isi layar Gaji & komisi di HP SPG — persis yang dikirim ke klien.
 *
 * Murni dan diuji atas JSON-nya: yang boleh ada hanya angka milik SPG itu sendiri. Rupiah, potong,
 * nama, dan id rekan setoko tidak pernah ikut — komisi dihitung dari penjualan masing-masing SPG
 * (tarif per kategori, `lib/spg-commission/payout.ts`), jadi tidak ada "komisi toko" yang dibagi.
 * Koreksi komisinya (selisih bulan yang sudah dibayar, `lib/spg/koreksi.ts`) hanya membawa bulan,
 * toko, dan rupiahnya sendiri.
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
    /** Angka sebelumnya yang diganti komisi dari penjualannya sendiri; null kalau sama. */
    komisiLama: number | null;
    total: number;
    /** Beban barang hilang yang dipotong dari pembayaran ini — 0 kalau tidak ada. */
    potonganHilang: number;
    /** Koreksi komisi bulan lain yang ikut pembayaran ini (sudah diterapkan, atau ikut saat dibayar). */
    koreksi: { bulanLabel: string; toko: string; jumlah: number; diterapkan: boolean; dibawa: number }[];
    /** Yang benar-benar diterima: total − potongan + koreksi. */
    diterima: number;
    potong: number | null;
    ditetapkanLabel: string | null;
    dibayarLabel: string | null;
    /** Dihitung/dibayar dengan aturan lama (tarif barang). */
    aturanLama: boolean;
    /** Pembayarannya menunggu keputusan kantor — tanpa angka "akan diterima". */
    ditahan: boolean;
    /** Siklusnya dibuka lagi kantor: angkanya belum ada — tanpa angka "akan diterima". */
    belumPasti: boolean;
  }[];
  /** Koreksi yang menunggu pembayaran resmi berikutnya (tidak tampil di pembayaran mana pun di atas). */
  koreksiMenunggu: { bulanLabel: string; toko: string; jumlah: number }[];
};

/**
 * Yang benar-benar diterima dari satu pembayaran, sebelum koreksi: total − potongan beban barang
 * hilang, tidak di bawah nol, dalam sen. Satu aturan untuk layar Gaji & komisi dan kartu beranda.
 */
export function jumlahDiterima(r: { total: number; potonganHilang: number }): number {
  return Math.max(0, Math.round((r.total - r.potonganHilang) * 100) / 100);
}

export function payloadGajiHp(
  g: {
    perkiraan: PerkiraanKomisiHp | null;
    resmi: readonly KomisiResmiHp[];
    koreksiMenunggu?: ReadonlyArray<{ bulanJual: string; toko: string; jumlah: number }>;
  },
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
      komisiLama: r.komisiLama,
      total: r.total,
      potonganHilang: r.potonganHilang,
      koreksi: r.koreksi.map((k) => ({ bulanLabel: f.bulan(k.bulanJual), toko: k.toko, jumlah: k.jumlah, diterapkan: k.diterapkan, dibawa: k.dibawa })),
      diterima: r.diterima,
      potong: r.potong,
      ditetapkanLabel: r.ditetapkan ? f.tanggal(r.ditetapkan) : null,
      dibayarLabel: r.dibayar ? f.tanggal(r.dibayar) : null,
      aturanLama: r.aturanLama,
      ditahan: r.ditahan,
      belumPasti: Boolean(r.belumPasti) && !r.dibayar,
    })),
    koreksiMenunggu: (g.koreksiMenunggu ?? []).map((k) => ({ bulanLabel: f.bulan(k.bulanJual), toko: k.toko, jumlah: k.jumlah })),
  };
}
