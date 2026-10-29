/**
 * Efektivitas promo konter SPG — aturan murni, tanpa basis data.
 *
 * Keputusan sementara 108 (pemilik 2026-10-20): efektivitas = MEMBANDINGKAN
 * penjualan barang sasaran di toko sasaran selama promo dengan periode
 * sebelumnya yang sama panjang. Ini perbandingan, bukan bukti sebab-akibat —
 * layar menyatakannya. Setiap angka di sini dihitung dari baris basis data yang
 * diberikan pemanggil; kalau datanya tidak ada, hasilnya `null` (dan layar
 * menyebutnya), tidak pernah ditebak.
 *
 * Periode memakai instan setengah terbuka `[mulai, akhir)`:
 *   - promo  W = [mulai promo, min(akhir promo, dimatikan, sekarang)), dipotong
 *     rentang pilihan bila ada;
 *   - pembanding B = sepanjang W, TEPAT sebelum promo mulai (bukan sebelum
 *     potongan rentang — kalau tidak, promo yang sudah lama berjalan akan
 *     dibandingkan dengan dirinya sendiri).
 * "Hari ke-k" pada grafik = 24 jam ke-k sejak awal periodenya masing-masing,
 * jadi hari ke-k di W dan di B selalu sama panjang (termasuk hari terakhir yang
 * belum penuh pada promo yang masih berjalan).
 */
import { formatDateOnlyJakarta } from "@/lib/date-only";

export const HARI_MS = 86_400_000;
/** Pembeli "kembali" = belanja lagi dalam sekian hari sesudah promo berakhir. */
export const HARI_KEMBALI = 30;

const keSen = (rupiah: number) => Math.round((Number(rupiah) || 0) * 100);
const dariSen = (sen: number) => sen / 100;
const satuDesimal = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Periode
// ---------------------------------------------------------------------------

/** Instan setengah terbuka `[mulai, akhir)`. */
export type Jendela = { mulai: Date; akhir: Date };

export type JendelaPromo = {
  /** W — periode promo yang dihitung. */
  promo: Jendela;
  /** B — sepanjang W, tepat sebelum promo mulai. */
  pembanding: Jendela;
  /** Awal promo yang sesungguhnya (`startsAt`, atau saat dibuat bila tanpa tanggal mulai). */
  mulaiPromo: Date;
  /** Rentang pilihan memotong W (awal atau akhirnya). */
  dipotongRentang: boolean;
  /** W berakhir "sekarang": promo belum selesai. */
  masihBerjalan: boolean;
  /** Promo dimatikan sebelum tanggal akhirnya — W berhenti di situ. */
  berhentiDimatikan: boolean;
  /** Panjang W dalam hari (boleh pecahan). */
  hari: number;
};

/**
 * Periode promo dan pembandingnya. `rentang.sampai` adalah akhir INKLUSIF
 * (23:59:59.999 WIB, keluaran `parseDateOnlyEnd`); `endsAt` promo juga inklusif.
 * `berhentiPada` = kapan promo yang kini nonaktif dimatikan.
 * Null = promo tidak berjalan sama sekali di rentang itu (belum mulai, atau
 * berakhir sebelum rentang).
 */
export function jendelaPromo(
  p: { startsAt: Date | null; endsAt: Date | null; createdAt: Date; berhentiPada?: Date | null },
  sekarang: Date,
  rentang?: { dari: Date | null; sampai: Date | null } | null,
): JendelaPromo | null {
  const mulaiPromo = (p.startsAt ?? p.createdAt).getTime();
  const akhirTanggal = p.endsAt ? p.endsAt.getTime() + 1 : Number.POSITIVE_INFINITY;
  const berhenti = p.berhentiPada ? p.berhentiPada.getTime() : Number.POSITIVE_INFINITY;
  const t = sekarang.getTime();
  const akhirPromo = Math.min(akhirTanggal, berhenti, t);

  const dari = rentang?.dari ? rentang.dari.getTime() : Number.NEGATIVE_INFINITY;
  const sampai = rentang?.sampai ? rentang.sampai.getTime() + 1 : Number.POSITIVE_INFINITY;
  const mulai = Math.max(mulaiPromo, dari);
  const akhir = Math.min(akhirPromo, sampai);
  if (!Number.isFinite(mulai) || !Number.isFinite(akhir) || akhir <= mulai) return null;

  const panjang = akhir - mulai;
  return {
    promo: { mulai: new Date(mulai), akhir: new Date(akhir) },
    pembanding: { mulai: new Date(mulaiPromo - panjang), akhir: new Date(mulaiPromo) },
    mulaiPromo: new Date(mulaiPromo),
    dipotongRentang: mulai > mulaiPromo || akhir < akhirPromo,
    masihBerjalan: akhirPromo === t && t < Math.min(akhirTanggal, berhenti),
    berhentiDimatikan: berhenti < Math.min(akhirTanggal, t),
    hari: panjang / HARI_MS,
  };
}

