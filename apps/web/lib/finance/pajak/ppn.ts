/**
 * PPN — SATU-SATUNYA tempat PPN dihitung. Murni, aman untuk komponen klien.
 *
 * Tidak ada penulis jurnal yang menghitung PPN sendiri: semuanya memanggil
 * `pisahPpn` dengan pengaturan dari `SystemSetting["pajak.ppn"]`
 * (`bacaPengaturanPpn`, `./ppn-pengaturan.ts`, khusus server).
 *
 * Aturan yang dipakai (riset 2026-10-08, BUKAN nasihat pajak — konfirmasi ke
 * konsultan pajak):
 * - Tarif undang-undang 12% (UU HPP). Barang non-mewah (pakaian termasuk) memakai
 *   DPP NILAI LAIN = 11/12 × harga jual (PMK 131/2024), jadi PPN = 12% × 11/12 ×
 *   harga = efektif 11%. Kode faktur 04.
 * - Pembulatan (PER-11/PJ/2025 Ps 129): DPP dan PPN dibulatkan ke RUPIAH PENUH,
 *   setengah ke atas. Coretax TIDAK menghitung 11/12 sendiri, jadi ERP yang
 *   menyerahkan DPP (`dpp`), DPP nilai lain (`dppNilaiLain`), dan PPN (`ppn`).
 * - PPN = pembulatan(dppNilaiLain × tarif) — rumus yang sama dengan Coretax.
 * - Status PKP `BELUM_DITETAPKAN` (bawaan) berlaku seperti `NON_PKP`: tanpa PPN
 *   (keputusan sementara pemilik no. 35) — layar menampilkan spanduk.
 * - PPN hanya berlaku untuk tanggal ≥ `berlakuSejak` (hari WIB) bila diisi.
 *
 * Nilai negatif (retur) dibulatkan simetris: `pisahPpn(-x)` = −`pisahPpn(x)`.
 */

export const KUNCI_PENGATURAN_PPN = "pajak.ppn";

export type StatusPkp = "BELUM_DITETAPKAN" | "PKP" | "NON_PKP";
export const SEMUA_STATUS_PKP: readonly StatusPkp[] = ["BELUM_DITETAPKAN", "PKP", "NON_PKP"];

export type PengaturanPpn = {
  statusPkp: StatusPkp;
  /** Tarif undang-undang, persen (maks. dua desimal). Bawaan 12. */
  tarifPersen: number;
  /** DPP nilai lain 11/12 × harga jual (PMK 131/2024). Bawaan true. */
  pakaiDppNilaiLain: boolean;
  /** Harga jual yang tercatat (nota, marketplace, kasir) sudah TERMASUK PPN. Bawaan true. */
  hargaJualTermasukPpn: boolean;
  /** "YYYY-MM-DD" (hari WIB) mulai PPN dipungut, atau null = sejak kapan pun. */
  berlakuSejak: string | null;
};

export const PPN_BAWAAN: Readonly<PengaturanPpn> = Object.freeze({
  statusPkp: "BELUM_DITETAPKAN",
  tarifPersen: 12,
  pakaiDppNilaiLain: true,
  hargaJualTermasukPpn: true,
  berlakuSejak: null,
});

/** DPP nilai lain = PEMBILANG/PENYEBUT × DPP (PMK 131/2024). */
export const PEMBILANG_DPP_NILAI_LAIN = 11;
export const PENYEBUT_DPP_NILAI_LAIN = 12;

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function tanggalSah(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!POLA_TANGGAL.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000+07:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Tolak tanggal yang digulung (mis. 2026-02-30 → 2 Mar).
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) === t ? t : null;
}

/** Tarif persen 0 < t ≤ 100, paling banyak dua desimal (disimpan sebagai basis poin bulat). */
function tarifSah(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 100) return null;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? Math.round(n * 100) / 100 : null;
}

