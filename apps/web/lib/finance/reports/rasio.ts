import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";
import type { BalanceRow } from "./balances";
import type { CashFlowSection } from "./cash-flow-classify";

/*
 * Rasio keuangan dari buku besar — murni (aman untuk komponen klien).
 *
 * Bagan akun tidak menyimpan "lancar / tidak lancar". Penggolongannya
 * diturunkan dari dua hal yang sudah ada dan bisa diatur pengguna:
 * - seksi arus kas akun (Klasifikasi Arus Kas; bawaannya dari peran posting):
 *   aset KAS/OPERASIONAL = modal kerja = LANCAR, INVESTASI = tidak lancar;
 *   liabilitas PENDANAAN = jangka panjang, selainnya lancar;
 * - peran posting: aset tetap dan akumulasi penyusutan selalu tidak lancar
 *   (akumulasi penyusutan berseksi operasional di arus kas karena
 *   penyusutannya ditambahkan kembali, bukan karena lancar); peran persediaan,
 *   dibayar dimuka, piutang dagang, dan utang dagang untuk rasio cepat, DSO,
 *   dan DPO.
 * Aset TANPA klasifikasi tidak dihitung lancar (konservatif) dan dilaporkan
 * jumlahnya; liabilitas tanpa klasifikasi dihitung lancar (juga konservatif).
 */

export type KelasAkunRasio = {
  accountId: string;
  type: AccountType;
  section: CashFlowSection | null;
  roles: readonly PostingRole[];
};

export type GolonganRasio =
  | "ASET_LANCAR"
  | "ASET_TIDAK_LANCAR"
  | "ASET_TAK_TERKLASIFIKASI"
  | "LIABILITAS_LANCAR"
  | "LIABILITAS_JANGKA_PANJANG";

export const PERAN_PERSEDIAAN: readonly PostingRole[] = [
  "INVENTORY",
  "INVENTORY_FG",
  "INVENTORY_VAN",
  "INVENTORY_CONSIGNMENT",
  "INVENTORY_DAMAGED",
];
export const PERAN_DIBAYAR_DIMUKA: readonly PostingRole[] = [
  "PREPAID_EXPENSE",
  "KOL_PREPAID",
  "PPN_MASUKAN",
  "PPH22_PREPAID",
  "PPH23_PREPAID",
  "PPH25_PREPAID",
];
/** Piutang dagang untuk DSO: marketplace, toko putus, dan toko konsinyasi. */
export const PERAN_PIUTANG_DAGANG: readonly PostingRole[] = ["AR", "AR_STORE", "AR_CONSIGNMENT"];
export const PERAN_HUTANG_DAGANG: readonly PostingRole[] = ["AP"];
const PERAN_TIDAK_LANCAR: readonly PostingRole[] = ["FIXED_ASSET", "ACCUM_DEPRECIATION"];

const punya = (roles: readonly PostingRole[], daftar: readonly PostingRole[]) => roles.some((r) => daftar.includes(r));

export function golonganAkunRasio(k: KelasAkunRasio): {
  golongan: GolonganRasio | null;
  persediaan: boolean;
  dibayarDimuka: boolean;
  piutangDagang: boolean;
  hutangDagang: boolean;
} {
  const tanda = {
    persediaan: punya(k.roles, PERAN_PERSEDIAAN),
    dibayarDimuka: punya(k.roles, PERAN_DIBAYAR_DIMUKA),
    piutangDagang: punya(k.roles, PERAN_PIUTANG_DAGANG),
    hutangDagang: punya(k.roles, PERAN_HUTANG_DAGANG),
  };
  if (k.type === "ASET") {
    if (punya(k.roles, PERAN_TIDAK_LANCAR)) return { golongan: "ASET_TIDAK_LANCAR", ...tanda };
    if (k.section === "KAS" || k.section === "OPERASIONAL") return { golongan: "ASET_LANCAR", ...tanda };
    if (k.section === "INVESTASI" || k.section === "PENDANAAN") return { golongan: "ASET_TIDAK_LANCAR", ...tanda };
    if (tanda.persediaan || tanda.dibayarDimuka || tanda.piutangDagang) return { golongan: "ASET_LANCAR", ...tanda };
    return { golongan: "ASET_TAK_TERKLASIFIKASI", ...tanda };
  }
  if (k.type === "LIABILITAS") {
    return { golongan: k.section === "PENDANAAN" ? "LIABILITAS_JANGKA_PANJANG" : "LIABILITAS_LANCAR", ...tanda };
  }
  return { golongan: null, ...tanda };
}

export type PosisiRasio = {
  asetLancar: number;
  persediaan: number;
  dibayarDimuka: number;
  piutangDagang: number;
  liabilitasLancar: number;
  hutangDagang: number;
  /** Saldo aset yang belum diklasifikasi (tidak dihitung lancar). */
  asetTakTerklasifikasi: number;
  akunTakTerklasifikasi: number;
};

const keSen = (v: number): number => Math.round(Number((v * 100).toFixed(4)));

/**
 * Posisi per tanggal dari saldo kumulatif (`getAccountBalances({ to })`).
 * Akun yang tidak ada di `kelas` (mis. induk yang punya mutasi sendiri) dianggap
 * tanpa klasifikasi.
 */