export function dalamJendela(waktu: Date, j: Jendela): boolean {
  const t = waktu.getTime();
  return t >= j.mulai.getTime() && t < j.akhir.getTime();
}

/** Banyaknya "hari ke-k" (24 jam) dalam periode; hari terakhir boleh belum penuh. */
export function jumlahSlotHari(j: Jendela): number {
  return Math.max(1, Math.ceil((j.akhir.getTime() - j.mulai.getTime()) / HARI_MS));
}

/** Hari ke berapa (0, 1, …) dalam periode; null di luar periode. */
export function indeksHari(waktu: Date, j: Jendela): number | null {
  if (!dalamJendela(waktu, j)) return null;
  return Math.floor((waktu.getTime() - j.mulai.getTime()) / HARI_MS);
}

// ---------------------------------------------------------------------------
// Sasaran
// ---------------------------------------------------------------------------

/**
 * Toko dan barang sasaran promo. Barang = sasaran BARANG ∪ barang yang
 * kategorinya KINI salah satu sasaran KATEGORI (kategori dibaca seperti hari
 * ini, bukan saat nota dibuat). Untuk PAKET: komponennya, dengan aturan sama.
 */
export type SasaranPromo = {
  semuaToko: boolean;
  tokoIds: readonly string[];
  semuaBarang: boolean;
  barangIds: readonly string[];
  kategoriIds: readonly string[];
};

export function sasaranDariTarget(p: { allStores: boolean; allItems: boolean; targets: readonly { kind: string; refId: string }[] }): SasaranPromo {
  const ref = (kind: string) => [...new Set(p.targets.filter((t) => t.kind === kind).map((t) => t.refId))];
  return {
    semuaToko: p.allStores,
    tokoIds: p.allStores ? [] : ref("STORE"),
    semuaBarang: p.allItems,
    barangIds: p.allItems ? [] : ref("ITEM"),
    kategoriIds: p.allItems ? [] : ref("CATEGORY"),
  };
}

export function barangKenaSasaran(s: SasaranPromo, b: { itemId: string; categoryId: string | null }): boolean {
  if (s.semuaBarang) return true;
  if (s.barangIds.includes(b.itemId)) return true;
  return b.categoryId !== null && s.kategoriIds.includes(b.categoryId);
}

export function tokoKenaSasaran(s: SasaranPromo, storeId: string): boolean {
  return s.semuaToko || s.tokoIds.includes(storeId);
}

// ---------------------------------------------------------------------------
// Perbandingan
// ---------------------------------------------------------------------------

export type Perbandingan = {
  promo: number;
  pembanding: number;
  selisih: number;
  /** (promo − pembanding) ÷ pembanding × 100, 1 desimal. Null = pembanding 0 ("belum ada pembanding"). */
  persen: number | null;
};

export function bandingkan(promo: number, pembanding: number): Perbandingan {
  const selisih = Math.round((promo - pembanding) * 100) / 100;
  return { promo, pembanding, selisih, persen: pembanding > 0 ? satuDesimal((selisih / pembanding) * 100) : null };
}

/**
 * Rata-rata per hari; null kalau periodenya belum sehari penuh — nilai satu jam
 * dibagi 0,05 hari terbaca seperti puluhan juta "per hari".
 */
