/**
 * WhatsApp ke KOL — murni, aman untuk klien.
 *
 * Nomor dinormalkan ke bentuk "62…" (dipakai untuk wa.me dan untuk mencari
 * kembar), template diisi variabel, dan pengaturannya (`kreatif.templateWa`,
 * `kreatif.identitas`) dibaca dengan bawaan bila kosong.
 *
 * Pesan ke KOL boleh menyapa "kak" — itu bahasa ke luar. Yang tidak dipakai
 * adalah "kamu".
 */

import { rupiahTeks } from "./angka-konten";

export const KUNCI_TEMPLATE_WA = "kreatif.templateWa";
export const KUNCI_IDENTITAS = "kreatif.identitas";

/**
 * Nomor HP Indonesia → "62…", atau `null` bila tidak bisa dipakai.
 *
 * Menerima 0812…, +62 812…, 62812…, 620812… (nol yang ikut tertulis sesudah
 * kode negara), dan 812… (tanpa awalan sama sekali). Tanda baca dibuang.
 */
export function normalisasiWa(input: string | null | undefined): string | null {
  let d = (input ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("620")) d = `62${d.slice(3)}`;
  else if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  if (!d.startsWith("62")) return null;
  // 62 + 8–13 digit nomor pelanggan.
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Tautan wa.me, dengan pesan bila ada. `null` bila nomornya tidak bisa dipakai. */
export function tautanWa(nomor: string | null | undefined, pesan?: string | null): string | null {
  const n = normalisasiWa(nomor);
  if (!n) return null;
  return pesan ? `https://wa.me/${n}?text=${encodeURIComponent(pesan)}` : `https://wa.me/${n}`;
}

export const VARIABEL_WA = [
  "nama",
  "username",
  "platform",
  "campaign",
  "produk",
  "resi",
  "ekspedisi",
  "brand",
  "pengirim",
  "fee",
] as const;

export type VariabelWa = Record<(typeof VARIABEL_WA)[number], string | null>;

const POLA_VARIABEL = /\{([a-zA-Z_]+)\}/g;
const DIKENAL: ReadonlySet<string> = new Set(VARIABEL_WA);

/**
 * Isi template. Variabel yang tidak dikenal dibiarkan apa adanya; variabel yang
 * dikenal tapi kosong JUGA dibiarkan ("{resi}") supaya kelihatan belum terisi
 * sebelum pesannya terkirim.
 */
export function isiTemplate(isi: string, vars: Partial<Record<string, string | null | undefined>>): string {
  return isi.replace(POLA_VARIABEL, (utuh, nama: string) => {
    const v = vars[nama];
    return typeof v === "string" && v.trim() ? v : utuh;
  });
}

/** Variabel yang muncul di sebuah isi, tanpa kembar, menurut urutan muncul. */
export function variabelDalam(isi: string): string[] {
  return [...new Set([...isi.matchAll(POLA_VARIABEL)].map((m) => m[1]))];
}

export function variabelTakDikenal(isi: string): string[] {
  return variabelDalam(isi).filter((v) => !DIKENAL.has(v));
}

export type IdentitasKreatif = { pengirim: string; brand: string; produk: string };

/** Panjang maksimum tiap isian identitas (pengirim, brand, produk). */
export const BATAS_IDENTITAS = 80;

export const IDENTITAS_BAWAAN: IdentitasKreatif = { pengirim: "Tim Eloraé", brand: "Eloraé", produk: "koleksi terbaru" };

function keNilai(nilai: unknown): unknown {
  if (typeof nilai !== "string") return nilai;
  if (!nilai.trim()) return null;
  try {
    return JSON.parse(nilai);
  } catch {
    return null;
  }
}

export function bacaIdentitas(nilai: unknown): IdentitasKreatif {
  const o = keNilai(nilai);
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ...IDENTITAS_BAWAAN };
  const x = o as Record<string, unknown>;
  const teks = (v: unknown, bawaan: string) => (typeof v === "string" && v.trim() ? v.trim() : bawaan);
  return {
    pengirim: teks(x.pengirim, IDENTITAS_BAWAAN.pengirim),
    brand: teks(x.brand, IDENTITAS_BAWAAN.brand),
    produk: teks(x.produk, IDENTITAS_BAWAAN.produk),
  };
}

export type TemplateWa = { kunci: string; nama: string; isi: string };

