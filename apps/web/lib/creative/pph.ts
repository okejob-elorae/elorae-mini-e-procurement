/**
 * PPh atas fee KOL — murni, aman untuk komponen klien.
 *
 * SEMUA tarif di sini adalah BAWAAN yang bisa diubah di Kreatif → Pengaturan
 * (`SystemSetting["kreatif.pajak"]`) dan WAJIB dikonfirmasi konsultan pajak
 * (keputusan sementara pemilik 2026-10-07). Layar menampilkan rinciannya
 * (bruto, DPP, lapisan tarif, PPh, neto) supaya keuangan bisa memeriksa.
 *
 * Asumsi yang dipakai (dicatat juga di `tarifInfo` setiap termin):
 * - PPh 21 bukan pegawai: DPP = 50% bruto, tarif progresif Pasal 17 atas DPP,
 *   dihitung PER PEMBAYARAN (per termin), TIDAK kumulatif.
 * - Tanpa NPWP: PPh 21 20% lebih tinggi; PPh 23 100% lebih tinggi.
 * - PPh 23 jasa: tarif × bruto (DPP = bruto).
 * - TIDAK_DIPOTONG: nol.
 * - PPh dibulatkan ke BAWAH ke rupiah penuh.
 *
 * Gross-up: fee yang disepakati adalah NETO yang diterima KOL; bruto dicari
 * (pencarian biner — tarif progresif tidak bisa dibalik dengan satu rumus) =
 * rupiah penuh TERKECIL yang neto-nya (bruto − PPh) tidak kurang dari yang
 * disepakati.
 *
 * Uang dihitung dalam sen dan basis poin dengan BigInt, supaya lapisan dan
 * tambahan tanpa NPWP tidak menumpuk galat pecahan.
 */

export const KUNCI_PAJAK = "kreatif.pajak";

export type JenisPajak = "ORANG_PRIBADI" | "BADAN" | "TIDAK_DIPOTONG";
export type ModePajak = "DIPOTONG" | "GROSS_UP";
export const SEMUA_JENIS_PAJAK: readonly JenisPajak[] = ["ORANG_PRIBADI", "BADAN", "TIDAK_DIPOTONG"];
export const SEMUA_MODE_PAJAK: readonly ModePajak[] = ["DIPOTONG", "GROSS_UP"];

export type SubjekPajak = { jenis: JenisPajak; adaNpwp: boolean };

/** Satu lapisan Pasal 17: tarif `persen` untuk DPP sampai `sampai` rupiah (null = di atasnya). */
export type LapisanPph = { sampai: number | null; persen: number };

export type TarifPajakKreatif = {
  pph21: { porsiDppPersen: number; lapisan: LapisanPph[]; tambahanTanpaNpwpPersen: number };
  pph23: { tarifPersen: number; tambahanTanpaNpwpPersen: number };
};

export const TARIF_PAJAK_BAWAAN: TarifPajakKreatif = {
  pph21: {
    porsiDppPersen: 50,
    lapisan: [
      { sampai: 60_000_000, persen: 5 },
      { sampai: 250_000_000, persen: 15 },
      { sampai: 500_000_000, persen: 25 },
      { sampai: 5_000_000_000, persen: 30 },
      { sampai: null, persen: 35 },
    ],
    tambahanTanpaNpwpPersen: 20,
  },
  pph23: { tarifPersen: 2, tambahanTanpaNpwpPersen: 100 },
};

export type LapisanTerpakai = { dari: number; sampai: number | null; persen: number; dasar: number; pph: number };

export type RincianPph = {
  jenis: JenisPajak;
  pasal: "21" | "23" | null;
  bruto: number;
  dpp: number;
  /** Persen DPP dari bruto (PPh 21); 100 untuk PPh 23. */
  porsiDppPersen: number;
  pph: number;
  neto: number;
  /** PPh ÷ bruto, dua desimal. */
  tarifEfektifPersen: number;
  /** Lapisan yang benar-benar terkena (PPh 21) atau satu baris tarif (PPh 23). Sebelum tambahan tanpa NPWP. */
  lapisan: LapisanTerpakai[];
  /** 0 bila ber-NPWP atau tidak dipotong. */
  tambahanTanpaNpwpPersen: number;
  grossUp: boolean;
};

