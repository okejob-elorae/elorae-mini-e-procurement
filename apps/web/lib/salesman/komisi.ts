import { bulanWib } from "./pengaturan";

/**
 * Komisi / insentif salesman — murni, tanpa basis data, aman dibundel ke klien
 * (kartu pengaturan memakai validasi yang SAMA dengan aksi simpannya).
 *
 * Skemanya disimpan di `SystemSetting["salesman.komisi"]` sebagai JSON, tanpa
 * tabel baru. Angka yang dihasilkan di sini adalah PERKIRAAN: yang dibayar
 * tetap keputusan kantor. Kuerinya di `komisi-queries.ts`.
 *
 * Dasar bawaan = UANG TERTAGIH, bukan omzet. Omzet yang belum dibayar toko
 * bukan uang perusahaan; memberi komisi atasnya mengajari salesman menjual ke
 * toko yang tidak membayar. Dan "tertagih" di sini mengikuti Aturan 1 modul
 * piutang: klaim pelunasan baru dihitung sesudah keuangan MEMVERIFIKASINYA
 * (`TERVERIFIKASI`). Laporan "toko sudah transfer" bernilai nol sampai uangnya
 * terlihat di mutasi bank.
 */

export const KUNCI_SKEMA_KOMISI = "salesman.komisi";
export const KUNCI_PERINGKAT = "salesman.peringkat";

export type DasarKomisi = "TERTAGIH" | "PENJUALAN";
export const DASAR_KOMISI: readonly DasarKomisi[] = ["TERTAGIH", "PENJUALAN"];

/** Tarif yang berlaku begitu omzet mencapai `capaianPersen` dari target bulanan. */
export type TingkatKomisi = { capaianPersen: number; tarifPersen: number };

export type SkemaKomisi = {
  aktif: boolean;
  dasar: DasarKomisi;
  /** Tarif dasar, persen dari nilai dasar. */
  tarifPersen: number;
  /** Diurutkan naik menurut ambang; ambang unik. */
  tingkat: TingkatKomisi[];
  /**
   * Bagian penagih, persen dari uang yang ia tagih atas faktur penjual LAIN.
   *
   * Toko berpindah pemegang (`Store.salesmanId` dirotasi per toko atau per
   * area), dan piutang ditagih oleh pemegang toko saat ini, sementara
   * `Receivable.salesmanId` tetap mencatat siapa yang menjual. Tanpa pembagian
   * ini, orang yang berjalan ke toko dan membawa pulang uangnya tidak mendapat
   * apa pun, atau penjualnya kehilangan hasil penjualannya sendiri. Bawaan 0:
   * seluruhnya tetap milik penjual — pemilik yang memutuskan kalau mau dibagi.
   */
  bagianPenagihPersen: number;
  /** Tarif dasar khusus per salesman (id pengguna → persen), menimpa `tarifPersen`. */
  perSalesman: Record<string, number>;
};

export const SKEMA_KOMISI_BAWAAN: SkemaKomisi = {
  aktif: true,
  dasar: "TERTAGIH",
  tarifPersen: 1,
  tingkat: [],
  bagianPenagihPersen: 0,
  perSalesman: {},
};

export const TARIF_MAKS = 100;
export const CAPAIAN_MAKS = 1000;
export const TINGKAT_MAKS = 10;