export function ringkasPosisiRasio(rows: BalanceRow[], kelas: ReadonlyMap<string, KelasAkunRasio>): PosisiRasio {
  const sen = { asetLancar: 0, persediaan: 0, dibayarDimuka: 0, piutangDagang: 0, liabilitasLancar: 0, hutangDagang: 0, asetTakTerklasifikasi: 0 };
  let akunTakTerklasifikasi = 0;
  for (const r of rows) {
    const nilai = keSen(r.signed);
    if (nilai === 0) continue;
    const k = kelas.get(r.accountId) ?? { accountId: r.accountId, type: r.type, section: null, roles: [] };
    const g = golonganAkunRasio({ ...k, type: r.type });
    if (g.golongan === "ASET_LANCAR") sen.asetLancar += nilai;
    if (g.golongan === "ASET_TAK_TERKLASIFIKASI") {
      sen.asetTakTerklasifikasi += nilai;
      akunTakTerklasifikasi++;
    }
    if (g.golongan === "LIABILITAS_LANCAR") sen.liabilitasLancar += nilai;
    if (g.golongan === "ASET_LANCAR" && g.persediaan) sen.persediaan += nilai;
    if (g.golongan === "ASET_LANCAR" && g.dibayarDimuka) sen.dibayarDimuka += nilai;
    if (r.type === "ASET" && g.piutangDagang) sen.piutangDagang += nilai;
    if (r.type === "LIABILITAS" && g.hutangDagang) sen.hutangDagang += nilai;
  }
  return {
    asetLancar: sen.asetLancar / 100 + 0,
    persediaan: sen.persediaan / 100 + 0,
    dibayarDimuka: sen.dibayarDimuka / 100 + 0,
    piutangDagang: sen.piutangDagang / 100 + 0,
    liabilitasLancar: sen.liabilitasLancar / 100 + 0,
    hutangDagang: sen.hutangDagang / 100 + 0,
    asetTakTerklasifikasi: sen.asetTakTerklasifikasi / 100 + 0,
    akunTakTerklasifikasi,
  };
}

export type LabaRugiRasio = { pendapatan: number; hpp: number; labaKotor: number; labaBersih: number };

export type HasilRasio = {
  marginKotor: number | null;
  marginBersih: number | null;
  rasioLancar: number | null;
  rasioCepat: number | null;
  perputaranPersediaan: number | null;
  hariPersediaan: number | null;
  dso: number | null;
  dpo: number | null;
  komponen: LabaRugiRasio & {
    asetLancar: number;
    persediaan: number;
    dibayarDimuka: number;
    asetCepat: number;
    liabilitasLancar: number;
    rataPersediaan: number;
    rataPiutang: number;
    rataHutang: number;
    hari: number;
    asetTakTerklasifikasi: number;
    akunTakTerklasifikasi: number;
  };
};

const bagi = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a) ? a / b : null);
const rata = (a: number, b: number): number => (keSen(a) + keSen(b)) / 200;

/**
 * Rasio untuk satu periode. Posisi neraca (lancar, cepat) dibaca per AKHIR
 * periode; perputaran, DSO, dan DPO memakai rata-rata saldo awal dan akhir
 * periode. DPO memakai HPP sebagai penyebut (pembelian tidak tercatat terpisah
 * di buku besar). Penyebut nol atau negatif → null.
 */
export function hitungRasio(input: { labaRugi: LabaRugiRasio; awal: PosisiRasio; akhir: PosisiRasio; hari: number }): HasilRasio {
  const { labaRugi: lr, awal, akhir, hari } = input;
  const asetCepat = (keSen(akhir.asetLancar) - keSen(akhir.persediaan) - keSen(akhir.dibayarDimuka)) / 100;
  const rataPersediaan = rata(awal.persediaan, akhir.persediaan);
  const rataPiutang = rata(awal.piutangDagang, akhir.piutangDagang);
  const rataHutang = rata(awal.hutangDagang, akhir.hutangDagang);

  const persen = (a: number) => {
    const v = bagi(a, lr.pendapatan);
    return v === null ? null : v * 100;
  };
  const perputaranPersediaan = bagi(lr.hpp, rataPersediaan);
  const dsoDasar = bagi(rataPiutang, lr.pendapatan);
  const dpoDasar = bagi(rataHutang, lr.hpp);

  return {
    marginKotor: persen(lr.labaKotor),
    marginBersih: persen(lr.labaBersih),
    rasioLancar: bagi(akhir.asetLancar, akhir.liabilitasLancar),
    rasioCepat: bagi(asetCepat, akhir.liabilitasLancar),
    perputaranPersediaan,
    hariPersediaan: perputaranPersediaan && perputaranPersediaan > 0 ? hari / perputaranPersediaan : null,
    dso: dsoDasar === null ? null : dsoDasar * hari,
    dpo: dpoDasar === null ? null : dpoDasar * hari,
    komponen: {
      ...lr,
      asetLancar: akhir.asetLancar,
      persediaan: akhir.persediaan,
      dibayarDimuka: akhir.dibayarDimuka,
      asetCepat,
      liabilitasLancar: akhir.liabilitasLancar,
      rataPersediaan,
      rataPiutang,
      rataHutang,
      hari,
      asetTakTerklasifikasi: akhir.asetTakTerklasifikasi,
      akunTakTerklasifikasi: akhir.akunTakTerklasifikasi,
    },
  };
}