export function perHari(nilai: number, hari: number): number | null {
  return hari >= 1 ? Math.round((nilai / hari) * 100) / 100 : null;
}

/**
 * Potongan yang diberikan untuk setiap Rp1 kenaikan penjualan bersih:
 * potongan ÷ (penjualan promo − penjualan pembanding). Null kalau penjualan
 * tidak naik — layar menyebut "tidak ada kenaikan", bukan angka negatif.
 */
export function biayaPerKenaikan(potongan: number, selisihRupiah: number): number | null {
  if (!(selisihRupiah > 0)) return null;
  return Math.round((potongan / selisihRupiah) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Penjualan barang sasaran
// ---------------------------------------------------------------------------

/** Satu baris nota SPG beserta waktu nota dan tokonya. */
export type BarisJualPromo = {
  spgSaleId: string;
  storeId: string;
  itemId: string;
  categoryId: string | null;
  waktu: Date;
  qty: number;
  returnedQty: number;
  /** Nilai bersih baris saat nota dibuat (sesudah semua potongan). */
  lineTotal: number;
};

/**
 * Nilai baris sesudah retur pembeli: potong = qty − returnedQty; rupiah =
 * lineTotal × potong ÷ qty (dalam sen).
 */
export function bersihBaris(b: Pick<BarisJualPromo, "qty" | "returnedQty" | "lineTotal">): { pcs: number; sen: number } {
  const qty = Math.max(0, Math.trunc(b.qty));
  const pcs = Math.max(0, qty - Math.max(0, Math.trunc(b.returnedQty)));
  if (qty === 0 || pcs === 0) return { pcs: 0, sen: 0 };
  return { pcs, sen: Math.round((keSen(b.lineTotal) * pcs) / qty) };
}

export type AngkaJual = { pcs: number; rupiah: number; nota: number };

type Saring = { sasaran: SasaranPromo; jendela: Jendela; storeId?: string };

function cocok(b: BarisJualPromo, s: Saring): boolean {
  if (s.storeId !== undefined && b.storeId !== s.storeId) return false;
  return tokoKenaSasaran(s.sasaran, b.storeId) && barangKenaSasaran(s.sasaran, b) && dalamJendela(b.waktu, s.jendela);
}

/** Potong bersih, rupiah bersih, dan nota yang memuat barang sasaran di toko sasaran dalam satu periode. */
export function jumlahkanJual(baris: readonly BarisJualPromo[], s: Saring): AngkaJual {
  let pcs = 0;
  let sen = 0;
  const nota = new Set<string>();
  for (const b of baris) {
    if (!cocok(b, s)) continue;
    const v = bersihBaris(b);
    pcs += v.pcs;
    sen += v.sen;
    if (v.pcs > 0) nota.add(b.spgSaleId);
  }
  return { pcs, rupiah: dariSen(sen), nota: nota.size };
}

export type PenjualanSasaran = {
  pcs: Perbandingan;
  rupiah: Perbandingan;
  nota: Perbandingan;
  /** Rata-rata per hari [promo, pembanding]. */
  perHari: { pcs: [number | null, number | null]; rupiah: [number | null, number | null]; nota: [number | null, number | null] };
};

export function bandingkanPenjualan(baris: readonly BarisJualPromo[], sasaran: SasaranPromo, j: JendelaPromo, storeId?: string): PenjualanSasaran {
  const w = jumlahkanJual(baris, { sasaran, jendela: j.promo, storeId });
  const b = jumlahkanJual(baris, { sasaran, jendela: j.pembanding, storeId });
  return {
    pcs: bandingkan(w.pcs, b.pcs),
    rupiah: bandingkan(w.rupiah, b.rupiah),
    nota: bandingkan(w.nota, b.nota),
    perHari: {
      pcs: [perHari(w.pcs, j.hari), perHari(b.pcs, j.hari)],
      rupiah: [perHari(w.rupiah, j.hari), perHari(b.rupiah, j.hari)],
      nota: [perHari(w.nota, j.hari), perHari(b.nota, j.hari)],
    },
  };
}

// ---------------------------------------------------------------------------
// Pemakaian — dari rincian per nota × baris × promo (`SpgSalePromo`)
// ---------------------------------------------------------------------------

export type BarisRincianPromo = {
  spgSaleId: string;
  storeId: string;
  /** Syarat toko saat ini: KONSI = potongan dibagi toko/Elorae; PUTUS = barang milik toko, hanya dicatat. */
  termsType: string;
  waktu: Date;
  kind: string;
  qty: number;
  discount: number;
  storeDiscount: number;
};

export type PemakaianPromo = {
  nota: number;
  /** Potong yang kena promo (rincian BARANG); null untuk promo belanja — yang dihitung notanya. */
  pcs: number | null;
  potongan: number;
  konsi: { potongan: number; toko: number; elorae: number };
  putus: { potongan: number };
};

export function hitungPemakaian(rincian: readonly BarisRincianPromo[], jendela: Jendela, belanja: boolean, storeId?: string): PemakaianPromo {
  const nota = new Set<string>();
  let pcs = 0;
  let sen = 0;
  let konsiSen = 0;
  let konsiTokoSen = 0;
  let putusSen = 0;
  for (const r of rincian) {
    if (storeId !== undefined && r.storeId !== storeId) continue;
    if (!dalamJendela(r.waktu, jendela)) continue;
    nota.add(r.spgSaleId);
    if (r.kind === "BARANG") pcs += Math.max(0, Math.trunc(r.qty));
    const d = keSen(r.discount);
    sen += d;
    if (r.termsType === "KONSI") {
      konsiSen += d;
      konsiTokoSen += keSen(r.storeDiscount);
    } else putusSen += d;
  }
  return {
    nota: nota.size,
    pcs: belanja ? null : pcs,
    potongan: dariSen(sen),
    konsi: { potongan: dariSen(konsiSen), toko: dariSen(konsiTokoSen), elorae: dariSen(konsiSen - konsiTokoSen) },
    putus: { potongan: dariSen(putusSen) },
  };
}

// ---------------------------------------------------------------------------
// Keranjang: rata-rata nilai nota dengan promo vs tanpa promo
// ---------------------------------------------------------------------------

export type NotaKeranjang = {
  id: string;
  storeId: string;
  waktu: Date;
  /** Total nota sesudah potongan, dikurangi barang yang dikembalikan pembeli. */
  nilaiBersih: number;
};

export type Keranjang = {
  dengan: { nota: number; rataRata: number | null };
  tanpa: { nota: number; rataRata: number | null };
  /** Rata-rata dengan − tanpa; null kalau salah satunya tidak ada nota. */
  selisih: number | null;
  persen: number | null;
  /** Nota lama yang memakai promo ini tanpa rincian — tidak dimasukkan ke kedua kelompok. */
  dikecualikan: number;
};

/**
 * Nota di toko sasaran selama promo: yang memakai promo ini (`pakai`) vs yang
 * tidak. Nota lama tanpa rincian yang tercatat memakai promo ini (`lama`)
 * dikeluarkan dari keduanya — tidak bisa dipastikan kelompoknya dari rinciannya.
 */
export function hitungKeranjang(
  nota: readonly NotaKeranjang[],
  o: { sasaran: SasaranPromo; jendela: Jendela; pakai: ReadonlySet<string>; lama: ReadonlySet<string> },
): Keranjang {
  let dN = 0;
  let dSen = 0;
  let tN = 0;
  let tSen = 0;
  let kecuali = 0;
  for (const n of nota) {
    if (!tokoKenaSasaran(o.sasaran, n.storeId) || !dalamJendela(n.waktu, o.jendela)) continue;
    if (o.pakai.has(n.id)) {
      dN += 1;
      dSen += keSen(n.nilaiBersih);
    } else if (o.lama.has(n.id)) kecuali += 1;
    else {
      tN += 1;
      tSen += keSen(n.nilaiBersih);
    }
  }
  const rata = (sen: number, n: number) => (n > 0 ? Math.round(sen / n) / 100 : null);
  const dengan = rata(dSen, dN);
  const tanpa = rata(tSen, tN);
  const selisih = dengan !== null && tanpa !== null ? Math.round((dengan - tanpa) * 100) / 100 : null;
  return {
    dengan: { nota: dN, rataRata: dengan },
    tanpa: { nota: tN, rataRata: tanpa },
    selisih,
    persen: selisih !== null && tanpa !== null && tanpa > 0 ? satuDesimal((selisih / tanpa) * 100) : null,
    dikecualikan: kecuali,
  };
}

// ---------------------------------------------------------------------------
// Pelanggan — hanya pembeli yang tercatat
// ---------------------------------------------------------------------------

export type NotaPembeli = {
  id: string;
  /** Nomor WhatsApp pembeli tercatat (`62812…`), null = pembeli tidak dicatat. */
  phone: string | null;
  /** Nota ini tercatat dengan member. */
  member: boolean;
};

export type KembaliPelanggan =
  | { dinilai: true; pembeli: number; persen: number | null; sampai: Date }
  /** Belum 30 hari sejak promo berakhir (atau promo masih berjalan): `sejak` = kapan bisa dinilai. */
  | { dinilai: false; sejak: Date; masihBerjalan: boolean };

export type PelangganPromo = {
  notaPromo: number;
  notaTercatat: number;
  /** % nota promo yang pembelinya tercatat; null kalau tidak ada nota promo. */
  cakupan: number | null;
  pembeli: number;
  baru: number;
  member: number;
  kembali: KembaliPelanggan;
};

/**
 * Pembeli nota promo, dikenali dari nomornya di toko mana pun.
 *   - baru  = nomor tanpa nota di toko mana pun sebelum promo mulai (`adaSebelum`);
 *   - kembali = belanja lagi di toko mana pun dalam 30 hari sesudah periode
 *     promo berakhir (`adaSesudah`), dinilai hanya bila 30 hari itu sudah lewat;
 *   - member = setidaknya satu nota promonya tercatat dengan member.
 */
export function hitungPelanggan(o: {
  notaPromo: readonly NotaPembeli[];
  adaSebelum: ReadonlySet<string>;
  adaSesudah: ReadonlySet<string>;
  jendela: JendelaPromo;
  sekarang: Date;
}): PelangganPromo {
  const tercatat = o.notaPromo.filter((n) => n.phone);
  const nomor = new Set(tercatat.map((n) => n.phone as string));
  const member = new Set(tercatat.filter((n) => n.member).map((n) => n.phone as string));
  const baru = [...nomor].filter((p) => !o.adaSebelum.has(p)).length;
  const sampai = new Date(o.jendela.promo.akhir.getTime() + HARI_KEMBALI * HARI_MS);
  const kembali: KembaliPelanggan =
    !o.jendela.masihBerjalan && sampai.getTime() <= o.sekarang.getTime()
      ? (() => {
          const n = [...nomor].filter((p) => o.adaSesudah.has(p)).length;
          return { dinilai: true, pembeli: n, persen: nomor.size > 0 ? satuDesimal((n / nomor.size) * 100) : null, sampai };
        })()
      : { dinilai: false, sejak: sampai, masihBerjalan: o.jendela.masihBerjalan };
  return {
    notaPromo: o.notaPromo.length,
    notaTercatat: tercatat.length,
    cakupan: o.notaPromo.length > 0 ? satuDesimal((tercatat.length / o.notaPromo.length) * 100) : null,
    pembeli: nomor.size,
    baru,
    member: member.size,
    kembali,
  };
}

// ---------------------------------------------------------------------------
// Deret harian dan per toko
// ---------------------------------------------------------------------------

export type TitikHarian = {
  /** 1, 2, … */
  hariKe: number;
  /** Hari WIB awal 24 jam ke-k di periode promo / pembanding ("YYYY-MM-DD"). */
  tanggalPromo: string;
  tanggalPembanding: string;
  promo: number;
  pembanding: number;
};

/** Potong bersih barang sasaran per "hari ke-k" untuk W dan B, berjajar. */
export function deretHarian(baris: readonly BarisJualPromo[], sasaran: SasaranPromo, j: JendelaPromo): TitikHarian[] {
  const n = jumlahSlotHari(j.promo);
  const w = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(0);
  for (const r of baris) {
    if (!tokoKenaSasaran(sasaran, r.storeId) || !barangKenaSasaran(sasaran, r)) continue;
    const pcs = bersihBaris(r).pcs;
    if (pcs === 0) continue;
    const iw = indeksHari(r.waktu, j.promo);
    if (iw !== null && iw < n) w[iw] += pcs;
    const ib = indeksHari(r.waktu, j.pembanding);
    if (ib !== null && ib < n) b[ib] += pcs;
  }
  return w.map((v, i) => ({
    hariKe: i + 1,
    tanggalPromo: formatDateOnlyJakarta(new Date(j.promo.mulai.getTime() + i * HARI_MS)),
    tanggalPembanding: formatDateOnlyJakarta(new Date(j.pembanding.mulai.getTime() + i * HARI_MS)),
    promo: v,
    pembanding: b[i],
  }));
}

export type BarisTokoEfektivitas = {
  storeId: string;
  pemakaian: PemakaianPromo;
  penjualan: PenjualanSasaran;
};

/**
 * Per toko: toko sasaran (promo untuk toko tertentu), atau — promo semua toko —
 * setiap toko yang punya nota SPG di W ∪ B (`tokoBernota`). Urut: potongan
 * terbesar, lalu penjualan promo terbesar.
 */
export function perToko(o: {
  sasaran: SasaranPromo;
  jendela: JendelaPromo;
  baris: readonly BarisJualPromo[];
  rincian: readonly BarisRincianPromo[];
  belanja: boolean;
  tokoBernota: readonly string[];
}): BarisTokoEfektivitas[] {
  const toko = o.sasaran.semuaToko ? [...new Set(o.tokoBernota)] : [...o.sasaran.tokoIds];
  return toko
    .map((storeId) => ({
      storeId,
      pemakaian: hitungPemakaian(o.rincian, o.jendela.promo, o.belanja, storeId),
      penjualan: bandingkanPenjualan(o.baris, o.sasaran, o.jendela, storeId),
    }))
    .sort((a, b) => b.pemakaian.potongan - a.pemakaian.potongan || b.penjualan.rupiah.promo - a.penjualan.rupiah.promo || a.storeId.localeCompare(b.storeId));
}

// ---------------------------------------------------------------------------
// Ringkasan satu promo (dipakai daftar dan halaman hasil)
// ---------------------------------------------------------------------------

export type RingkasanEfektivitas = {
  pemakaian: PemakaianPromo;
  penjualan: PenjualanSasaran;
  /** Potongan ÷ kenaikan penjualan bersih (rupiah); null = tidak dinilai (lihat `biayaAlasan`). */
  biaya: number | null;
  /**
   * Kenapa `biaya` kosong: TANPA_PEMBANDING = pembanding tanpa penjualan barang
   * sasaran (seluruh penjualan masa promo akan terbaca sebagai "kenaikan" —
   * aturan yang sama dengan persen perubahan); TIDAK_NAIK = penjualan tidak naik.
   */
  biayaAlasan: "TANPA_PEMBANDING" | "TIDAK_NAIK" | null;
};

export function ringkasEfektivitas(o: {
  sasaran: SasaranPromo;
  jendela: JendelaPromo;
  baris: readonly BarisJualPromo[];
  rincian: readonly BarisRincianPromo[];
  belanja: boolean;
}): RingkasanEfektivitas {
  const pemakaian = hitungPemakaian(o.rincian, o.jendela.promo, o.belanja);
  const penjualan = bandingkanPenjualan(o.baris, o.sasaran, o.jendela);
  if (!(penjualan.rupiah.pembanding > 0)) return { pemakaian, penjualan, biaya: null, biayaAlasan: "TANPA_PEMBANDING" };
  const biaya = biayaPerKenaikan(pemakaian.potongan, penjualan.rupiah.selisih);
  return { pemakaian, penjualan, biaya, biayaAlasan: biaya === null ? "TIDAK_NAIK" : null };
}