const sah = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** Rupiah → sen bulat (toFixed dulu supaya 1250,555 tidak terbaca 125055,4999). */
const keSen = (n: number): number => Math.round(Number((sah(n) * 100).toFixed(4)));
const dariSen = (sen: number): number => sen / 100;
/** Persen → basis poin bulat (2,5% → 250). */
const keBp = (persen: number): number => Math.round(Number((persen * 100).toFixed(4)));

const B = (n: number) => BigInt(Math.round(n));
const NOL = BigInt(0);
const SERATUS = BigInt(100);
const BP_PENUH = BigInt(10_000);

function bulat2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Bagian lantai hasil bagi BigInt positif. */
const bagiBawah = (a: bigint, b: bigint): bigint => a / b;

type Hitung = { dppSen: number; pphSen: number; lapisan: LapisanTerpakai[]; porsi: number; tambahan: number; pasal: "21" | "23" | null };

function hitungSen(brutoSen: number, subjek: SubjekPajak, tarif: TarifPajakKreatif): Hitung {
  if (brutoSen <= 0 || subjek.jenis === "TIDAK_DIPOTONG") {
    return { dppSen: 0, pphSen: 0, lapisan: [], porsi: 0, tambahan: 0, pasal: subjek.jenis === "TIDAK_DIPOTONG" ? null : subjek.jenis === "BADAN" ? "23" : "21" };
  }

  if (subjek.jenis === "BADAN") {
    const tambahan = subjek.adaNpwp ? 0 : tarif.pph23.tambahanTanpaNpwpPersen;
    const bp = B(keBp(tarif.pph23.tarifPersen));
    // pph (sen) = bruto × tarif × (1 + tambahan), lalu lantai ke rupiah penuh.
    const pembilang = B(brutoSen) * bp * B(keBp(100 + tambahan));
    const pphRupiah = bagiBawah(pembilang, BP_PENUH * BP_PENUH * SERATUS);
    const dasarPph = bagiBawah(B(brutoSen) * bp, BP_PENUH);
    return {
      dppSen: brutoSen,
      pphSen: Number(pphRupiah * SERATUS),
      lapisan: [{ dari: 0, sampai: null, persen: tarif.pph23.tarifPersen, dasar: dariSen(brutoSen), pph: dariSen(Number(dasarPph)) }],
      porsi: 100,
      tambahan,
      pasal: "23",
    };
  }

  // PPh 21 bukan pegawai: DPP dibulatkan ke sen terdekat.
  const porsi = tarif.pph21.porsiDppPersen;
  const dppSen = Math.round((brutoSen * keBp(porsi)) / 10_000);
  const tambahan = subjek.adaNpwp ? 0 : tarif.pph21.tambahanTanpaNpwpPersen;
  let sisa = dppSen;
  let bawah = 0;
  let jumlahBp = NOL; // Σ dasar(sen) × bp
  const lapisan: LapisanTerpakai[] = [];
  for (const l of tarif.pph21.lapisan) {
    if (sisa <= 0) break;
    const atasSen = l.sampai === null ? Number.POSITIVE_INFINITY : keSen(l.sampai);
    const lebar = atasSen - bawah;
    const dasar = Math.min(sisa, lebar);
    if (dasar > 0) {
      const bp = B(keBp(l.persen));
      jumlahBp += B(dasar) * bp;
      lapisan.push({
        dari: dariSen(bawah),
        sampai: l.sampai,
        persen: l.persen,
        dasar: dariSen(dasar),
        pph: dariSen(Math.round((dasar * keBp(l.persen)) / 10_000)),
      });
    }
    sisa -= dasar;
    bawah = atasSen;
  }
  const pphRupiah = bagiBawah(jumlahBp * B(keBp(100 + tambahan)), BP_PENUH * BP_PENUH * SERATUS);
  return { dppSen, pphSen: Number(pphRupiah * SERATUS), lapisan, porsi, tambahan, pasal: "21" };
}

