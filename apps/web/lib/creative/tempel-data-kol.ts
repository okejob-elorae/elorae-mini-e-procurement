/**
 * "Tempel balasan WhatsApp" di formulir KOL — murni, aman untuk klien. Pemilik menghubungi KOL lewat
 * WhatsApp (template `alamat` meminta "Nama penerima / No. HP / Alamat lengkap / Kecamatan / Kota /
 * Kode pos / Ukuran"); balasannya cukup ditempel dan dipilah ke isian formulir. Hasilnya MENGISI
 * formulir saja — pemilik memeriksa lalu menyimpan sendiri.
 *
 * Yang dibaca: baris "Label: nilai" (juga "Label = nilai", "*Label*:", bernomor, berbullet) dengan
 * sinonim Indonesia; baris tanpa label sesudah "Alamat" dianggap lanjutan alamat; kecamatan/kelurahan
 * digabung ke alamat (Elorae tidak punya kolomnya); email, nomor WA dan kode pos 5 angka dikenali juga
 * tanpa label; "Ukuran: M / 28" dipecah menjadi atasan dan bawahan. Rekening TIDAK dibaca dari chat.
 */

export type KolomTempel =
  | "recipientName"
  | "phone"
  | "email"
  | "address"
  | "city"
  | "province"
  | "postalCode"
  | "atasan"
  | "bawahan"
  | "tinggi"
  | "hijab"
  | "catatanFit";

export type HasilTempel = { isi: Partial<Record<KolomTempel, string>>; tidakTerbaca: string[] };

type Sasaran = KolomTempel | "kecamatan" | "kelurahan" | "ukuran" | "abaikan";

/** Label (sudah dinormalkan: huruf kecil, tanpa tanda baca) → kolom. Urutan tidak penting; dicocokkan utuh. */
const LABEL: Record<string, Sasaran> = {
  nama: "recipientName",
  "nama penerima": "recipientName",
  "nama lengkap": "recipientName",
  penerima: "recipientName",
  "atas nama": "recipientName",
  an: "recipientName",
  "a n": "recipientName",
  hp: "phone",
  "no hp": "phone",
  "nomor hp": "phone",
  "no handphone": "phone",
  handphone: "phone",
  wa: "phone",
  "no wa": "phone",
  "nomor wa": "phone",
  whatsapp: "phone",
  "no whatsapp": "phone",
  "nomor whatsapp": "phone",
  telp: "phone",
  telepon: "phone",
  "no telp": "phone",
  "no telepon": "phone",
  "nomor telepon": "phone",
  "no hp wa": "phone",
  kontak: "phone",
  email: "email",
  "e mail": "email",
  surel: "email",
  alamat: "address",
  "alamat lengkap": "address",
  "alamat rumah": "address",
  "alamat kirim": "address",
  "alamat pengiriman": "address",
  jalan: "address",
  kecamatan: "kecamatan",
  kec: "kecamatan",
  kelurahan: "kelurahan",
  kel: "kelurahan",
  desa: "kelurahan",
  "kelurahan desa": "kelurahan",
  kota: "city",
  kabupaten: "city",
  kab: "city",
  "kota kabupaten": "city",
  "kota kab": "city",
  "kab kota": "city",
  "kabupaten kota": "city",
  provinsi: "province",
  prov: "province",
  "kode pos": "postalCode",
  kodepos: "postalCode",
  "kd pos": "postalCode",
  "kode pos zip": "postalCode",
  zip: "postalCode",
  ukuran: "ukuran",
  size: "ukuran",
  "ukuran baju": "atasan",
  "size baju": "atasan",
  baju: "atasan",
  atasan: "atasan",
  "ukuran atasan": "atasan",
  "size atasan": "atasan",
  "ukuran kaos": "atasan",
  "ukuran celana": "bawahan",
  "size celana": "bawahan",
  celana: "bawahan",
  bawahan: "bawahan",
  "ukuran bawahan": "bawahan",
  "size bawahan": "bawahan",
  rok: "bawahan",
  "ukuran rok": "bawahan",
  tinggi: "tinggi",
  "tinggi badan": "tinggi",
  tb: "tinggi",
  hijab: "hijab",
  berhijab: "hijab",
  jilbab: "hijab",
  hijaber: "hijab",
  "pakai hijab": "hijab",
  catatan: "catatanFit",
  "catatan ukuran": "catatanFit",
  "catatan fit": "catatanFit",
  fit: "catatanFit",
};

const BATAS: Record<KolomTempel, number> = {
  recipientName: 120,
  phone: 40,
  email: 120,
  address: 2000,
  city: 120,
  province: 120,
  postalCode: 20,
  atasan: 20,
  bawahan: 20,
  tinggi: 10,
  hijab: 5,
  catatanFit: 300,
};

const POLA_EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
const POLA_WA = /(?:\+?62|0)8[\d\s.-]{7,15}\d/;