function objekDari(nilai: unknown): Record<string, unknown> | null {
  let v = nilai;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Baca nilai tersimpan (teks JSON `SystemSetting.value` atau objek) dengan
 * lunak: kunci yang hilang atau tidak sah jatuh ke `PPN_BAWAAN`, jadi baris
 * rusak tidak pernah membuat PPN menyala diam-diam.
 */
export function bacaPengaturanPpnMentah(nilai: unknown): PengaturanPpn {
  const o = objekDari(nilai);
  if (!o) return { ...PPN_BAWAAN };
  const status = SEMUA_STATUS_PKP.includes(o.statusPkp as StatusPkp) ? (o.statusPkp as StatusPkp) : PPN_BAWAAN.statusPkp;
  return {
    statusPkp: status,
    tarifPersen: tarifSah(o.tarifPersen) ?? PPN_BAWAAN.tarifPersen,
    pakaiDppNilaiLain: typeof o.pakaiDppNilaiLain === "boolean" ? o.pakaiDppNilaiLain : PPN_BAWAAN.pakaiDppNilaiLain,
    hargaJualTermasukPpn:
      typeof o.hargaJualTermasukPpn === "boolean" ? o.hargaJualTermasukPpn : PPN_BAWAAN.hargaJualTermasukPpn,
    berlakuSejak: tanggalSah(o.berlakuSejak),
  };
}

export type GalatPengaturanPpn = "BENTUK_TIDAK_SAH" | "STATUS_TIDAK_SAH" | "TARIF_TIDAK_SAH" | "SAKLAR_TIDAK_SAH" | "TANGGAL_TIDAK_SAH";

/**
 * Pemeriksaan KETAT untuk menyimpan (layar Pengaturan → Pajak): setiap kunci
 * wajib ada dan sah. Berbeda dari `bacaPengaturanPpnMentah` yang lunak.
 */
export function periksaPengaturanPpn(
  nilai: unknown,
): { ok: true; pengaturan: PengaturanPpn } | { ok: false; galat: GalatPengaturanPpn[] } {
  const o = objekDari(nilai);
  if (!o) return { ok: false, galat: ["BENTUK_TIDAK_SAH"] };
  const galat: GalatPengaturanPpn[] = [];
  if (!SEMUA_STATUS_PKP.includes(o.statusPkp as StatusPkp)) galat.push("STATUS_TIDAK_SAH");
  const tarif = tarifSah(o.tarifPersen);
  if (tarif === null) galat.push("TARIF_TIDAK_SAH");
  if (typeof o.pakaiDppNilaiLain !== "boolean" || typeof o.hargaJualTermasukPpn !== "boolean") galat.push("SAKLAR_TIDAK_SAH");
  const sejakKosong = o.berlakuSejak === null || o.berlakuSejak === undefined || o.berlakuSejak === "";
  const sejak = sejakKosong ? null : tanggalSah(o.berlakuSejak);
  if (!sejakKosong && sejak === null) galat.push("TANGGAL_TIDAK_SAH");
  if (galat.length) return { ok: false, galat };
  return {
    ok: true,
    pengaturan: {
      statusPkp: o.statusPkp as StatusPkp,
      tarifPersen: tarif as number,
      pakaiDppNilaiLain: o.pakaiDppNilaiLain as boolean,
      hargaJualTermasukPpn: o.hargaJualTermasukPpn as boolean,
      berlakuSejak: sejak,
    },
  };
}

/** Tarif efektif terhadap harga jual tanpa PPN, persen: 12 × 11/12 = 11. Tidak melihat status PKP. */
export function tarifEfektif(pengaturan: PengaturanPpn): number {
  const f = pengaturan.pakaiDppNilaiLain ? PEMBILANG_DPP_NILAI_LAIN / PENYEBUT_DPP_NILAI_LAIN : 1;
  return Math.round(pengaturan.tarifPersen * f * 10_000) / 10_000;
}

/** PPN dipungut untuk kejadian bertanggal `tanggal`? Hanya PKP; BELUM_DITETAPKAN = tidak. */
export function ppnBerlaku(pengaturan: PengaturanPpn, tanggal: Date): boolean {
  if (pengaturan.statusPkp !== "PKP") return false;
  if (!pengaturan.berlakuSejak) return true;
  return tanggal.getTime() >= new Date(`${pengaturan.berlakuSejak}T00:00:00.000+07:00`).getTime();
}

export type HasilPisahPpn = {
  /** DPP / harga jual tanpa PPN (Coretax `TaxBase`). Rupiah penuh, kecuali sisa sen dari total termasuk PPN yang bersen. */
  dpp: number;
  /** DPP nilai lain 11/12 × DPP (Coretax `OtherTaxBase`); = DPP bila nilai lain dimatikan; 0 bila PPN tidak berlaku. Rupiah penuh. */
  dppNilaiLain: number;
  /** PPN (Coretax `VAT`). Rupiah penuh. */
  ppn: number;
  /** dpp + ppn, PERSIS. Untuk harga termasuk PPN = nilai masukan apa adanya. */
  total: number;
  /** PPN dipungut (PKP dan tanggal ≥ berlakuSejak). */
  berlaku: boolean;
  /** Tarif yang dipakai (Coretax `VATRate`), 0 bila tidak berlaku. */
  tarifPersen: number;
  /**
   * `ppn` = pembulatan(`dppNilaiLain` × tarif) persis — rumus Coretax. Selalu
   * true untuk harga tanpa PPN. Untuk harga termasuk PPN ±10% total (terukur
   * 9,9% dari 1…200.000) tidak punya DPP rupiah penuh yang memenuhi rumus itu
   * DAN menjumlah persis — di sana PPN = total − DPP (selisih ≤ Rp1 dari rumus)
   * dan nilainya false. Buku besar memakai `ppn` (menjumlah persis); ekspor
   * Coretax yang harus memenuhi rumus memakai pembulatan(dppNilaiLain × tarif).
   */
  selarasCoretax: boolean;
};

/** Rupiah (boleh bersen) → sen bulat, simetris. toFixed dulu supaya 1250,555 tidak terbaca 125055,4999. */
function keSen(n: number): number {
  return Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toFixed(4)));
}

