import { haversineMeters } from "@/lib/geo/haversine";

/**
 * Aturan usulan toko baru dari lapangan — murni, tanpa basis data, supaya
 * dipakai sama persis oleh formulir HP, aksi server, dan layar persetujuan.
 *
 * Salesman menemukan calon toko; admin yang mendaftarkannya. Dua hal dijaga di
 * sini: usulan setengah jadi tidak pernah sampai ke meja admin, dan toko yang
 * sudah ada (atau sudah diusulkan rekan) terlihat SEBELUM ada toko kembar di
 * master — toko kembar memecah piutang dan riwayat kunjungan jadi dua.
 */

/** Lokasi dalam radius ini dianggap "mungkin toko yang sama". */
export const JARAK_DUPLIKAT_METER = 150;
/** Aturan nama longgar (jarak edit, saling memuat) hanya untuk nama sepanjang ini. */
export const PANJANG_MIN_MIRIP = 5;
export const JARAK_EDIT_MAKS = 2;
/** Kandidat yang ditampilkan — cukup untuk dikenali, tidak sampai membanjiri layar HP. */
export const KANDIDAT_MAKS = 10;

export const BATAS_USULAN = {
  nama: 191,
  alamat: 1000,
  kontak: 191,
  catatan: 1000,
  kode: 64,
  alasan: 1000,
  foto: 2048,
} as const;

export type JenisToko = "PUTUS" | "KONSI";

export type GalatUsulan =
  | "NAMA_WAJIB"
  | "NAMA_TERLALU_PANJANG"
  | "ALAMAT_WAJIB"
  | "ALAMAT_TERLALU_PANJANG"
  | "TELEPON_TIDAK_SAH"
  | "KONTAK_TERLALU_PANJANG"
  | "JENIS_TIDAK_SAH"
  | "KOORDINAT_TIDAK_LENGKAP"
  | "KOORDINAT_TIDAK_SAH"
  | "FOTO_WAJIB"
  | "FOTO_TIDAK_SAH"
  | "CATATAN_TERLALU_PANJANG";

export type GalatPersetujuan =
  | Exclude<GalatUsulan, "FOTO_WAJIB" | "FOTO_TIDAK_SAH" | "KOORDINAT_TIDAK_LENGKAP" | "KOORDINAT_TIDAK_SAH" | "CATATAN_TERLALU_PANJANG">
  | "KODE_WAJIB"
  | "KODE_TERLALU_PANJANG"
  | "JENIS_WAJIB"
  | "TEMPO_TIDAK_SAH"
  | "MARGIN_TIDAK_SAH";

export type MasukanUsulanToko = {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  contactName?: string | null;
  /** "PUTUS", "KONSI", atau kosong = "belum tahu". */
  termsType?: string | null;
  groupId?: string | null;
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
  note?: string | null;
};

export type UsulanTokoBersih = {
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: JenisToko | null;
  groupId: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string;
  note: string | null;
};

/**
 * Rapikan spasi: HP sering menyisipkan spasi ganda dari saran papan ketik.
 * Nilai bukan teks (aksi server menerima JSON apa saja) dibaca sebagai kosong.
 */
function rapi(nilai: unknown): string {
  return typeof nilai === "string" ? nilai.replace(/\s+/g, " ").trim() : "";
}

/** Teks berbaris (alamat, catatan): hanya ujung-ujungnya yang dirapikan. */
function potong(nilai: unknown): string {
  return typeof nilai === "string" ? nilai.trim() : "";
}

function atauNull(nilai: string): string | null {
  return nilai === "" ? null : nilai;
}

/**
 * Telepon dibiarkan longgar: orang lapangan menulis "0812-3456 7890",
 * "+62 812…", "(022) 420 1234". Yang ditolak hanya yang jelas bukan nomor —
 * ada huruf, atau jumlah angkanya tidak masuk akal untuk nomor Indonesia.
 */
function teleponSah(telepon: string): boolean {
  const polos = telepon.replace(/[\s\-.()]/g, "");
  return /^\+?\d{6,15}$/.test(polos);
}

/**
 * Foto hanya boleh dari tempat penyimpanan kita sendiri (`/api/foto/...`) atau
 * alamat https. Alamat lain akan ditampilkan apa adanya di layar admin.
 */
