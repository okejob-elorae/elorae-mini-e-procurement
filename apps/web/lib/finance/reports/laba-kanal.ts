import type { AccountType } from "@/lib/constants/enums";
import { SEMUA_KANAL_JURNAL } from "@/lib/finance/journals/kanal";

/*
 * Laba per kanal dan per toko dari dimensi baris jurnal (`JournalLine.channel`
 * / `storeId`) — murni, aman untuk komponen klien.
 *
 * Hanya akun laba rugi (pendapatan, HPP, beban). Per kelompok:
 *   penjualan        = pendapatan selain akun retur & potongan penjualan
 *   retur, potongan  = akun yang dipetakan ke SALES_RETURN / SALES_DISCOUNT
 *   pendapatan bersih = Σ seluruh akun pendapatan (kontra ikut mengurangi)
 *   laba kotor       = pendapatan bersih − HPP;  margin = laba kotor ÷ pendapatan bersih
 *   beban            = beban yang membawa kanal/toko itu (fee marketplace, KOL, komisi…)
 *   laba kontribusi  = laba kotor − beban
 * Baris tanpa kanal/toko tampil JUJUR sebagai kelompok sendiri ("Tanpa kanal"),
 * berisi beban umum dan jurnal lama — total semua kelompok = laba bersih buku
 * besar, sama dengan Laba Rugi periode yang sama.
 */

export type BarisKanalMentah = {
  kanal: string | null;
  storeId: string | null;
  accountId: string;
  type: AccountType;
  debit: number;
  credit: number;
};

/**
 * Baris jurnal lama tanpa kanal yang kanalnya bisa diturunkan dari dokumen
 * sumbernya (pesanan/retur marketplace, kanvas, KOL, settlement). Sudah ikut
 * terhitung di kelompok tanpa kanal pada `baris`; di sini dipindah.
 */
export type BarisTurunan = {
  accountId: string;
  type: AccountType;
  debit: number;
  credit: number;
  storeId: string | null;
  kanal: string;
  /** Toko dari dokumen sumber bila barisnya sendiri tanpa toko (penjualan kanvas lama). */
  storeIdTurunan: string | null;
};

export type BarisLabaKanal = {
  /** Kanal (`KANAL_JURNAL`) atau id toko; null = tanpa kanal / tanpa toko. */
  kunci: string | null;
  penjualan: number;
  retur: number;
  potongan: number;
  pendapatanBersih: number;
  hpp: number;
  labaKotor: number;
  marginKotor: number | null;
  beban: number;
  labaKontribusi: number;
};

export type HasilLabaKanal = { baris: BarisLabaKanal[]; total: BarisLabaKanal; barisTurunan: number };

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));
const URUT_KANAL = new Map<string, number>(SEMUA_KANAL_JURNAL.map((k, i) => [k, i]));

type Jumlah = { penjualan: number; retur: number; potongan: number; pendapatan: number; hpp: number; beban: number };
const kosong = (): Jumlah => ({ penjualan: 0, retur: 0, potongan: 0, pendapatan: 0, hpp: 0, beban: 0 });

function tambah(j: Jumlah, r: { accountId: string; type: AccountType; debit: number; credit: number }, peran: PeranAkunKanal, arah: 1 | -1) {
  const kredit = (keSen(r.credit) - keSen(r.debit)) * arah;
  if (r.type === "PENDAPATAN") {
    j.pendapatan += kredit;
    if (peran.retur.has(r.accountId)) j.retur -= kredit;
    else if (peran.potongan.has(r.accountId)) j.potongan -= kredit;
    else j.penjualan += kredit;
  } else if (r.type === "HPP") {
    j.hpp -= kredit;
  } else if (r.type === "BEBAN") {
    j.beban -= kredit;
  }
}

function jadi(kunci: string | null, j: Jumlah): BarisLabaKanal {
  const labaKotor = j.pendapatan - j.hpp;
  const sen = (v: number) => v / 100 + 0;
  return {
    kunci,
    penjualan: sen(j.penjualan),
    retur: sen(j.retur),
    potongan: sen(j.potongan),
    pendapatanBersih: sen(j.pendapatan),
    hpp: sen(j.hpp),
    labaKotor: sen(labaKotor),
    marginKotor: j.pendapatan > 0 ? (labaKotor / j.pendapatan) * 100 : null,
    beban: sen(j.beban),
    labaKontribusi: sen(labaKotor - j.beban),
  };
}

export type PeranAkunKanal = { retur: ReadonlySet<string>; potongan: ReadonlySet<string> };

export function susunLabaKanal(
  baris: BarisKanalMentah[],
  peran: PeranAkunKanal,
  kelompok: "kanal" | "toko",
  turunan: BarisTurunan[] = [],
): HasilLabaKanal {
  const grup = new Map<string | null, Jumlah>();
  const total = kosong();
  const ambil = (k: string | null) => {
    let j = grup.get(k);
    if (!j) {
      j = kosong();
      grup.set(k, j);
    }
    return j;
  };
  const kunciDari = (kanal: string | null, storeId: string | null) => (kelompok === "kanal" ? kanal : storeId);

  for (const r of baris) {
    tambah(ambil(kunciDari(r.kanal, r.storeId)), r, peran, 1);
    tambah(total, r, peran, 1);
  }
  for (const r of turunan) {
    /* Baris ini sudah terhitung di kelompok tanpa kanal (dengan tokonya sendiri). */
    tambah(ambil(kunciDari(null, r.storeId)), r, peran, -1);
    tambah(ambil(kunciDari(r.kanal, r.storeId ?? r.storeIdTurunan)), r, peran, 1);
  }

  const hasil = [...grup.entries()]
    .filter(([, j]) => Object.values(j).some((v) => v !== 0))
    .map(([k, j]) => jadi(k, j));

  hasil.sort((a, b) => {
    if (a.kunci === null) return 1;
    if (b.kunci === null) return -1;
    if (kelompok === "toko") return b.pendapatanBersih - a.pendapatanBersih || a.kunci.localeCompare(b.kunci);
    const ua = URUT_KANAL.get(a.kunci) ?? Number.MAX_SAFE_INTEGER;
    const ub = URUT_KANAL.get(b.kunci) ?? Number.MAX_SAFE_INTEGER;
    return ua - ub || a.kunci.localeCompare(b.kunci);
  });

  return { baris: hasil, total: jadi(null, total), barisTurunan: turunan.length };
}
