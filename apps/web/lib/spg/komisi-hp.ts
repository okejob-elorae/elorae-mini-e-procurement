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
export type RincianGajiHp = {
  gajiBulanan: number;
  penuh: boolean;
  sumberPembagi: "JADWAL" | "STANDAR";
  pembagi: number;
  tarifHarian: number;
  hariTerjadwal: number;
  hariIzin: number;
  hariTidakMasuk: number;
  tanggalTidakMasuk: string[];
  hariMasukLibur: number;
  tanggalMasukLibur: string[];
  hariDariCatatan: number;
  gajiPokok: number;
};

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
    /** Bulan pembayaran; null selama laporannya belum ditutup kantor. */
    bulanBayarLabel: string | null;
    toko: string;
    gaji: number;
    /** Rincian gaji pokok (tanggal sudah diformat); null kalau belum ada. */
    rincianGaji: RincianGajiHp | null;
    komisi: number;
    /** Angka sebelumnya yang diganti komisi dari penjualannya sendiri; null kalau sama. */
    komisiLama: number | null;
    total: number;
    potonganHilang: number;
    potonganRetur: number;
    potonganUtang: number;
    dariKomisi: number;
    dariGaji: number;
    /** Koreksi bulan lain yang ikut pembayaran ini (sudah diterapkan, atau ikut saat dibayar). */
    koreksi: { bulanLabel: string; toko: string; jumlah: number; gaji: number; diterapkan: boolean; dibawa: number }[];
    /** Yang benar-benar diterima. */
    diterima: number;
    potong: number | null;
    ditetapkanLabel: string | null;
    dibayarLabel: string | null;
    /** Pembayarannya menunggu (P60): sebabnya dan bulannya — TANPA rupiah apa pun. */
    ditahan: string | null;
    hariTahanLabel: string[];
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

/**
 * Yang benar-benar dibayarkan sebuah baris yang SUDAH dibayar, dari angka yang tersimpan: gaji
 * pokok + komisi (`total`) + koreksi yang diterapkan padanya (plus dan minus) + pengembalian beban
 * − beban barang hilang − beban retur pembeli − utang yang dipotong. Urutannya sama dengan rencana
 * bayarnya (`rencanaBayarKomisi`): koreksi plus masuk kantongnya DULU, baru pengurang diambil dari
 * sana — jadi tidak dipotong ke nol sebelum koreksi ditambahkan (gaji 0, komisi 10.000, koreksi
 * +20.000, barang hilang 25.000 → 5.000, bukan 20.000). Hasilnya tidak di bawah nol (dalam sen).
 */
export function dibayarkanTersimpan(r: {
  total: number;
  potonganHilang: number;
  potonganRetur: number;
  potonganUtang: number;
  kembali: number;
  koreksi: number;
}): number {
  const sen = Math.round(r.total * 100) + Math.round(r.koreksi * 100) + Math.round(r.kembali * 100) -
    Math.round(r.potonganHilang * 100) - Math.round(r.potonganRetur * 100) - Math.round(r.potonganUtang * 100);
  return Math.max(0, sen) / 100;
}

export function payloadGajiHp(
  g: {
    perkiraan: PerkiraanKomisiHp | null;
    resmi: readonly KomisiResmiHp[];
    koreksiMenunggu?: ReadonlyArray<{ bulanJual: string; toko: string; jumlah: number }>;
  },
  konsi: boolean,
  f: { bulan: (periode: string) => string; tanggal: (iso: string) => string; hari?: (day: string) => string },
): PayloadGajiHp {
  const p = g.perkiraan;
  const hari = f.hari ?? ((d: string) => d);
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
    resmi: g.resmi.map((r) => {
      // Baris yang ditahan tidak membawa rupiah sama sekali — tidak juga di JSON-nya.
      const tahan = r.ditahan !== null;
      const rg = r.rincianGaji;
      return {
        kunci: r.kunci,
        jenis: r.jenis,
        bulanJualLabel: f.bulan(r.bulanJual),
        bulanBayarLabel: r.bulanBayar ? f.bulan(r.bulanBayar) : null,
        toko: r.toko,
        gaji: tahan ? 0 : r.gaji,
        rincianGaji:
          !tahan && rg
            ? {
                gajiBulanan: rg.gajiBulanan,
                penuh: rg.penuh,
                sumberPembagi: rg.sumberPembagi,
                pembagi: rg.pembagi,
                tarifHarian: rg.tarifHarian,
                hariTerjadwal: rg.hariTerjadwal,
                hariIzin: rg.hariIzin,
                hariTidakMasuk: rg.hariTidakMasuk,
                tanggalTidakMasuk: rg.tanggalTidakMasuk.map(hari),
                hariMasukLibur: rg.hariMasukLibur,
                tanggalMasukLibur: rg.tanggalMasukLibur.map(hari),
                hariDariCatatan: rg.hariDariCatatan,
                gajiPokok: rg.gajiPokok,
              }
            : null,
        komisi: tahan ? 0 : r.komisi,
        komisiLama: tahan ? null : r.komisiLama,
        total: tahan ? 0 : r.total,
        potonganHilang: tahan ? 0 : r.potonganHilang,
        potonganRetur: tahan ? 0 : r.potonganRetur,
        potonganUtang: tahan ? 0 : r.potonganUtang,
        dariKomisi: tahan ? 0 : r.dariKomisi,
        dariGaji: tahan ? 0 : r.dariGaji,
        koreksi: tahan ? [] : r.koreksi.map((k) => ({ bulanLabel: f.bulan(k.bulanJual), toko: k.toko, jumlah: k.jumlah, gaji: k.gaji, diterapkan: k.diterapkan, dibawa: k.dibawa })),
        diterima: tahan ? 0 : r.diterima,
        potong: tahan ? null : r.potong,
        ditetapkanLabel: r.ditetapkan ? f.tanggal(r.ditetapkan) : null,
        dibayarLabel: r.dibayar ? f.tanggal(r.dibayar) : null,
        ditahan: r.ditahan,
        hariTahanLabel: tahan ? r.hariTahan.map(hari) : [],
      };
    }),
    koreksiMenunggu: (g.koreksiMenunggu ?? []).map((k) => ({ bulanLabel: f.bulan(k.bulanJual), toko: k.toko, jumlah: k.jumlah })),
  };
}
