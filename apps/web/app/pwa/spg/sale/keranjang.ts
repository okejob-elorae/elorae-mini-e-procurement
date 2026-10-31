/**
 * Keranjang layar jual SPG — aturan murni (tanpa React, tanpa server), supaya
 * bisa dites di Node: bentuk simpanan `sessionStorage`, isian diskon manual,
 * isian pembeli, dan alasan PERTAMA tombol simpan masih mati.
 */
import { roundCents, roundToWholeRupiah } from "@elorae/db/pricing";
import { hitungPromoKonter, type AnggotaNota, type DiskonManual, type GagalPromoKonter, type HasilPromoKonter, type PromoKonter } from "@/lib/spg/promo-konter";
import type { AturanDiskonManualSpg } from "@/lib/spg/pengaturan";
import type { AturanMember } from "@/lib/spg/member";
import { anggotaPratinjau, mintaDaftarMember, uraiMemberPembeli, type MemberPembeli } from "@/lib/spg/member-hp";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";
import type { PembeliTertahan } from "@/lib/pwa/offline/db";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";

/** Isian diskon manual di layar. `nilai` teks apa adanya (koma desimal, titik ribuan). */
export type IsianDiskon = { jenis: "PERSEN" | "RUPIAH"; nilai: string; alasan: string };

/**
 * Keadaan member yang dibaca server untuk nomor `hp` (bentuk simpan `62…`).
 * Hanya berlaku selama nomor pembeli di keranjang masih nomor itu — nomor
 * yang diketik ulang dibaca ulang.
 */
export type MemberTerbaca = { hp: string; info: MemberPembeli };

/**
 * Pembeli di keranjang: pelanggan toko yang dipilih dari pencarian, atau
 * pembeli baru. `daftarMember` = pembeli setuju didaftarkan jadi member di nota
 * ini; `member` = keadaan member nomornya menurut server (null = belum diketahui,
 * misalnya tanpa sinyal).
 */
export type PembeliKeranjang =
  | { jenis: "ada"; id: string; nama: string; hp: string; daftarMember: boolean; member: MemberTerbaca | null }
  | { jenis: "baru"; nama: string; hp: string; setuju: boolean; daftarMember: boolean; member: MemberTerbaca | null };

/**
 * Keranjang disimpan per toko di `sessionStorage`, supaya tidak hilang saat SPG
 * membuka "Barang dicari" atau mengetuk Kembali di tengah melayani pembeli.
 * Kunci kirim ikut disimpan: kirim ulang sesudah jawaban server hilang (lalu
 * pindah layar) tidak boleh mencatat nota kedua. Diskon dan pembeli ikut.
 */
export type SimpananKeranjang = {
  baris: [string, number][];
  idempotencyKey: string;
  diskon: IsianDiskon | null;
  pembeli: PembeliKeranjang | null;
};

export const kunciSimpananKeranjang = (storeId: string) => `elorae.spg.keranjang.${storeId}`;

const teks = (v: unknown, maks: number): string | null => (typeof v === "string" && v.length <= maks ? v : null);

function uraiDiskon(v: unknown): IsianDiskon | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.jenis !== "PERSEN" && o.jenis !== "RUPIAH") return null;
  const nilai = teks(o.nilai, 20);
  const alasan = teks(o.alasan, 200);
  if (nilai === null || alasan === null) return null;
  return { jenis: o.jenis, nilai, alasan };
}

function uraiMemberTerbaca(v: unknown): MemberTerbaca | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const hp = teks(o.hp, 30);
  const info = uraiMemberPembeli(o.info);
  return hp && info ? { hp, info } : null;
}

function uraiPembeli(v: unknown): PembeliKeranjang | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const nama = teks(o.nama, 100);
  const hp = teks(o.hp, 30);
  if (nama === null || hp === null) return null;
  // Simpanan dari sebelum ada member: tidak minta didaftarkan, keadaan member belum diketahui.
  const member = { daftarMember: o.daftarMember === true, member: uraiMemberTerbaca(o.member) };
  if (o.jenis === "ada" && typeof o.id === "string" && o.id) return { jenis: "ada", id: o.id, nama, hp, ...member };
  if (o.jenis === "baru") return { jenis: "baru", nama, hp, setuju: o.setuju === true, ...member };
  return null;
}