/** Pembagian bulat setengah ke atas untuk bilangan bulat tak-negatif. */
function bagiBulat(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** Sen tak-negatif → rupiah penuh, setengah ke atas. */
function senKeRupiah(sen: number): number {
  return bagiBulat(sen, 100);
}

const sen = (rupiah: number) => rupiah * 100;
const dariSen = (s: number) => s / 100;

/**
 * Pisahkan sebuah nilai menjadi DPP + PPN.
 *
 * - `termasukPpn` (bawaan `pengaturan.hargaJualTermasukPpn`): nilai adalah
 *   TOTAL yang dibayar pembeli; hasilnya `total` = nilai persis, `dpp` = total
 *   − `ppn`. Dipakai nota, marketplace, kasir.
 * - tanpa PPN: nilai adalah DPP (dibulatkan ke rupiah penuh); `total` = dpp + ppn.
 *   Dipakai pembelian yang harganya belum termasuk PPN (PO).
 * - PPN tidak berlaku (non-PKP, belum ditetapkan, sebelum `berlakuSejak`):
 *   `dpp` = `total` = nilai, `ppn` = 0, `dppNilaiLain` = 0.
 *
 * Penulis jurnal memakai `dpp` (pendapatan/persediaan), `ppn` (PPN keluaran/
 * masukan), dan `total` (piutang/hutang) — ketiganya menjumlah persis.
 */
export function pisahPpn(
  nilai: number,
  opsi: { termasukPpn?: boolean; pengaturan: PengaturanPpn; tanggal: Date },
): HasilPisahPpn {
  if (typeof nilai !== "number" || !Number.isFinite(nilai)) throw new RangeError(`Nilai PPN tidak sah: ${nilai}`);
  const p = opsi.pengaturan;
  const termasuk = opsi.termasukPpn ?? p.hargaJualTermasukPpn;
  const berlaku = ppnBerlaku(p, opsi.tanggal);
  const nilaiSen = keSen(nilai);
  const tanda = nilaiSen < 0 ? -1 : 1;
  const absSen = Math.abs(nilaiSen);

  if (!berlaku || absSen === 0) {
    const v = dariSen(nilaiSen) + 0;
    return { dpp: v, dppNilaiLain: 0, ppn: 0, total: v, berlaku, tarifPersen: berlaku ? p.tarifPersen : 0, selarasCoretax: true };
  }

  const tarifBp = Math.round(p.tarifPersen * 100);
  const nilaiLain = (dpp: number) =>
    p.pakaiDppNilaiLain ? bagiBulat(dpp * PEMBILANG_DPP_NILAI_LAIN, PENYEBUT_DPP_NILAI_LAIN) : dpp;
  const pajak = (dpp: number) => bagiBulat(nilaiLain(dpp) * tarifBp, 10_000);
  const hasil = (dppSen: number, ppnRp: number, selaras: boolean): HasilPisahPpn => {
    const dppRpPenuh = senKeRupiah(dppSen);
    return {
      dpp: dariSen(tanda * dppSen) + 0,
      dppNilaiLain: tanda * nilaiLain(dppRpPenuh) + 0,
      ppn: tanda * ppnRp + 0,
      total: dariSen(tanda * (dppSen + sen(ppnRp))) + 0,
      berlaku,
      tarifPersen: p.tarifPersen,
      selarasCoretax: selaras,
    };
  };

  if (!termasuk) {
    const dpp = senKeRupiah(absSen);
    return hasil(sen(dpp), pajak(dpp), true);
  }

  // Termasuk PPN: cari DPP rupiah penuh yang dpp + pajak(dpp) = total persis.
  const totalRp = senKeRupiah(absSen);
  const pembilang = p.pakaiDppNilaiLain ? 10_000 * PENYEBUT_DPP_NILAI_LAIN + tarifBp * PEMBILANG_DPP_NILAI_LAIN : 10_000 + tarifBp;
  const penyebut = p.pakaiDppNilaiLain ? 10_000 * PENYEBUT_DPP_NILAI_LAIN : 10_000;
  const perkiraan = bagiBulat(totalRp * penyebut, pembilang);
  let ppnRp = totalRp - perkiraan;
  let selaras = false;
  for (const geser of [0, -1, 1, -2, 2]) {
    const d = perkiraan + geser;
    if (d < 0) continue;
    if (d + pajak(d) === totalRp) {
      ppnRp = pajak(d);
      selaras = true;
      break;
    }
  }
  // Sisa sen dari total yang bersen jatuh ke DPP, supaya total = nilai persis.
  return hasil(absSen - sen(ppnRp), ppnRp, selaras);
}
