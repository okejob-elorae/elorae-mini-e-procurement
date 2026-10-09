import { bacaTanggal, jumlahHari, rentangCepat, urutkanRentang } from "@/lib/tanggal-isian";
import { selisihHari } from "@/lib/creative/tenggat";
import type { BarisTugas, KunciTugas } from "@/lib/creative/tugas";

/*
 * Hari ini Ruang KOL — bagian murni halaman. Aman untuk klien: tanpa Prisma,
 * tanpa next-intl. Halaman server membaca alamatnya lewat `bacaParamHariIni`;
 * kliennya menulis balik lewat `alamatHariIni`, jadi tautan yang dibagikan
 * membuka periode yang sama.
 */

export const RUTE_HARI_INI = "/backoffice/kreatif";

export const PILIHAN_PERIODE = ["hariIni", "tujuhHari", "tigaPuluhHari", "bulanIni", "bulanLalu", "rentang"] as const;
export type PilihanPeriode = (typeof PILIHAN_PERIODE)[number];

/** Periode bila alamat tidak menyebut `?periode=`. */
export const PERIODE_BAWAAN: PilihanPeriode = "bulanIni";

/** Rentang khusus paling panjang (hari, inklusif). */
export const MAKS_HARI_RENTANG = 366;

export type ParamHariIni = {
  periode: PilihanPeriode;
  /** Hari WIB "YYYY-MM-DD", inklusif. */
  dari: string;
  sampai: string;
  /** `?campaign=<id>`; null = semua campaign. */
  campaign: string | null;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Rentang untuk pilihan cepat; `rentang` memakai dari/sampai yang diberikan. */
export function rentangPeriode(p: Exclude<PilihanPeriode, "rentang">, hariIni: string): { dari: string; sampai: string } {
  return rentangCepat(p, hariIni);
}

export function bacaParamHariIni(sp: IsiAlamat, hariIni: string): ParamHariIni {
  const mentah = satu(sp.periode);
  const periode = (PILIHAN_PERIODE as readonly string[]).includes(mentah ?? "") ? (mentah as PilihanPeriode) : PERIODE_BAWAAN;
  const campaignMentah = satu(sp.campaign)?.trim() ?? "";
  const campaign = campaignMentah && campaignMentah.length <= 64 ? campaignMentah : null;

  if (periode === "rentang") {
    const a = satu(sp.dari) ?? "";
    const b = satu(sp.sampai) ?? "";
    if (bacaTanggal(a) && bacaTanggal(b)) {
      const r = urutkanRentang(a, b);
      if (jumlahHari(r.dari, r.sampai) <= MAKS_HARI_RENTANG) return { periode, ...r, campaign };
    }
    // Rentang rusak atau terlalu panjang: kembali ke bawaan, bukan diam-diam dipotong.
    return { periode: PERIODE_BAWAAN, ...rentangPeriode(PERIODE_BAWAAN as Exclude<PilihanPeriode, "rentang">, hariIni), campaign };
  }
  return { periode, ...rentangPeriode(periode, hariIni), campaign };
}

/** Alamat untuk keadaan `p`; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatHariIni(p: ParamHariIni): string {
  const q = new URLSearchParams();
  if (p.periode !== PERIODE_BAWAAN) q.set("periode", p.periode);
  if (p.periode === "rentang") {
    q.set("dari", p.dari);
    q.set("sampai", p.sampai);
  }
  if (p.campaign) q.set("campaign", p.campaign);
  const qs = q.toString();
  return qs ? `${RUTE_HARI_INI}?${qs}` : RUTE_HARI_INI;
}

/** Kelompok dengan baris sebanyak ini atau kurang terbuka sendiri. */
export const TERBUKA_SAMPAI = 5;

/** Baris yang ditampilkan per kelompok sebelum "Tampilkan semua". */
export const BARIS_AWAL = 50;

export type UmurTugas =
  | { jenis: "TELAT"; hari: number }
  | { jenis: "H_MIN"; hari: number }
  | { jenis: "HARI_INI" }
  | { jenis: "UMUR"; hari: number }
  /** Hari sejak deal (data kirim kurang, kirim dobel) — ditulis "N hari sejak deal". */
  | { jenis: "UMUR_DEAL"; hari: number }
  /** Hari di tahap sekarang (KOL diblokir). */
  | { jenis: "UMUR_TAHAP"; hari: number }
  | null;

/**
 * Umur yang ditulis di baris tugas:
 *   - agenda: "H-n" sebelum harinya, "hari ini", "telat n hari" sesudahnya;
 *   - kelompok bertenggat: "telat n hari" sejak TENGGATNYA (bukan sejak jam
 *     hitungnya mulai) — tenggat yang jatuh hari ini belum terlambat, jadi
 *     tidak pernah masuk kelompok ini;
 *   - kirim dobel, data kirim, KOL diblokir: umur sejak deal/tahap;
 *   - budget campaign: tanpa umur.
 */
export function umurTugas(kunci: KunciTugas, b: BarisTugas, hariIni: string): UmurTugas {
  if (kunci === "BUDGET_CAMPAIGN") return null;
  if (kunci === "AGENDA") {
    if (b.umurHari < 0) return { jenis: "H_MIN", hari: -b.umurHari };
    if (b.umurHari === 0) return { jenis: "HARI_INI" };
    return { jenis: "TELAT", hari: b.umurHari };
  }
  if (kunci === "KIRIM_DOBEL" || kunci === "DATA_KIRIM_KURANG") return { jenis: "UMUR_DEAL", hari: Math.max(0, b.umurHari) };
  if (kunci === "KOL_DIBLOKIR") return { jenis: "UMUR_TAHAP", hari: Math.max(0, b.umurHari) };
  const tenggat = b.info.tanggal;
  if (!tenggat) return { jenis: "UMUR", hari: Math.max(0, b.umurHari) };
  const telat = selisihHari(tenggat, hariIni);
  return telat > 0 ? { jenis: "TELAT", hari: telat } : { jenis: "HARI_INI" };
}

/** Disorot merah: terlambat, atau mengendap lebih lama dari ambang umur tahap. */
export function umurMerah(u: UmurTugas, ambangUmurHari: number): boolean {
  if (!u) return false;
  if (u.jenis === "TELAT") return true;
  return (u.jenis === "UMUR" || u.jenis === "UMUR_DEAL" || u.jenis === "UMUR_TAHAP") && u.hari > ambangUmurHari;
}

export type AksiTugas = "kirimSampel" | "tandaiDiterima" | "tempelLink" | "reviewDraf" | "isiAngka" | "bayar" | "lengkapiData";

/**
 * Pintasan ke layar tempat pekerjaannya diselesaikan. Kontrak alamat untuk
 * layar Sampel, Konten KOL, dan Pembayaran: `?kolaborasi=<id>` menyorot/
 * menyaring ke kolaborasi itu, `?tab=` membuka chipnya.
 */
export function pintasanTugas(kunci: KunciTugas, b: BarisTugas): { aksi: AksiTugas; href: string } | null {
  const k = encodeURIComponent(b.id);
  switch (kunci) {
    case "DEAL_BELUM_KIRIM":
      return { aksi: "kirimSampel", href: `/backoffice/kreatif/sampel?tab=perlu-dikirim&kolaborasi=${k}` };
    case "RESI_NYANGKUT":
      return { aksi: "tandaiDiterima", href: `/backoffice/kreatif/sampel?tab=dalam-perjalanan&kolaborasi=${k}` };
    case "DITERIMA_BELUM_TAYANG":
    case "JADWAL_TAYANG_LEWAT":
      return { aksi: "tempelLink", href: `/backoffice/kreatif/konten-kol?tab=menunggu&kolaborasi=${k}` };
    case "DRAF_MENUNGGU":
      return { aksi: "reviewDraf", href: `/backoffice/kreatif/konten-kol?tab=draf&kolaborasi=${k}` };
    case "ANGKA_BELUM_ADA":
      return { aksi: "isiAngka", href: `/backoffice/kreatif/konten-kol?tab=tayang&kolaborasi=${k}` };
    case "BELUM_DIBAYAR":
      return { aksi: "bayar", href: `/backoffice/kreatif/pembayaran?kolaborasi=${k}` };
    case "DATA_KIRIM_KURANG":
      // Langsung ke tab tempat alamat, HP, dan ukuran diisi — bukan tab pertama profil.
      return b.kolId ? { aksi: "lengkapiData", href: `/backoffice/kreatif/kol/${encodeURIComponent(b.kolId)}?tab=ukuran` } : null;
    default:
      return null;
  }
}

/**
 * Tujuan "Buka" sebuah baris. Agenda membuka kalender di tanggalnya dengan
 * dialog agendanya; campaign membuka campaign. Tidak pernah tautan kolaborasi
 * kosong (bug KOL Manager §6.2).
 */
export function tautanBuka(b: BarisTugas): string {
  if (b.jenis === "AGENDA") {
    const q = new URLSearchParams({ bulan: b.sejak.slice(0, 7), tanggal: b.sejak, agenda: b.id });
    return `/backoffice/kreatif/kalender?${q.toString()}`;
  }
  if (b.jenis === "CAMPAIGN") return `/backoffice/kreatif/campaign/${encodeURIComponent(b.id)}`;
  // Anomali akun: profil KOL di tab riwayat pengikut & ER.
  if (b.jenis === "AKUN") return b.kolId ? `/backoffice/kreatif/kol/${encodeURIComponent(b.kolId)}?tab=pengikut` : "/backoffice/kreatif/kol";
  if (b.jenis === "PERANGKAT") return "/backoffice/kreatif/pemantauan";
  // Kiriman formulir data KOL: diperiksa di kartu "Link formulir data" (tab Alamat & ukuran).
  if (b.jenis === "FORMULIR") return b.kolId ? `/backoffice/kreatif/kol/${encodeURIComponent(b.kolId)}?tab=ukuran` : "/backoffice/kreatif/kol";
  return `/backoffice/kreatif/kolaborasi/${encodeURIComponent(b.id)}`;
}

/** Bar posisi tahap: lebar relatif terhadap tahap terbanyak, 0–100. */
export function lebarBar(n: number, maks: number): number {
  if (maks <= 0 || n <= 0) return 0;
  return Math.max(2, Math.round((n / maks) * 100));
}

export type NadaRoas = "baik" | "buruk" | "kosong";

/** ROAS hijau ≥ 1, merah < 1, dan "—" redup bila belum ada data (bug KOL Manager §6.15). */
export function nadaRoas(roas: number | null): NadaRoas {
  if (roas === null || !Number.isFinite(roas)) return "kosong";
  return roas >= 1 ? "baik" : "buruk";
}