/** "*Nama Penerima* :" → "nama penerima". Membuang bullet, nomor urut, emoji dan tanda baca. */
function normalLabel(teks: string): string {
  return teks
    .toLowerCase()
    .replace(/[*_~`]/g, "")
    .replace(/^\s*(?:\d+[.)]|[-•●▪◦·>])\s*/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pecah "Label : nilai". Pemisah: titik dua, sama dengan, atau tanda hubung yang diapit spasi. */
function pecahBaris(baris: string): { label: string; nilai: string } | null {
  const m = /^(.{1,40}?)\s*(?::|=|\s-\s|\s–\s)\s*(.*)$/.exec(baris);
  if (!m) {
    // Tanpa pemisah ("Kodepos 16110", "TB 158"): hanya label angka, dan nilainya harus memuat angka —
    // "Nama saya Ocha" tidak boleh terbaca sebagai nama "saya Ocha".
    const t = /^\s*(?:\d+[.)]|[-•●▪◦·>])?\s*\*?(kode\s*pos|kodepos|kd\s*pos|tb|tinggi\s+badan|no\.?\s*(?:hp|wa)|wa|hp)\*?\s+(.*\d.*)$/i.exec(baris);
    return t ? { label: normalLabel(t[1]), nilai: t[2].trim() } : null;
  }
  const label = normalLabel(m[1]);
  if (!(label in LABEL)) return null;
  return { label, nilai: m[2].replace(/[*_~`]/g, "").trim() };
}

function hijabDari(nilai: string): string | null {
  const t = normalLabel(nilai);
  if (/^(ya|iya|yes|y|berhijab|pakai|hijab|hijaber|ok)\b/.test(t)) return "ya";
  if (/^(tidak|tdk|ga|gak|nggak|enggak|no|n|non|belum|engga)\b/.test(t)) return "tidak";
  return null;
}

function tinggiDari(nilai: string): string | null {
  const m = /(\d{2,3})(?:[.,]\d+)?\s*(?:cm)?/i.exec(nilai);
  return m ? m[1] : null;
}

export function bacaBalasanWa(teks: string): HasilTempel {
  const isi: Partial<Record<KolomTempel, string>> = {};
  const tidakTerbaca: string[] = [];
  const tambahanAlamat: string[] = [];
  let terakhir: Sasaran | null = null;

  const set = (k: KolomTempel, v: string) => {
    const bersih = v.trim();
    if (!bersih || isi[k] !== undefined) return;
    isi[k] = bersih.slice(0, BATAS[k]);
  };

  const baris = (teks ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  for (const b of baris) {
    const p = pecahBaris(b);
    if (!p) {
      // Baris tanpa label: lanjutan alamat bila baris sebelumnya alamat; selain itu dicoba dikenali dari bentuknya.
      if (terakhir === "address" && isi.address !== undefined && !POLA_EMAIL.test(b) && !/^\d{5}$/.test(b)) {
        isi.address = `${isi.address}\n${b}`.slice(0, BATAS.address);
        continue;
      }
      const email = POLA_EMAIL.exec(b)?.[0];
      if (email && isi.email === undefined) {
        set("email", email);
        continue;
      }
      const wa = POLA_WA.exec(b)?.[0];
      if (wa && isi.phone === undefined && b.replace(wa, "").replace(/[^\p{L}]/gu, "").length < 4) {
        set("phone", wa);
        continue;
      }
      if (/^\d{5}$/.test(b) && isi.postalCode === undefined) {
        set("postalCode", b);
        continue;
      }
      tidakTerbaca.push(b);
      terakhir = null;
      continue;
    }

    const sasaran = LABEL[p.label];
    terakhir = sasaran;
    if (!p.nilai) continue;
    switch (sasaran) {
      case "kecamatan":
        tambahanAlamat.push(`Kec. ${p.nilai.replace(/^kec(?:amatan)?\.?\s*/i, "")}`);
        break;
      case "kelurahan":
        tambahanAlamat.push(`Kel. ${p.nilai.replace(/^(?:kel(?:urahan)?|desa)\.?\s*/i, "")}`);
        break;
      case "ukuran": {
        const bagian = p.nilai.split(/\s*(?:\/|,|&|\bdan\b)\s*/i).filter(Boolean);
        if (bagian.length >= 2) {
          set("atasan", bagian[0]);
          set("bawahan", bagian[1]);
        } else set("atasan", p.nilai);
        break;
      }
      case "hijab": {
        const h = hijabDari(p.nilai);
        if (h) set("hijab", h);
        else tidakTerbaca.push(b);
        break;
      }
      case "tinggi": {
        const t = tinggiDari(p.nilai);
        if (t) set("tinggi", t);
        else tidakTerbaca.push(b);
        break;
      }
      case "postalCode": {
        const kode = /\d{5}/.exec(p.nilai.replace(/\s/g, ""))?.[0];
        if (kode) set("postalCode", kode);
        else tidakTerbaca.push(b);
        break;
      }
      case "abaikan":
        break;
      default:
        set(sasaran, p.nilai);
    }
  }

  if (tambahanAlamat.length) {
    isi.address = [isi.address, ...tambahanAlamat].filter(Boolean).join(", ").slice(0, BATAS.address);
  }
  return { isi, tidakTerbaca };
}