function fotoSah(url: string): boolean {
  if (url.length > BATAS_USULAN.foto) return false;
  if (url.startsWith("/")) return !url.startsWith("//");
  return /^https:\/\/[^\s]+$/.test(url);
}

/** Nama, alamat, telepon, kontak — dipakai usulan dan layar persetujuan. */
function periksaIdentitas(
  m: Pick<MasukanUsulanToko, "name" | "address" | "phone" | "contactName">,
  galat: GalatUsulan[],
): { name: string; address: string; phone: string | null; contactName: string | null } {
  const name = rapi(m.name);
  if (name === "") galat.push("NAMA_WAJIB");
  else if (name.length > BATAS_USULAN.nama) galat.push("NAMA_TERLALU_PANJANG");

  // Alamat boleh berbaris; hanya ujung-ujungnya yang dirapikan.
  const address = potong(m.address);
  if (address === "") galat.push("ALAMAT_WAJIB");
  else if (address.length > BATAS_USULAN.alamat) galat.push("ALAMAT_TERLALU_PANJANG");

  const phone = atauNull(rapi(m.phone));
  if (phone !== null && !teleponSah(phone)) galat.push("TELEPON_TIDAK_SAH");

  const contactName = atauNull(rapi(m.contactName));
  if (contactName !== null && contactName.length > BATAS_USULAN.kontak) galat.push("KONTAK_TERLALU_PANJANG");

  return { name, address, phone, contactName };
}

export function validasiUsulanToko(
  m: MasukanUsulanToko,
): { ok: true; data: UsulanTokoBersih } | { ok: false; galat: GalatUsulan[] } {
  const galat: GalatUsulan[] = [];
  const identitas = periksaIdentitas(m, galat);

  const jenis = rapi(m.termsType);
  let termsType: JenisToko | null = null;
  if (jenis === "PUTUS" || jenis === "KONSI") termsType = jenis;
  else if (jenis !== "") galat.push("JENIS_TIDAK_SAH");

  // Satu titik tanpa pasangannya tidak bisa dipetakan — lebih baik ditolak
  // daripada tersimpan setengah dan menjatuhkan toko ke tengah laut.
  const adaLat = m.lat !== null && m.lat !== undefined;
  const adaLng = m.lng !== null && m.lng !== undefined;
  let lat: number | null = null;
  let lng: number | null = null;
  if (adaLat !== adaLng) {
    galat.push("KOORDINAT_TIDAK_LENGKAP");
  } else if (adaLat && adaLng) {
    const la = m.lat as number;
    const ln = m.lng as number;
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      galat.push("KOORDINAT_TIDAK_SAH");
    } else {
      lat = la;
      lng = ln;
    }
  }

  const photoUrl = potong(m.photoUrl);
  if (photoUrl === "") galat.push("FOTO_WAJIB");
  else if (!fotoSah(photoUrl)) galat.push("FOTO_TIDAK_SAH");

  const note = atauNull(potong(m.note));
  if (note !== null && note.length > BATAS_USULAN.catatan) galat.push("CATATAN_TERLALU_PANJANG");

  if (galat.length > 0) return { ok: false, galat };
  return {
    ok: true,
    data: { ...identitas, termsType, groupId: atauNull(rapi(m.groupId)), lat, lng, photoUrl, note },
  };
}

/* ------------------------------------------------------------------ */
/* Duplikat                                                             */
/* ------------------------------------------------------------------ */

const KATA_BUANG = new Set(["toko", "tk"]);

/**
 * Bentuk nama untuk dibandingkan: huruf kecil, tanpa aksen dan tanda baca,
 * tanpa kata "toko"/"tk" — "TOKO Sinar-Jaya", "Tk. Sinar Jaya", dan
 * "Sinar Jaya" adalah toko yang sama di mata salesman.
 */
export function normalisasiNamaToko(nama: string): string {
  return nama
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((kata) => kata !== "" && !KATA_BUANG.has(kata))
    .join(" ");
}