/** Dua desimal cukup untuk persen (1,25%); lebih dari itu hampir pasti salah ketik. */
const duaDesimal = (x: number) => Math.round(x * 100) / 100 === x;
const persenSah = (x: unknown, maks: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= maks && duaDesimal(x);
const ambangSah = (x: unknown): x is number => persenSah(x, CAPAIAN_MAKS) && x > 0;

function objek(nilai: string | null | undefined): Record<string, unknown> | null {
  if (!nilai) return null;
  try {
    const x = JSON.parse(nilai) as unknown;
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Urut naik; ambang kembar diambil tarif tertingginya (lebih murah hati, bukan diam-diam hilang). */
function rapikanTingkat(daftar: TingkatKomisi[]): TingkatKomisi[] {
  const peta = new Map<number, number>();
  for (const t of daftar) peta.set(t.capaianPersen, Math.max(peta.get(t.capaianPersen) ?? 0, t.tarifPersen));
  return [...peta.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, TINGKAT_MAKS)
    .map(([capaianPersen, tarifPersen]) => ({ capaianPersen, tarifPersen }));
}

/**
 * `SystemSetting` → skema. Nilai rusak dibaca sebagai bawaan PER KOLOM, tidak
 * pernah dilempar — beranda HP salesman tidak boleh jatuh karena satu kolom
 * pengaturan salah ketik.
 */
export function bacaSkemaKomisi(nilai: string | null | undefined): SkemaKomisi {
  const x = objek(nilai);
  if (!x) return SKEMA_KOMISI_BAWAAN;
  const b = SKEMA_KOMISI_BAWAAN;

  const tingkat = Array.isArray(x.tingkat)
    ? rapikanTingkat(
        x.tingkat.filter(
          (t): t is TingkatKomisi =>
            !!t &&
            typeof t === "object" &&
            ambangSah((t as TingkatKomisi).capaianPersen) &&
            persenSah((t as TingkatKomisi).tarifPersen, TARIF_MAKS),
        ),
      )
    : b.tingkat;

  const perSalesman: Record<string, number> = {};
  if (x.perSalesman && typeof x.perSalesman === "object" && !Array.isArray(x.perSalesman)) {
    for (const [id, v] of Object.entries(x.perSalesman as Record<string, unknown>)) {
      if (id && persenSah(v, TARIF_MAKS)) perSalesman[id] = v;
    }
  }

  return {
    aktif: typeof x.aktif === "boolean" ? x.aktif : b.aktif,
    dasar: DASAR_KOMISI.includes(x.dasar as DasarKomisi) ? (x.dasar as DasarKomisi) : b.dasar,
    tarifPersen: persenSah(x.tarifPersen, TARIF_MAKS) ? x.tarifPersen : b.tarifPersen,
    tingkat,
    bagianPenagihPersen: persenSah(x.bagianPenagihPersen, 100) ? x.bagianPenagihPersen : b.bagianPenagihPersen,
    perSalesman,
  };
}

/** Bentuk simpanan yang terbaca kembali persis sama oleh `bacaSkemaKomisi`. */
export function tulisSkemaKomisi(skema: SkemaKomisi): string {
  return JSON.stringify({
    aktif: skema.aktif,
    dasar: skema.dasar,
    tarifPersen: skema.tarifPersen,
    tingkat: skema.tingkat.map((t) => ({ capaianPersen: t.capaianPersen, tarifPersen: t.tarifPersen })),
    bagianPenagihPersen: skema.bagianPenagihPersen,
    perSalesman: skema.perSalesman,
  });
}

/**
 * Validasi KETAT untuk aksi simpan: satu kolom salah → `null`, bukan bawaan.
 * Pembaca boleh murah hati (bawaan per kolom); penulis tidak — menyimpan
 * sesuatu yang berbeda dari yang diketik admin adalah cara paling sunyi untuk
 * membayar komisi yang salah.
 */
export function validasiSkemaKomisi(isi: unknown): SkemaKomisi | null {
  if (!isi || typeof isi !== "object" || Array.isArray(isi)) return null;
  const x = isi as Record<string, unknown>;
  if (typeof x.aktif !== "boolean") return null;
  if (!DASAR_KOMISI.includes(x.dasar as DasarKomisi)) return null;
  if (!persenSah(x.tarifPersen, TARIF_MAKS)) return null;
  if (!persenSah(x.bagianPenagihPersen, 100)) return null;

  if (!Array.isArray(x.tingkat) || x.tingkat.length > TINGKAT_MAKS) return null;
  const tingkat: TingkatKomisi[] = [];
  for (const t of x.tingkat as unknown[]) {
    if (!t || typeof t !== "object") return null;
    const { capaianPersen, tarifPersen } = t as Record<string, unknown>;
    if (!ambangSah(capaianPersen) || !persenSah(tarifPersen, TARIF_MAKS)) return null;
    tingkat.push({ capaianPersen, tarifPersen });
  }
  if (new Set(tingkat.map((t) => t.capaianPersen)).size !== tingkat.length) return null;

  if (!x.perSalesman || typeof x.perSalesman !== "object" || Array.isArray(x.perSalesman)) return null;
  const perSalesman: Record<string, number> = {};
  for (const [id, v] of Object.entries(x.perSalesman as Record<string, unknown>)) {
    if (!id || !persenSah(v, TARIF_MAKS)) return null;
    perSalesman[id] = v;
  }

  return {
    aktif: x.aktif,
    dasar: x.dasar as DasarKomisi,
    tarifPersen: x.tarifPersen,
    tingkat: [...tingkat].sort((a, b) => a.capaianPersen - b.capaianPersen),
    bagianPenagihPersen: x.bagianPenagihPersen,
    perSalesman,
  };
}

// ─── Papan peringkat ──────────────────────────────────────────────────────────

/**
 * Disimpan terpisah (`salesman.peringkat`) dari skema komisi: mematikan komisi
 * tidak boleh ikut menyembunyikan nama di papan peringkat, dan sebaliknya.
 */
export type AturanPeringkat = { tampilkanNama: boolean };
export const ATURAN_PERINGKAT_BAWAAN: AturanPeringkat = { tampilkanNama: true };

export function bacaAturanPeringkat(nilai: string | null | undefined): AturanPeringkat {
  const x = objek(nilai);
  return {
    tampilkanNama: typeof x?.tampilkanNama === "boolean" ? x.tampilkanNama : ATURAN_PERINGKAT_BAWAAN.tampilkanNama,
  };
}

// ─── Hitung ───────────────────────────────────────────────────────────────────

export type MasukanKomisi = {
  skema: SkemaKomisi;
  salesmanId: string;
  /**
   * Omzet bulan itu, persis seperti kartu "Bulan ini" di beranda. Selalu
   * menjadi penentu capaian target, apa pun dasar komisinya — target salesman
   * adalah target omzet.
   */
  omzet: number;
  /** Uang tertagih terverifikasi yang menjadi bagian salesman ini (sudah dibagi penjual/penagih). */
  tertagih: number;
  target: number | null;
};

export type TingkatBerikut = { capaianPersen: number; tarifPersen: number; kurangNilai: number };

export type HasilKomisi = {
  aktif: boolean;
  dasar: DasarKomisi;
  dasarNilai: number;
  /** Capaian target dalam persen, dibulatkan KE BAWAH ke satu desimal; null = belum ada target. */
  capaianPersen: number | null;
  /** Tarif sebelum tingkat: tarif khusus salesman ini, atau tarif dasar skema. */
  tarifDasar: number;
  tarifDipakai: number;
  komisi: number;
  /** Tingkat terdekat yang MENAIKKAN tarif, beserta omzet yang masih kurang. */
  tingkatBerikut: TingkatBerikut | null;
  /**
   * Setiap tingkat skema dengan tanda sudah tercapai — dihitung di sini dengan
   * perbandingan tepat, supaya layar tidak menebak dari persen yang sudah dibulatkan.
   */
  tingkat: (TingkatKomisi & { tercapai: boolean })[];
};

/** Persen → basis poin bulat, supaya perbandingan dan perkalian uang bebas galat pecahan. */
const bp = (persen: number) => Math.round(persen * 100);

/** Rupiah × tarif, dibulatkan setengah ke atas, dengan bilangan bulat saja. */
function kaliTarif(rupiah: number, tarifPersen: number): number {
  const n = rupiah * bp(tarifPersen);
  return n <= 0 ? 0 : Math.floor((n + 5_000) / 10_000);
}

export function tarifDasarUntuk(skema: SkemaKomisi, salesmanId: string): number {
  return skema.perSalesman[salesmanId] ?? skema.tarifPersen;
}

/**
 * Perkiraan komisi satu salesman untuk satu bulan.
 *
 * Tarif = yang TERTINGGI antara tarif dasar (atau tarif khususnya) dan tarif
 * setiap tingkat yang ambangnya sudah tercapai. Mencapai lebih banyak tidak
 * pernah boleh menurunkan tarif, termasuk bagi salesman dengan tarif khusus.
 *
 * Ambang dibandingkan TANPA pembulatan: 99,6% belum 100%. Kalau layar
 * menampilkan "100%" padahal tingkatnya belum berlaku, salesman akan merasa
 * dicurangi — itu sebabnya capaian yang ditampilkan dibulatkan ke bawah.
 */
export function hitungKomisi(m: MasukanKomisi): HasilKomisi {
  const { skema } = m;
  const omzet = Math.max(0, m.omzet);
  const dasarNilai = Math.max(0, Math.round(skema.dasar === "TERTAGIH" ? m.tertagih : m.omzet));
  const tarifDasar = tarifDasarUntuk(skema, m.salesmanId);
  const target = m.target && m.target > 0 ? m.target : null;

  let tarifDipakai = tarifDasar;
  let capaianPersen: number | null = null;
  let tingkatBerikut: TingkatBerikut | null = null;
  // Tanpa target, tidak ada tingkat yang bisa dicapai.
  const tercapai = (t: TingkatKomisi) => target !== null && omzet * 10_000 >= bp(t.capaianPersen) * target;

  if (target !== null) {
    capaianPersen = Math.floor((omzet * 1_000) / target) / 10;
    for (const t of skema.tingkat) if (tercapai(t)) tarifDipakai = Math.max(tarifDipakai, t.tarifPersen);

    const berikut = skema.tingkat
      .filter((t) => !tercapai(t) && t.tarifPersen > tarifDipakai)
      .sort((a, b) => a.capaianPersen - b.capaianPersen)[0];
    if (berikut && skema.aktif) {
      const dibutuhkan = Math.ceil((bp(berikut.capaianPersen) * target) / 10_000);
      tingkatBerikut = {
        capaianPersen: berikut.capaianPersen,
        tarifPersen: berikut.tarifPersen,
        kurangNilai: Math.max(1, Math.ceil(dibutuhkan - omzet)),
      };
    }
  }

  return {
    aktif: skema.aktif,
    dasar: skema.dasar,
    dasarNilai,
    capaianPersen,
    tarifDasar,
    tarifDipakai,
    komisi: skema.aktif ? kaliTarif(dasarNilai, tarifDipakai) : 0,
    tingkatBerikut,
    tingkat: skema.tingkat.map((t) => ({ ...t, tercapai: tercapai(t) })),
  };
}

// ─── Uang tertagih ────────────────────────────────────────────────────────────

/**
 * Uang yang benar-benar masuk untuk satu faktur pada satu klaim terverifikasi.
 *
 * `settledAmount` adalah nilai FAKTUR yang dilunasi, termasuk bagian yang
 * dibayar toko dengan potongan (retur, promosi) — bukan dengan uang. Komisi
 * "tertagih" dihitung atas uangnya: potongan klaim dibagi rata menurut porsi
 * tiap faktur, sama dengan cara `hitungSisaPiutang` memorsi sebuah klaim.
 * Hasilnya tidak pernah melebihi nilai yang diakui piutang (Aturan 2: retur
 * yang masih ditahan sudah termasuk potongan yang dikeluarkan di sini).
 */
export function nilaiTunaiPorsi(dilunasi: number, nilaiFakturKlaim: number, uangMasukKlaim: number): number {
  if (!(nilaiFakturKlaim > 0) || !(dilunasi > 0)) return 0;
  const rasio = Math.min(1, Math.max(0, uangMasukKlaim / nilaiFakturKlaim));
  return Math.round(dilunasi * rasio);
}

export type PeranTagih = "SENDIRI" | "PENJUAL" | "PENAGIH" | "TANPA_PENJUAL";

/** Satu faktur yang uangnya masuk: siapa penjualnya, siapa penagihnya, berapa uangnya. */
export type BarisTagih = { penjualId: string | null; penagihId: string; nilai: number };

/**
 * Bagian salesman `salesmanId` dari satu baris tertagih; `null` = bukan
 * bagiannya (atau bagiannya nol).
 *
 * Faktur TANPA penjual (piutang impor dari program lama) seluruhnya milik
 * penagih: tidak ada penjual yang berhak, dan uang yang ditagih tetap uang
 * yang ditagih.
 */
export function porsiTagih(
  baris: BarisTagih,
  salesmanId: string,
  bagianPenagihPersen: number,
): { peran: PeranTagih; bagian: number } | null {
  const { penjualId, penagihId, nilai } = baris;
  if (penjualId === salesmanId && penagihId === salesmanId) return { peran: "SENDIRI", bagian: nilai };
  if (penjualId === null) return penagihId === salesmanId ? { peran: "TANPA_PENJUAL", bagian: nilai } : null;
  // Bagian penagih dibulatkan sekali; penjual mendapat sisanya — keduanya selalu berjumlah `nilai`.
  const penagih = kaliTarif(nilai, bagianPenagihPersen);
  if (penjualId === salesmanId) return { peran: "PENJUAL", bagian: nilai - penagih };
  if (penagihId === salesmanId) return penagih > 0 ? { peran: "PENAGIH", bagian: penagih } : null;
  return null;
}

export function ringkasTagih(
  baris: readonly BarisTagih[],
  salesmanId: string,
  bagianPenagihPersen: number,
): { bagianPenjual: number; bagianPenagih: number; total: number } {
  let bagianPenjual = 0;
  let bagianPenagih = 0;
  for (const b of baris) {
    const p = porsiTagih(b, salesmanId, bagianPenagihPersen);
    if (!p) continue;
    if (p.peran === "SENDIRI" || p.peran === "PENJUAL") bagianPenjual += p.bagian;
    else bagianPenagih += p.bagian;
  }
  return { bagianPenjual, bagianPenagih, total: bagianPenjual + bagianPenagih };
}

// ─── Bulan ────────────────────────────────────────────────────────────────────

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" → [awal, akhir) menurut kalender WIB; null bila teksnya bukan bulan. */
export function rentangBulanWib(bulan: string): { awal: Date; akhir: Date } | null {
  const m = POLA_BULAN.exec(bulan ?? "");
  if (!m) return null;
  const th = Number(m[1]);
  const bl = Number(m[2]);
  const berikut = bl === 12 ? `${th + 1}-01` : `${th}-${String(bl + 1).padStart(2, "0")}`;
  return { awal: new Date(`${bulan}-01T00:00:00+07:00`), akhir: new Date(`${berikut}-01T00:00:00+07:00`) };
}

/** `n` bulan terakhir menurut kalender WIB, termasuk bulan ini, terbaru dulu. */
export function daftarBulanTerakhir(hariIni: Date, n: number): string[] {
  const [th, bl] = bulanWib(hariIni).split("-").map(Number);
  const hasil: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(th, bl - 1 - i, 1));
    hasil.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return hasil;
}

/** Parameter `?bulan=` → salah satu bulan dari `pilihan`; selain itu bulan pertama. */
export function bacaBulan(nilai: string | string[] | undefined, pilihan: readonly string[]): string {
  const x = Array.isArray(nilai) ? nilai[0] : nilai;
  return x && pilihan.includes(x) ? x : pilihan[0];
}

/**
 * "2026-09" → "September 2026" / "Sep 2026" dari pesan i18n
 * (`komisiSalesman.bulanPanjang.9`), BUKAN dari `Intl`: nama bulan singkat
 * Indonesia berbeda antara Node dan Safari ("Agu" vs "Agt"), dan React
 * menganggap bedanya hydration error.
 */
export function namaBulan(terjemah: (kunci: string) => string, bulan: string, bentuk: "pendek" | "panjang"): string {
  const [th, bl] = bulan.split("-");
  return `${terjemah(`${bentuk === "pendek" ? "bulanPendek" : "bulanPanjang"}.${Number(bl)}`)} ${th}`;
}

/** Persen untuk layar: "1,5" (id) / "1.5" (en), paling banyak dua desimal. */
export function formatPersen(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 }).format(n);
}