/** Baca simpanan keranjang; simpanan rusak atau tanpa kunci kirim dianggap tidak ada. */
export function uraiSimpananKeranjang(mentah: string | null): SimpananKeranjang | null {
  if (!mentah) return null;
  try {
    const data = JSON.parse(mentah) as Record<string, unknown>;
    if (!data || !Array.isArray(data.baris) || typeof data.idempotencyKey !== "string" || data.idempotencyKey === "") return null;
    const baris = (data.baris as unknown[]).filter(
      (b): b is [string, number] => Array.isArray(b) && typeof b[0] === "string" && Number.isInteger(b[1]) && (b[1] as number) > 0,
    );
    return { baris, idempotencyKey: data.idempotencyKey, diskon: uraiDiskon(data.diskon), pembeli: uraiPembeli(data.pembeli) };
  } catch {
    return null;
  }
}

/**
 * Angka diskon dari ketikan. Rupiah: titik/koma/spasi ribuan dibuang ("10.000"
 * = sepuluh ribu). Persen: koma desimal boleh ("12,5"). Kosong → null.
 */
export function angkaDiskon(isian: Pick<IsianDiskon, "jenis" | "nilai">): number | null {
  const s = isian.nilai.trim();
  if (!s) return null;
  if (isian.jenis === "RUPIAH") {
    if (!/^[\d.,\s]+$/.test(s)) return Number.NaN;
    const n = Number(s.replace(/[.,\s]/g, ""));
    return Number.isFinite(n) ? n : Number.NaN;
  }
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s.replace(",", "."));
}

/** Diskon untuk mesin promo. Isian kosong, nol, atau rusak → null (tanpa diskon). */
export function diskonUntukMesin(isian: IsianDiskon | null): DiskonManual | null {
  if (!isian) return null;
  const n = angkaDiskon(isian);
  return n !== null && Number.isFinite(n) && n > 0 ? { jenis: isian.jenis, nilai: n } : null;
}

/** Keadaan member yang masih berlaku untuk nomor pembeli SEKARANG, atau null (belum diketahui). */
export function memberDiketahui(p: PembeliKeranjang | null): MemberPembeli | null {
  if (!p?.member) return null;
  const hp = nomorWhatsApp(p.hp);
  return hp && hp === p.member.hp ? p.member.info : null;
}

/** Nomor pembeli yang perlu ditanyakan keadaan membernya ke server, atau null (sudah diketahui / nomor belum sah). */
export function nomorPerluCekMember(p: PembeliKeranjang | null): string | null {
  if (!p) return null;
  const hp = nomorWhatsApp(p.hp);
  if (!hp) return null;
  return p.member?.hp === hp ? null : hp;
}

/**
 * Member pembeli untuk pratinjau dan kiriman — aturan yang sama dengan penulis
 * nota (`anggotaPratinjau`, `mintaDaftarMember`).
 */
export function memberKeranjang(
  p: PembeliKeranjang | null,
  aturan: AturanMember,
): { anggota: AnggotaNota | null; mendaftar: boolean; minBelanjaDaftar: number } {
  if (!p) return { anggota: null, mendaftar: false, minBelanjaDaftar: aturan.minBelanjaDaftar };
  // Member dikenali dari nomornya: tanpa nomor yang sah, belum ada member. (Pembeli
  // baru yang belum lengkap menahan tombol simpan — totalnya tetap total member.)
  if (!nomorWhatsApp(p.hp)) return { anggota: null, mendaftar: false, minBelanjaDaftar: aturan.minBelanjaDaftar };
  const member = memberDiketahui(p);
  return {
    anggota: anggotaPratinjau({ member, daftarMember: p.daftarMember, aturan }),
    mendaftar: mintaDaftarMember({ member, daftarMember: p.daftarMember, aturan }),
    minBelanjaDaftar: aturan.minBelanjaDaftar,
  };
}

/**
 * Pembeli untuk dikirim/diantrekan. Pembeli baru yang belum lengkap → null
 * (tombol simpan sudah mati). Permintaan didaftarkan jadi member ikut hanya
 * selama program menerima pendaftaran dan nomornya belum (diketahui) member.
 */