/** Jarak Levenshtein (sisip, hapus, ganti). Nama toko pendek; dua baris cukup. */
export function jarakEdit(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let sebelum = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const sekarang = [i];
    for (let j = 1; j <= b.length; j++) {
      const ganti = a[i - 1] === b[j - 1] ? 0 : 1;
      sekarang[j] = Math.min(sebelum[j] + 1, sekarang[j - 1] + 1, sebelum[j - 1] + ganti);
    }
    sebelum = sekarang;
  }
  return sebelum[b.length];
}

/**
 * Sama persis setelah dinormalisasi selalu mirip. Aturan longgar — beda paling
 * banyak dua huruf, atau yang satu memuat yang lain — hanya untuk nama yang
 * cukup panjang: "Ani" dan "Ana" beda satu huruf tapi jelas dua toko.
 */
export function namaMirip(a: string, b: string): boolean {
  const na = normalisasiNamaToko(a);
  const nb = normalisasiNamaToko(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) < PANJANG_MIN_MIRIP) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  return jarakEdit(na, nb) <= JARAK_EDIT_MAKS;
}

/** "~80 m" lebih mudah dibaca daripada "83,4 m" — ketepatan GPS HP pun tidak lebih baik. */
export function pembulatanJarak(meter: number): number {
  if (meter < 10) return Math.max(1, Math.round(meter));
  return Math.round(meter / 10) * 10;
}

/** Toko di master atau usulan yang masih menunggu, sebagai bahan pembanding. */
export type Pembanding = {
  jenis: "TOKO" | "USULAN";
  id: string;
  /** Kode toko; usulan belum punya. */
  code: string | null;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  /** Toko nonaktif tetap dibandingkan: mengaktifkannya lagi lebih baik daripada membuat kembarannya. */
  aktif: boolean;
};

export type KandidatDuplikat = Pembanding & {
  namaMirip: boolean;
  /** Terisi (sudah dibulatkan) hanya bila lokasinya dalam radius duplikat. */
  jarakMeter: number | null;
};

/**
 * Toko yang mungkin sama dengan usulan: namanya mirip dan/atau lokasinya
 * berdekatan. Nama mirip didahulukan — di pasar, puluhan toko berbeda berdiri
 * dalam 150 m, jadi "berdekatan" saja adalah bukti yang lemah.
 */