function rincian(brutoSen: number, subjek: SubjekPajak, tarif: TarifPajakKreatif, grossUp: boolean): RincianPph {
  const h = hitungSen(brutoSen, subjek, tarif);
  const bruto = dariSen(brutoSen);
  const pph = dariSen(h.pphSen);
  return {
    jenis: subjek.jenis,
    pasal: h.pasal,
    bruto,
    dpp: dariSen(h.dppSen),
    porsiDppPersen: h.porsi,
    pph,
    neto: dariSen(brutoSen - h.pphSen),
    tarifEfektifPersen: brutoSen > 0 ? bulat2((h.pphSen / brutoSen) * 100) : 0,
    lapisan: h.lapisan,
    tambahanTanpaNpwpPersen: h.tambahan,
    grossUp,
  };
}

/** PPh atas sebuah bruto (mode DIPOTONG: yang disepakati = bruto). */
export function hitungPph(bruto: number, subjek: SubjekPajak, tarif: TarifPajakKreatif = TARIF_PAJAK_BAWAAN): RincianPph {
  return rincian(keSen(bruto), subjek, tarif, false);
}

/**
 * Gross-up: bruto rupiah penuh TERKECIL yang neto-nya ≥ `neto`.
 *
 * Neto (bruto − PPh berlantai) tidak pernah turun saat bruto naik satu rupiah,
 * karena marginal PPh di bawah 100% (dijaga validator) — jadi pencarian biner
 * sah. Neto bersen dibulatkan ke rupiah ke atas lebih dulu.
 */
export function hitungDariNeto(neto: number, subjek: SubjekPajak, tarif: TarifPajakKreatif = TARIF_PAJAK_BAWAAN): RincianPph {
  const target = Math.ceil(keSen(neto) / 100); // rupiah
  if (target <= 0) return rincian(0, subjek, tarif, true);
  if (subjek.jenis === "TIDAK_DIPOTONG") return rincian(target * 100, subjek, tarif, true);

  const netoDari = (rupiah: number) => rupiah - hitungSen(rupiah * 100, subjek, tarif).pphSen / 100;
  let bawah = target - 1; // neto(bawah) < target pasti (PPh ≥ 0 → neto ≤ bruto)
  let atas = target;
  let putaran = 0;
  while (netoDari(atas) < target) {
    bawah = atas;
    atas = atas * 2;
    if (++putaran > 60) throw new Error("GROSS_UP_TIDAK_KONVERGEN");
  }
  while (atas - bawah > 1) {
    const tengah = Math.floor((bawah + atas) / 2);
    if (netoDari(tengah) >= target) atas = tengah;
    else bawah = tengah;
  }
  return rincian(atas * 100, subjek, tarif, true);
}

/** Satu termin: DIPOTONG → `jumlah` adalah bruto; GROSS_UP → `jumlah` adalah neto. */
export function hitungTermin(jumlah: number, mode: ModePajak, subjek: SubjekPajak, tarif: TarifPajakKreatif = TARIF_PAJAK_BAWAAN): RincianPph {
  return mode === "GROSS_UP" ? hitungDariNeto(jumlah, subjek, tarif) : hitungPph(jumlah, subjek, tarif);
}

/** Rincian tarif yang disimpan bersama termin (`KolPaymentTerm.tarifInfo`, JSON teks). */
export function tarifInfoTermin(r: RincianPph): string {
  return JSON.stringify({
    pasal: r.pasal,
    jenis: r.jenis,
    porsiDppPersen: r.porsiDppPersen,
    lapisan: r.lapisan,
    tambahanTanpaNpwpPersen: r.tambahanTanpaNpwpPersen,
    tarifEfektifPersen: r.tarifEfektifPersen,
    grossUp: r.grossUp,
    pembulatan: "ke bawah, rupiah penuh",
    kumulatif: false,
  });
}