export function pembeliUntukKirim(p: PembeliKeranjang | null, aturan: Pick<AturanMember, "aktif">): PembeliTertahan | null {
  if (!p) return null;
  const daftar = mintaDaftarMember({ member: memberDiketahui(p), daftarMember: p.daftarMember, aturan }) ? { daftarMember: true } : {};
  if (p.jenis === "ada") return { id: p.id, nama: p.nama, ...daftar };
  if (masalahPembeliBaru(p)) return null;
  return { nama: p.nama.trim(), hp: p.hp.trim(), setuju: p.setuju, ...daftar };
}

/**
 * Masalah pertama pembeli baru menurut urutan isiannya. Aturannya sama dengan
 * server (`recordSpgSale`): nama 1–100 huruf, nomor HP yang bisa dihubungi
 * lewat WhatsApp, dan persetujuan pembeli. Nota tanpa sinyal yang ditolak
 * server karena ini baru ketahuan saat terkirim — jadi diperiksa di sini dulu.
 */
export function masalahPembeliBaru(p: { nama: string; hp: string; setuju: boolean }): "NAMA" | "HP" | "SETUJU" | null {
  const nama = p.nama.trim();
  if (!nama || nama.length > 100) return "NAMA";
  const hp = p.hp.trim();
  if (hp.length < 6 || hp.length > 30 || !nomorWhatsApp(hp)) return "HP";
  if (!p.setuju) return "SETUJU";
  return null;
}

export type KekuranganJual =
  | "DISKON_KOSONG"
  | "DISKON_TIDAK_VALID"
  | "ALASAN_DISKON_WAJIB"
  | "DISKON_MANUAL_NONAKTIF"
  | "DISKON_MANUAL_LEWAT_BATAS"
  | "DISKON_MANUAL_TIDAK_VALID"
  | "PEMBELI_NAMA"
  | "PEMBELI_HP"
  | "PEMBELI_SETUJU";

/**
 * Kenapa nota belum bisa disimpan — yang PERTAMA menurut urutan isian di
 * keranjang (diskon dulu, lalu pembeli). `null` = boleh disimpan.
 * `galatMesin` = kode gagal dari `hitungPromoKonter` (diskon melewati batas dst.).
 */
export function kekuranganJual(input: {
  diskon: IsianDiskon | null;
  alasanWajib: boolean;
  galatMesin: "DISKON_MANUAL_NONAKTIF" | "DISKON_MANUAL_LEWAT_BATAS" | "DISKON_MANUAL_TIDAK_VALID" | null;
  pembeli: PembeliKeranjang | null;
}): KekuranganJual | null {
  if (input.diskon) {
    const n = angkaDiskon(input.diskon);
    if (n === null || n === 0) return "DISKON_KOSONG";
    if (!Number.isFinite(n) || n < 0) return "DISKON_TIDAK_VALID";
    if (input.galatMesin) return input.galatMesin;
    if (input.alasanWajib && !input.diskon.alasan.trim()) return "ALASAN_DISKON_WAJIB";
  }
  if (input.pembeli?.jenis === "baru") {
    const m = masalahPembeliBaru(input.pembeli);
    if (m) return `PEMBELI_${m}`;
  }
  return null;
}

/** Satu baris keranjang di layar: kunci `itemId::variantSku`, baris katalog, jumlah. */
export type BarisKeranjang = { kunci: string; row: Pick<SpgCatalogRow, "itemId" | "categoryId" | "price">; qty: number };

/**
 * Total yang DITAGIH dari total persis keranjang (subtotal − seluruh potongan):
 * rupiah utuh lewat `roundToWholeRupiah`, helper yang sama dengan penulis nota
 * (`recordSpgSale`) — uang di konter tidak bersen. `pembulatan` = ditagih −
 * total persis (bisa negatif), yang ditampilkan layar di atas Total.
 */
export function tagihanKeranjang(totalPersis: number): { ditagih: number; pembulatan: number } {
  const ditagih = roundToWholeRupiah(totalPersis);
  return { ditagih, pembulatan: roundCents(ditagih - totalPersis) };
}