export function cariKandidatDuplikat(
  usulan: { name: string; lat: number | null; lng: number | null },
  pembanding: Pembanding[],
  opsi: { kecualiUsulanId?: string | null; kecualiTokoId?: string | null } = {},
): KandidatDuplikat[] {
  const adaTitik = usulan.lat !== null && usulan.lng !== null;
  const hasil: KandidatDuplikat[] = [];
  for (const p of pembanding) {
    if (p.jenis === "USULAN" && opsi.kecualiUsulanId && p.id === opsi.kecualiUsulanId) continue;
    if (p.jenis === "TOKO" && opsi.kecualiTokoId && p.id === opsi.kecualiTokoId) continue;
    const mirip = namaMirip(usulan.name, p.name);
    let jarakMeter: number | null = null;
    if (adaTitik && p.lat !== null && p.lng !== null) {
      const m = haversineMeters({ lat: usulan.lat as number, lng: usulan.lng as number }, { lat: p.lat, lng: p.lng });
      if (m <= JARAK_DUPLIKAT_METER) jarakMeter = pembulatanJarak(m);
    }
    if (mirip || jarakMeter !== null) hasil.push({ ...p, namaMirip: mirip, jarakMeter });
  }
  const skor = (k: KandidatDuplikat) => (k.namaMirip ? 2 : 0) + (k.jarakMeter !== null ? 1 : 0);
  hasil.sort(
    (a, b) =>
      skor(b) - skor(a) ||
      (a.jarakMeter ?? Number.POSITIVE_INFINITY) - (b.jarakMeter ?? Number.POSITIVE_INFINITY) ||
      (a.jenis === b.jenis ? 0 : a.jenis === "TOKO" ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );
  return hasil.slice(0, KANDIDAT_MAKS);
}

/* ------------------------------------------------------------------ */
/* Persetujuan                                                          */
/* ------------------------------------------------------------------ */

const KODE_BAWAAN = "TK-001";

/**
 * Kode toko berikutnya menurut pola yang paling banyak dipakai ("TK-003" →
 * "TK-004"), dengan jumlah nol di depan yang sama. Hanya saran — admin tetap
 * bisa mengetik kode lain, dan keunikan dijaga basis data.
 */
export function saranKodeToko(kodeAda: string[]): string {
  const pola = new Map<string, { jumlah: number; maks: number; lebar: number }>();
  for (const kode of kodeAda) {
    const cocok = /^(.*?)(\d+)$/.exec(kode.trim());
    if (!cocok) continue;
    const [, awalan, angka] = cocok;
    const p = pola.get(awalan) ?? { jumlah: 0, maks: 0, lebar: 0 };
    p.jumlah += 1;
    p.maks = Math.max(p.maks, Number(angka));
    p.lebar = Math.max(p.lebar, angka.length);
    pola.set(awalan, p);
  }
  const terbaik = [...pola.entries()].sort((a, b) => b[1].jumlah - a[1].jumlah || b[1].maks - a[1].maks)[0];
  if (!terbaik) return KODE_BAWAAN;
  const [awalan, p] = terbaik;
  const terpakai = new Set(kodeAda.map((k) => k.trim()));
  let berikut = p.maks + 1;
  let kode = `${awalan}${String(berikut).padStart(p.lebar, "0")}`;
  while (terpakai.has(kode)) {
    berikut += 1;
    kode = `${awalan}${String(berikut).padStart(p.lebar, "0")}`;
  }
  return kode;
}

export type MasukanPersetujuan = {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  contactName?: string | null;
  code?: string | null;
  termsType?: string | null;
  groupId?: string | null;
  salesmanId?: string | null;
  paymentTempo?: number | null;
  isPkp?: boolean | null;
  marginPercent?: number | null;
};

export type PersetujuanBersih = {
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  code: string;
  termsType: JenisToko;
  groupId: string | null;
  salesmanId: string | null;
  paymentTempo: number;
  isPkp: boolean;
  marginPercent: number | null;
};

/**
 * Isian admin saat menyetujui. Nama/alamat/telepon/kontak boleh dirapikan admin
 * (salah ketik dari lapangan), jadi diperiksa ulang dengan aturan yang sama.
 * Margin hanya bermakna untuk konsinyasi, dan di bawah 100% — harga jual
 * konsinyasi dihitung `harga / (1 − margin)`.
 */
export function validasiPersetujuan(
  m: MasukanPersetujuan,
): { ok: true; data: PersetujuanBersih } | { ok: false; galat: GalatPersetujuan[] } {
  const galatIdentitas: GalatUsulan[] = [];
  const identitas = periksaIdentitas(m, galatIdentitas);
  const galat: GalatPersetujuan[] = galatIdentitas as GalatPersetujuan[];

  const code = rapi(m.code);
  if (code === "") galat.push("KODE_WAJIB");
  else if (code.length > BATAS_USULAN.kode) galat.push("KODE_TERLALU_PANJANG");

  const jenis = rapi(m.termsType);
  let termsType: JenisToko | null = null;
  if (jenis === "PUTUS" || jenis === "KONSI") termsType = jenis;
  else if (jenis === "") galat.push("JENIS_WAJIB");
  else galat.push("JENIS_TIDAK_SAH");

  const paymentTempo: number = m.paymentTempo ?? 0;
  if (!Number.isInteger(paymentTempo) || paymentTempo < 0 || paymentTempo > 365) galat.push("TEMPO_TIDAK_SAH");

  let marginPercent: number | null = null;
  if (termsType === "KONSI" && m.marginPercent !== null && m.marginPercent !== undefined) {
    const margin = m.marginPercent;
    if (!Number.isFinite(margin) || margin < 0 || margin >= 100) galat.push("MARGIN_TIDAK_SAH");
    else marginPercent = Math.round(margin * 100) / 100;
  }

  if (galat.length > 0 || termsType === null) return { ok: false, galat };
  return {
    ok: true,
    data: {
      ...identitas,
      code,
      termsType,
      groupId: atauNull(rapi(m.groupId)),
      salesmanId: atauNull(rapi(m.salesmanId)),
      paymentTempo,
      isPkp: m.isPkp === true,
      marginPercent,
    },
  };
}