export type TarifInfo = {
  pasal: "21" | "23" | null;
  porsiDppPersen: number;
  lapisan: LapisanTerpakai[];
  tambahanTanpaNpwpPersen: number;
  tarifEfektifPersen: number;
  grossUp: boolean;
};

/** Baca `tarifInfo` termin; null bila kosong (termin isi awal) atau rusak. */
export function bacaTarifInfo(teks: string | null | undefined): TarifInfo | null {
  if (!teks) return null;
  try {
    const o = JSON.parse(teks) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    return {
      pasal: o.pasal === "21" || o.pasal === "23" ? o.pasal : null,
      porsiDppPersen: typeof o.porsiDppPersen === "number" ? o.porsiDppPersen : 0,
      lapisan: Array.isArray(o.lapisan) ? (o.lapisan as LapisanTerpakai[]) : [],
      tambahanTanpaNpwpPersen: typeof o.tambahanTanpaNpwpPersen === "number" ? o.tambahanTanpaNpwpPersen : 0,
      tarifEfektifPersen: typeof o.tarifEfektifPersen === "number" ? o.tarifEfektifPersen : 0,
      grossUp: o.grossUp === true,
    };
  } catch {
    return null;
  }
}

/**
 * Pecah `total` menurut bobot (persen) dengan sisa terbesar, sehingga jumlah
 * bagian PERSIS total. Total rupiah penuh dipecah per rupiah; total bersen
 * dipecah per sen. Sisa yang sama besar jatuh ke bagian yang lebih depan.
 */
export function bagiJumlah(total: number, bobot: readonly number[]): number[] {
  if (bobot.length === 0) return [];
  const totalSen = keSen(total);
  const satuan = totalSen % 100 === 0 ? 100 : 1;
  const unit = totalSen / satuan;
  const w = bobot.map((b) => keBp(sah(b)));
  const jumlahW = w.reduce((a, b) => a + b, 0);
  if (jumlahW <= 0 || unit <= 0) return bobot.map(() => 0);
  const dasar = w.map((x) => Math.floor((unit * x) / jumlahW));
  const sisaBagi = w.map((x, i) => ({ i, sisa: (unit * x) % jumlahW }));
  let kurang = unit - dasar.reduce((a, b) => a + b, 0);
  sisaBagi.sort((a, b) => b.sisa - a.sisa || a.i - b.i);
  for (const s of sisaBagi) {
    if (kurang <= 0) break;
    if (w[s.i] <= 0) continue;
    dasar[s.i]++;
    kurang--;
  }
  return dasar.map((u) => dariSen(u * satuan));
}

// ───────────────────── Tarif: baca & validasi ─────────────────────

export type GalatTarif = { bagian: "pph21" | "pph23"; kunci: string };
export type HasilValidasiTarif = { ok: true; tarif: TarifPajakKreatif } | { ok: false; galat: GalatTarif[] };