export type PratinjauKeranjang = {
  /** Hitungan yang ditampilkan: dengan diskon SPG kalau sah, tanpa diskon kalau mesin menolaknya. */
  hasil: HasilPromoKonter;
  /**
   * Total yang akan dicatat: `hasil.total` dibulatkan ke rupiah utuh
   * (`tagihanKeranjang`). Inilah yang dibandingkan dengan total tercatat.
   */
  ditagih: number;
  /** `ditagih − hasil.total`; 0 kalau total persisnya sudah rupiah utuh. */
  pembulatan: number;
  /** Hitungan tanpa diskon SPG — dasar batas persennya. */
  tanpaManual: HasilPromoKonter;
  /** Kenapa mesin menolak diskon SPG, atau null. */
  galatMesin: GagalPromoKonter["code"] | null;
  /**
   * Pembeli minta didaftarkan tapi nilai notanya (sebelum diskon member) di
   * bawah belanja minimal: nota tercatat TANPA member — hitungan di atas sudah
   * tanpa member. `kurang` = selisihnya. null = tidak berlaku.
   */
  daftarKurang: { minimal: number; kurang: number } | null;
};

/**
 * Pratinjau promo konter + diskon SPG di HP. Masukan mesinnya dibentuk PERSIS
 * seperti penulis nota (`recordSpgSale`): kunci baris `itemId::variantSku`,
 * kategori barang, harga katalog per potong, aturan diskon dari pengaturan yang
 * sama — supaya total di layar sama dengan total tercatat selama harga dan promo
 * tidak berubah. Total yang ditagih dibulatkan ke rupiah utuh dengan helper yang
 * sama dengan penulis nota (`ditagih`). Dipakai juga untuk nota yang dijual tanpa sinyal.
 */
export function pratinjauKeranjang(input: {
  baris: readonly BarisKeranjang[];
  promos: readonly PromoKonter[];
  storeId: string;
  waktu: Date;
  aturan: AturanDiskonManualSpg;
  diskon: IsianDiskon | null;
  /** Member pembeli (`memberKeranjang`); tidak ada = nota tanpa member. */
  member?: { anggota: AnggotaNota | null; mendaftar: boolean; minBelanjaDaftar: number } | null;
}): PratinjauKeranjang | null {
  const dasar = {
    baris: input.baris.map((b) => ({ key: b.kunci, itemId: b.row.itemId, categoryId: b.row.categoryId, qty: b.qty, unitPrice: b.row.price ?? 0 })),
    promos: input.promos,
    storeId: input.storeId,
    waktu: input.waktu,
    aturanManual: input.aturan,
  };
  const manual = input.aturan.aktif ? diskonUntukMesin(input.diskon) : null;
  const hitung = (anggota: AnggotaNota | null): Pick<PratinjauKeranjang, "hasil" | "tanpaManual" | "galatMesin"> | null => {
    const tanpaManual = hitungPromoKonter({ ...dasar, anggota });
    if (!tanpaManual.ok) return null;
    if (!manual) return { hasil: tanpaManual, tanpaManual, galatMesin: null };
    const dengan = hitungPromoKonter({ ...dasar, diskonManual: manual, anggota });
    return dengan.ok ? { hasil: dengan, tanpaManual, galatMesin: null } : { hasil: tanpaManual, tanpaManual, galatMesin: dengan.code };
  };
  const anggota = input.member?.anggota ?? null;
  const awal = hitung(anggota);
  if (!awal) return null;
  // Sama dengan penulis nota: mendaftar di nota ini butuh nilai nota minimal
  // (sesudah promo dan diskon SPG, sebelum diskon member). Tidak tercapai →
  // notanya tetap tercatat, tanpa member dan tanpa harga member.
  if (input.member?.mendaftar && anggota && !awal.galatMesin) {
    const nilai = awal.hasil.total + (awal.hasil.member?.potongan ?? 0);
    const minimal = input.member.minBelanjaDaftar;
    if (nilai < minimal) {
      const tanpa = hitung(null);
      if (!tanpa) return null;
      return { ...tanpa, ...tagihanKeranjang(tanpa.hasil.total), daftarKurang: { minimal, kurang: Math.round((minimal - nilai) * 100) / 100 } };
    }
  }
  return { ...awal, ...tagihanKeranjang(awal.hasil.total), daftarKurang: null };
}