/** Tujuh template bawaan versi Eloraé. */
export const TEMPLATE_BAWAAN: TemplateWa[] = [
  {
    kunci: "perkenalan",
    nama: "Perkenalan pertama",
    isi: [
      "Halo kak {nama} 👋",
      "",
      "Saya {pengirim} dari {brand}. Kami sering lihat konten kakak di {platform} dan rasanya pas sekali dengan {produk} kami.",
      "",
      "Apakah kakak terbuka untuk kolaborasi? Kalau iya, boleh kami minta rate card dan jadwal yang masih kosong?",
      "",
      "Terima kasih banyak, kak 🙏",
    ].join("\n"),
  },
  {
    kunci: "follow-up",
    nama: "Follow-up belum dibalas",
    isi: [
      "Halo kak {nama}, maaf mengganggu 🙏",
      "",
      "Saya {pengirim} dari {brand}, mau menanyakan lagi pesan kami sebelumnya soal kolaborasi {produk}. Apakah kakak masih berminat?",
      "",
      "Kalau jadwalnya sedang penuh, kabari saja kak — kami bisa menyesuaikan.",
    ].join("\n"),
  },
  {
    kunci: "alamat",
    nama: "Minta alamat kirim",
    isi: [
      "Terima kasih sudah mau kolaborasi dengan {brand}, kak {nama} 🎉",
      "",
      "Supaya {produk} bisa segera kami kirim, boleh dibantu isi data berikut?",
      "",
      "Nama penerima :",
      "No. HP        :",
      "Alamat lengkap:",
      "Kecamatan     :",
      "Kota          :",
      "Kode pos      :",
      "Ukuran        :",
      "",
      "Terima kasih, kak 😊",
    ].join("\n"),
  },
  {
    kunci: "resi",
    nama: "Info resi",
    isi: [
      "Halo kak {nama}, paket {produk} dari {brand} sudah kami kirim 📦",
      "",
      "Ekspedisi : {ekspedisi}",
      "No. resi  : {resi}",
      "",
      "Nanti kalau paketnya sudah sampai, kabari kami ya kak 🙏",
    ].join("\n"),
  },
  {
    kunci: "pengingat",
    nama: "Pengingat konten",
    isi: [
      "Halo kak {nama} 😊",
      "",
      "Bagaimana {produk}-nya, sudah sampai dan sempat dicoba? Kira-kira kontennya direncanakan tayang kapan, kak?",
      "",
      "Kalau perlu, brief-nya bisa kami kirim ulang.",
    ].join("\n"),
  },
  {
    kunci: "minta-link",
    nama: "Minta link konten",
    isi: [
      "Halo kak {nama} 🙌",
      "",
      "Apakah konten untuk {brand} sudah tayang? Boleh minta link-nya untuk rekap kami?",
      "",
      "Terima kasih banyak, kak 🙏",
    ].join("\n"),
  },
  {
    kunci: "terima-kasih",
    nama: "Terima kasih & lanjut",
    isi: [
      "Kak {nama}, terima kasih banyak untuk kontennya 🎉",
      "",
      "Hasilnya bagus sekali dan kami ingin lanjut kerja sama di campaign {brand} berikutnya. Nanti kami hubungi lagi ya, kak.",
      "",
      "Salam hangat,",
      "{pengirim}",
    ].join("\n"),
  },
];

/** Batas yang menjaga baris pengaturan tetap wajar. */
export const BATAS_TEMPLATE = { jumlah: 30, nama: 80, isi: 2000 } as const;

function rapikanTemplate(x: unknown): TemplateWa | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.kunci !== "string" || typeof o.nama !== "string" || typeof o.isi !== "string") return null;
  const t = { kunci: o.kunci.trim(), nama: o.nama.trim(), isi: o.isi.trimEnd() };
  return t.kunci && t.nama && t.isi.trim() ? t : null;
}

/**
 * Pembaca pengaturan template. Baris kosong atau rusak = bawaan; daftar kosong
 * yang memang disimpan dihormati (pemilik boleh menghapus semuanya).
 */
export function bacaTemplateWa(nilai: unknown): TemplateWa[] {
  const o = keNilai(nilai);
  if (!Array.isArray(o)) return TEMPLATE_BAWAAN.map((t) => ({ ...t }));
  return o.map(rapikanTemplate).filter((t): t is TemplateWa => t !== null);
}

export type HasilValidasiTemplate =
  | { ok: true; templates: TemplateWa[] }
  | { ok: false; kode: "TIDAK_VALID" | "TERLALU_BANYAK" }
  | { ok: false; kode: "NAMA_WAJIB" | "ISI_WAJIB" | "KUNCI_KEMBAR" | "TERLALU_PANJANG"; indeks: number };

export function validasiTemplateWa(input: unknown): HasilValidasiTemplate {
  if (!Array.isArray(input)) return { ok: false, kode: "TIDAK_VALID" };
  if (input.length > BATAS_TEMPLATE.jumlah) return { ok: false, kode: "TERLALU_BANYAK" };
  const kunci = new Set<string>();
  const templates: TemplateWa[] = [];
  for (const [indeks, x] of input.entries()) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const nama = typeof o.nama === "string" ? o.nama.trim() : "";
    const isi = typeof o.isi === "string" ? o.isi.trimEnd() : "";
    const k = typeof o.kunci === "string" && o.kunci.trim() ? o.kunci.trim() : `template-${indeks + 1}`;
    if (!nama) return { ok: false, kode: "NAMA_WAJIB", indeks };
    if (!isi.trim()) return { ok: false, kode: "ISI_WAJIB", indeks };
    if (nama.length > BATAS_TEMPLATE.nama || isi.length > BATAS_TEMPLATE.isi) return { ok: false, kode: "TERLALU_PANJANG", indeks };
    if (kunci.has(k)) return { ok: false, kode: "KUNCI_KEMBAR", indeks };
    kunci.add(k);
    templates.push({ kunci: k, nama, isi });
  }
  return { ok: true, templates };
}

/**
 * Variabel pesan untuk satu kolaborasi. `nama` jatuh ke username bila nama
 * KOL kosong; `produk` dari pengiriman terbaru, jatuh ke produk utama di
 * identitas; `fee` diformat "Rp …" (kosong bila nol).
 */
export function susunVariabel(i: {
  namaKol?: string | null;
  username?: string | null;
  platform?: string | null;
  campaign?: string | null;
  produk?: string | null;
  resi?: string | null;
  ekspedisi?: string | null;
  fee?: number | null;
  identitas: IdentitasKreatif;
}): VariabelWa {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const username = t(i.username)?.replace(/^@/, "") ?? null;
  return {
    nama: t(i.namaKol) ?? username,
    username,
    platform: t(i.platform),
    campaign: t(i.campaign),
    produk: t(i.produk) ?? t(i.identitas.produk),
    resi: t(i.resi),
    ekspedisi: t(i.ekspedisi),
    brand: t(i.identitas.brand),
    pengirim: t(i.identitas.pengirim),
    fee: i.fee && i.fee > 0 ? rupiahTeks(i.fee) : null,
  };
}