function keObjek(nilai: unknown): Record<string, unknown> | null {
  let x = nilai;
  if (typeof x === "string") {
    if (!x.trim()) return null;
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

const persenSah = (v: unknown, maks = 100): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= maks;

function periksa21(o: unknown): { ok: true; nilai: TarifPajakKreatif["pph21"] } | { ok: false; kunci: string } {
  const p = keObjek(o);
  if (!p) return { ok: false, kunci: "pph21" };
  if (!persenSah(p.porsiDppPersen) || p.porsiDppPersen <= 0) return { ok: false, kunci: "porsiDppPersen" };
  if (!persenSah(p.tambahanTanpaNpwpPersen, 500)) return { ok: false, kunci: "tambahanTanpaNpwpPersen" };
  if (!Array.isArray(p.lapisan) || p.lapisan.length === 0 || p.lapisan.length > 10) return { ok: false, kunci: "lapisan" };
  const lapisan: LapisanPph[] = [];
  let sebelum = 0;
  for (const [i, mentah] of p.lapisan.entries()) {
    const l = keObjek(mentah);
    if (!l || !persenSah(l.persen)) return { ok: false, kunci: "lapisan" };
    const akhir = i === p.lapisan.length - 1;
    if (akhir) {
      if (l.sampai !== null && l.sampai !== undefined) return { ok: false, kunci: "lapisan" };
      lapisan.push({ sampai: null, persen: l.persen });
    } else {
      if (typeof l.sampai !== "number" || !Number.isFinite(l.sampai) || l.sampai <= sebelum) return { ok: false, kunci: "lapisan" };
      sebelum = l.sampai;
      lapisan.push({ sampai: l.sampai, persen: l.persen });
    }
  }
  // Marginal PPh tertinggi (atas bruto) harus di bawah 100%, atau gross-up mustahil.
  const marginal = (p.porsiDppPersen / 100) * (Math.max(...lapisan.map((l) => l.persen)) / 100) * (1 + p.tambahanTanpaNpwpPersen / 100);
  if (marginal >= 1) return { ok: false, kunci: "lapisan" };
  return { ok: true, nilai: { porsiDppPersen: p.porsiDppPersen, lapisan, tambahanTanpaNpwpPersen: p.tambahanTanpaNpwpPersen } };
}

function periksa23(o: unknown): { ok: true; nilai: TarifPajakKreatif["pph23"] } | { ok: false; kunci: string } {
  const p = keObjek(o);
  if (!p) return { ok: false, kunci: "pph23" };
  if (!persenSah(p.tarifPersen)) return { ok: false, kunci: "tarifPersen" };
  if (!persenSah(p.tambahanTanpaNpwpPersen, 500)) return { ok: false, kunci: "tambahanTanpaNpwpPersen" };
  if ((p.tarifPersen / 100) * (1 + p.tambahanTanpaNpwpPersen / 100) >= 1) return { ok: false, kunci: "tarifPersen" };
  return { ok: true, nilai: { tarifPersen: p.tarifPersen, tambahanTanpaNpwpPersen: p.tambahanTanpaNpwpPersen } };
}

/** Validator ketat untuk penyimpanan. */
export function validasiTarifPajak(input: unknown): HasilValidasiTarif {
  const o = keObjek(input);
  if (!o) return { ok: false, galat: [{ bagian: "pph21", kunci: "pph21" }] };
  const galat: GalatTarif[] = [];
  const a = periksa21(o.pph21);
  const b = periksa23(o.pph23);
  if (!a.ok) galat.push({ bagian: "pph21", kunci: a.kunci });
  if (!b.ok) galat.push({ bagian: "pph23", kunci: b.kunci });
  if (!a.ok || !b.ok) return { ok: false, galat };
  return { ok: true, tarif: { pph21: a.nilai, pph23: b.nilai } };
}

/** Pembaca pemaaf: bagian yang tidak sah memakai bawaannya sendiri. */
export function bacaTarifPajak(nilai: unknown): TarifPajakKreatif {
  const o = keObjek(nilai);
  if (!o) return TARIF_PAJAK_BAWAAN;
  const a = periksa21(o.pph21);
  const b = periksa23(o.pph23);
  return { pph21: a.ok ? a.nilai : TARIF_PAJAK_BAWAAN.pph21, pph23: b.ok ? b.nilai : TARIF_PAJAK_BAWAAN.pph23 };
}

/** Label pasal untuk layar/CSV: "PPh 21", "PPh 23", atau "Tidak dipotong". */
export function labelPasal(pasal: "21" | "23" | null): string {
  return pasal ? `PPh ${pasal}` : "Tidak dipotong";
}