// ─── Peringkat ────────────────────────────────────────────────────────────────

export type PesertaPeringkat = { id: string; nama: string; omzet: number; target: number | null };

export type BarisPeringkat = {
  id: string;
  /** Peringkat bersaing: capaian sama → peringkat sama (1, 2, 2, 4). */
  peringkat: number;
  /** Urutan baris 1..n — dipakai untuk label "Sales #n" saat nama disembunyikan. */
  posisi: number;
  /** null = disembunyikan pengaturan pemilik. Nama sendiri selalu terlihat. */
  nama: string | null;
  persen: number | null;
  /** Hanya untuk diri sendiri; omzet orang lain tidak pernah dikirim ke HP. */
  omzet: number | null;
  adaTarget: boolean;
  diriSendiri: boolean;
};

/**
 * Papan peringkat bulanan. Yang punya target diurutkan menurut capaian (%),
 * baru sesudahnya yang belum punya target menurut omzet — persen dan rupiah
 * tidak bisa dibandingkan, jadi keduanya tidak dicampur dalam satu urutan.
 */
export function susunPeringkat(
  peserta: readonly PesertaPeringkat[],
  penontonId: string,
  aturan: AturanPeringkat,
): BarisPeringkat[] {
  const baris = peserta.map((p) => {
    const adaTarget = !!p.target && p.target > 0;
    return { p, adaTarget, rasio: adaTarget ? p.omzet / (p.target as number) : 0 };
  });
  baris.sort((a, b) => {
    if (a.adaTarget !== b.adaTarget) return a.adaTarget ? -1 : 1;
    if (a.adaTarget && a.rasio !== b.rasio) return b.rasio - a.rasio;
    if (a.p.omzet !== b.p.omzet) return b.p.omzet - a.p.omzet;
    return a.p.nama.localeCompare(b.p.nama, "id");
  });

  const hasil: BarisPeringkat[] = [];
  baris.forEach((b, i) => {
    const sebelum = i > 0 ? baris[i - 1] : null;
    const setara =
      sebelum !== null &&
      sebelum.adaTarget === b.adaTarget &&
      (b.adaTarget ? sebelum.rasio === b.rasio : sebelum.p.omzet === b.p.omzet);
    const diriSendiri = b.p.id === penontonId;
    hasil.push({
      id: b.p.id,
      peringkat: setara ? hasil[i - 1].peringkat : i + 1,
      posisi: i + 1,
      nama: aturan.tampilkanNama || diriSendiri ? b.p.nama : null,
      persen: b.adaTarget ? Math.floor((Math.max(0, b.p.omzet) * 1_000) / (b.p.target as number)) / 10 : null,
      omzet: diriSendiri ? b.p.omzet : null,
      adaTarget: b.adaTarget,
      diriSendiri,
    });
  });
  return hasil;
}
