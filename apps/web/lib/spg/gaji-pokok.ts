import { izinPada, type IzinRentang } from "./shift";

/**
 * Gaji pokok SPG — aturan murni, tanpa basis data, aman untuk klien (keputusan pemilik 2026-11-02).
 *
 * Satu gaji pokok per SPG × bulan kerja di tokonya (SPG terikat SATU toko), untuk toko
 * konsinyasi maupun toko putus (P63). Gaji bulanannya dicatat di Pengaturan → Komisi SPG, berlaku
 * mulai bulan tertentu (`SpgSalary`).
 *
 * DASAR HARI (B12). Masa kerjanya di bulan M = dari max(awal bulan, `spgStartedOn`) sampai
 * min(akhir bulan, `spgEndedOn`). Setiap hari di masa itu mendapat dasarnya, berurutan:
 * 1. Catatan check-in toko yang SUDAH DIPERIKSA Admin Keuangan (`SpgAttendanceRecord` DIPERIKSA)
 *    untuk hari itu: hari kerja/libur dan hadir/tidaknya dari catatan itu, menggantikan jadwal dan
 *    check-in sistem (P61, P61a).
 * 2. Jadwal bulanan yang DISETUJUI kantor (P7c) dengan sel hari itu: jenis sel itu, dan hadir =
 *    ada check-in SPG itu di tokonya pada hari WIB itu (P7b).
 * 3. Selain itu: tanpa dasar.
 *
 * RUMUS (B15). Bulan penuh: tarif harian = gaji ÷ hari kerja terjadwal (P7a, "3.500.000 ÷ 26 =
 * 134.615"); setiap hari terjadwal tanpa kehadiran dan tanpa izin/sakit/cuti yang disetujui
 * dipotong satu tarif harian (P7b). Mulai atau berhenti di tengah bulan: tarif harian = gaji ÷
 * hari kerja sebulan penuh menurut jadwal standar (Pengaturan → SPG `spg.hariKerja`), dibayar
 * sebanyak hari terjadwalnya saja (P62). Masuk di hari libur jadwal dibayar tambahan SATU tarif
 * harian (P65, P65a). Check-in di luar radius tetap hadir, hanya ditandai (P70). Terlambat tidak
 * memotong apa pun. Rupiah bulat, dibulatkan ke bawah (contoh pemilik 134.615).
 *
 * TAHAN (B16, P60). Selama dasar gajinya belum pasti, SELURUH pembayaran bulan itu menunggu —
 * gaji pokok DAN komisi. Sebabnya berurutan `URUTAN_TAHAN_BAYAR`; yang pertama yang dilaporkan.
 *
 * BEKU. Bulan yang SUDAH dibayar tidak dihitung ulang dengan masa kerja dan pembagi baru: masa,
 * "penuh", dan pembaginya dibaca dari rincian yang tersimpan saat dibayar (`BekuGaji`). Hanya
 * kehadiran, izin, dan catatan check-in yang bisa menggeser bulan yang sudah dibayar (P64);
 * mengubah Pengaturan → Hari kerja SPG atau menandai SPG berhenti sesudahnya tidak.
 */

/** `AuditLog.action` gaji bulanan yang diatur di Pengaturan → Komisi SPG. */
export const JEJAK_GAJI_SPG = { DIATUR: "SPG_SALARY_SET" } as const;
export const ENTITAS_GAJI_SPG = "SpgSalary";

export const URUTAN_TAHAN_BAYAR = [
  "GAJI_POKOK_BELUM_DIATUR",
  "MULAI_KERJA_BELUM_DIISI",
  "CATATAN_HADIR_BELUM_DIPERIKSA",
  "JADWAL_MENUNGGU_PERSETUJUAN",
  "CATATAN_HADIR_BELUM_DIMASUKKAN",
  "TANPA_HARI_KERJA",
] as const;

/** Sebab seluruh pembayaran SPG × bulan itu menunggu (P60). Urutan = prioritas penolakan. */
export type AlasanTahanBayar = (typeof URUTAN_TAHAN_BAYAR)[number];

export const ALASAN_TAHAN_BAYAR: ReadonlySet<string> = new Set(URUTAN_TAHAN_BAYAR);

export function adalahAlasanTahanBayar(x: unknown): x is AlasanTahanBayar {
  return typeof x === "string" && ALASAN_TAHAN_BAYAR.has(x);
}

/** Status jadwal bulanan (`SpgMonthSchedule.status`) — salinan union `jadwal-bulan.ts`, tanpa impor. */
export type StatusJadwalBulanGaji = "DRAF" | "DIAJUKAN" | "DISETUJUI" | "DITOLAK";
/** Status catatan check-in toko (`SpgAttendanceRecord.status`). */
export type StatusCatatanHadirGaji = "DIAJUKAN" | "DIPERIKSA" | "DIKEMBALIKAN";

export type JenisHari = "KERJA" | "LIBUR";

export type RincianGaji = {
  bulanKerja: string;
  gajiBulanan: number;
  /** Masa kerjanya menutup seluruh bulan. */
  penuh: boolean;
  hariAwal: string;
  hariAkhir: string;
  /** Pembagi dari jadwalnya sendiri (bulan penuh) atau dari hari kerja standar (P62). */
  sumberPembagi: "JADWAL" | "STANDAR";
  pembagi: number;
  /** Hari kerja standar (0 = Minggu) yang dipakai saat pembaginya `STANDAR` — dibekukan saat dibayar. */
  hariKerjaStandar: number[];
  tarifHarian: number;
  hariTerjadwal: number;
  hariIzin: number;
  hariTidakMasuk: number;
  tanggalTidakMasuk: string[];
  hariMasukLibur: number;
  tanggalMasukLibur: string[];
  tanggalLuarRadius: string[];
  /** Hari yang dasarnya dari catatan check-in toko yang sudah diperiksa. */
  hariDariCatatan: number;
  gajiPokok: number;
};

export type HasilGaji = { ok: true; rincian: RincianGaji } | { ok: false; alasan: AlasanTahanBayar; hari: string[] };

/** Bagian rincian yang dibekukan pada bulan yang sudah dibayar. */
export type BekuGaji = { hariAwal: string; hariAkhir: string; penuh: boolean; pembagi: number; sumberPembagi: "JADWAL" | "STANDAR" };

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const POLA_HARI = /^\d{4}-\d{2}-\d{2}$/;

export function bulanSahGaji(x: unknown): x is string {
  return typeof x === "string" && POLA_BULAN.test(x);
}

/** Banyak hari dalam bulan "YYYY-MM". */
export function jumlahHariBulan(bulan: string): number {
  const [th, bl] = bulan.split("-").map(Number);
  return new Date(Date.UTC(th, bl, 0)).getUTCDate();
}

/** "2026-11" → "2026-11-01" … "2026-11-30". */
export function hariBulan(bulan: string): string[] {
  const n = jumlahHariBulan(bulan);
  return Array.from({ length: n }, (_, i) => `${bulan}-${String(i + 1).padStart(2, "0")}`);
}

/** Hari kalender dari `awal` sampai `akhir`, keduanya termasuk ("YYYY-MM-DD", urutan string = urutan hari). */
export function hariAntara(awal: string, akhir: string): string[] {
  if (!POLA_HARI.test(awal) || !POLA_HARI.test(akhir) || awal > akhir) return [];
  const hasil: string[] = [];
  for (let t = Date.parse(`${awal}T00:00:00Z`), akhirMs = Date.parse(`${akhir}T00:00:00Z`); t <= akhirMs; t += 86_400_000) {
    hasil.push(new Date(t).toISOString().slice(0, 10));
  }
  return hasil;
}

/** Hari dalam minggu (0 = Minggu) sebuah kunci hari. */
export const hariDalamMinggu = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Gaji bulanan yang berlaku di `bulan`: baris dengan `effectiveFrom` terakhir ≤ `bulan`; null kalau tidak ada. Rp 0 tetap gaji. */
export function gajiBulananBerlaku(rows: ReadonlyArray<{ effectiveFrom: string; monthlyAmount: number }>, bulan: string): number | null {
  let pilih: { effectiveFrom: string; monthlyAmount: number } | null = null;
  for (const r of rows) {
    if (r.effectiveFrom > bulan) continue;
    if (!pilih || r.effectiveFrom > pilih.effectiveFrom) pilih = r;
  }
  return pilih ? Math.round(Number(pilih.monthlyAmount)) : null;
}

/**
 * Masa kerja SPG di `bulan`: dari max(awal bulan, mulai) sampai min(akhir bulan, akhir). Batas
 * yang null = batas bulannya sendiri. Null kalau masanya tidak menyentuh bulan itu.
 */
export function masaKerjaBulan(bulan: string, mulai: string | null, akhir: string | null): { hariAwal: string; hariAkhir: string; penuh: boolean } | null {
  const awalBulan = `${bulan}-01`;
  const akhirBulan = `${bulan}-${String(jumlahHariBulan(bulan)).padStart(2, "0")}`;
  const hariAwal = mulai && mulai > awalBulan ? mulai : awalBulan;
  const hariAkhir = akhir && akhir < akhirBulan ? akhir : akhirBulan;
  if (hariAwal > hariAkhir) return null;
  return { hariAwal, hariAkhir, penuh: hariAwal === awalBulan && hariAkhir === akhirBulan };
}

/**
 * Hari yang dinilai untuk gaji pokok satu bulan: masa yang dibekukan saat bulan itu dibayar, atau
 * masa kerjanya sekarang. Bulan yang sudah dibayar TIDAK mengikuti tanggal mulai atau hari terakhir
 * yang diisi sesudahnya — kalau hari-hari sesudah hari terakhir baru dibuang dari daftar ini, hari
 * tidak masuk yang dulu dipotong ikut hilang dan bulan itu dihitung ulang penuh (koreksi plus untuk
 * hari yang tidak dikerjakan), atau masanya hilang sama sekali dan gajinya dihitung nol (utang).
 */
export function hariDinilaiGaji(masa: { hariAwal: string; hariAkhir: string } | null, beku: Pick<BekuGaji, "hariAwal" | "hariAkhir"> | null | undefined): string[] {
  if (beku) return hariAntara(beku.hariAwal, beku.hariAkhir);
  return masa ? hariAntara(masa.hariAwal, masa.hariAkhir) : [];
}

/** Hari kerja sebulan penuh menurut jadwal standar (`spg.hariKerja`, 0 = Minggu) — pembagi P62. */
export function hariKerjaStandar(bulan: string, hariKerjaSpg: readonly number[]): number {
  return hariBulan(bulan).filter((d) => hariKerjaSpg.includes(hariDalamMinggu(d))).length;
}

export type DasarHari = { kind: JenisHari; hadir: boolean; luarRadius: boolean; sumber: "CATATAN" | "JADWAL" };

/**
 * Dasar setiap hari masa kerja (B12): catatan check-in yang sudah diperiksa, lalu jadwal yang
 * disetujui + check-in sistem. `checkin` = hari WIB dengan check-in SPG itu DI TOKONYA; `luarRadius`
 * true kalau setiap check-in hari itu ditandai di luar radius (P70 — tetap hadir).
 */
export function susunDasarHari(m: {
  hari: readonly string[];
  statusJadwal: StatusJadwalBulanGaji | null;
  sel: ReadonlyMap<string, JenisHari>;
  catatanDiperiksa: ReadonlyMap<string, { kind: JenisHari; present: boolean }> | null;
  checkin: ReadonlyMap<string, { luarRadius: boolean }>;
}): { dasar: Map<string, DasarHari>; tanpaDasar: string[] } {
  const dasar = new Map<string, DasarHari>();
  const tanpaDasar: string[] = [];
  for (const d of m.hari) {
    const c = m.catatanDiperiksa?.get(d);
    if (c) {
      dasar.set(d, { kind: c.kind, hadir: c.present, luarRadius: false, sumber: "CATATAN" });
      continue;
    }
    const s = m.statusJadwal === "DISETUJUI" ? m.sel.get(d) : undefined;
    if (s) {
      const ci = m.checkin.get(d);
      dasar.set(d, { kind: s, hadir: Boolean(ci), luarRadius: Boolean(ci?.luarRadius), sumber: "JADWAL" });
      continue;
    }
    tanpaDasar.push(d);
  }
  return { dasar, tanpaDasar };
}

const rincianKosong = (bulan: string, gajiBulanan: number, hariKerjaSpg: readonly number[]): RincianGaji => ({
  bulanKerja: bulan,
  gajiBulanan,
  penuh: false,
  hariAwal: "",
  hariAkhir: "",
  sumberPembagi: "STANDAR",
  pembagi: 0,
  hariKerjaStandar: [...hariKerjaSpg],
  tarifHarian: 0,
  hariTerjadwal: 0,
  hariIzin: 0,
  hariTidakMasuk: 0,
  tanggalTidakMasuk: [],
  hariMasukLibur: 0,
  tanggalMasukLibur: [],
  tanggalLuarRadius: [],
  hariDariCatatan: 0,
  gajiPokok: 0,
});

/**
 * Gaji pokok satu SPG × satu bulan kerja (B15), atau sebab pembayarannya menunggu (B16).
 *
 * `masa` = `masaKerjaBulan` (null: masanya tidak menyentuh bulan itu → Rp 0). `dasar`/`tanpaDasar`
 * dari `susunDasarHari` atas hari-hari masa itu. `sel` = sel jadwal bulan itu (apa pun statusnya)
 * untuk membedakan hari yang menunggu persetujuan dari hari yang kosong. `beku` = rincian bulan
 * yang sudah dibayar: masa, "penuh", dan pembaginya tidak berubah lagi.
 */
export function hitungGajiPokok(m: {
  bulan: string;
  gajiBulanan: number | null;
  /** `User.spgStartedOn` sudah diisi. */
  mulaiDiisi: boolean;
  masa: { hariAwal: string; hariAkhir: string; penuh: boolean } | null;
  dasar: ReadonlyMap<string, DasarHari>;
  tanpaDasar: readonly string[];
  statusJadwal: StatusJadwalBulanGaji | null;
  sel: ReadonlyMap<string, JenisHari>;
  statusCatatan: StatusCatatanHadirGaji | null;
  izin: readonly IzinRentang[];
  userId: string;
  hariKerjaSpg: readonly number[];
  beku?: BekuGaji | null;
}): HasilGaji {
  if (m.gajiBulanan === null) return { ok: false, alasan: "GAJI_POKOK_BELUM_DIATUR", hari: [] };
  if (!m.mulaiDiisi && !m.beku) return { ok: false, alasan: "MULAI_KERJA_BELUM_DIISI", hari: [] };
  if (m.statusCatatan === "DIAJUKAN" || m.statusCatatan === "DIKEMBALIKAN") {
    return { ok: false, alasan: "CATATAN_HADIR_BELUM_DIPERIKSA", hari: [] };
  }

  const beku = m.beku ?? null;
  const masa = beku ? { hariAwal: beku.hariAwal, hariAkhir: beku.hariAkhir, penuh: beku.penuh } : m.masa;
  if (!masa || !masa.hariAwal) return { ok: true, rincian: rincianKosong(m.bulan, m.gajiBulanan, m.hariKerjaSpg) };

  const dalamMasa = (d: string) => d >= masa.hariAwal && d <= masa.hariAkhir;
  const tanpaDasar = m.tanpaDasar.filter(dalamMasa).sort();
  if (tanpaDasar.length > 0) {
    const menunggu = m.statusJadwal === "DRAF" || m.statusJadwal === "DIAJUKAN";
    const tidakTertutup = tanpaDasar.filter((d) => !(menunggu && m.sel.has(d)));
    if (tidakTertutup.length === 0) return { ok: false, alasan: "JADWAL_MENUNGGU_PERSETUJUAN", hari: tanpaDasar };
    return { ok: false, alasan: "CATATAN_HADIR_BELUM_DIMASUKKAN", hari: tidakTertutup };
  }

  const tidakMasuk: string[] = [];
  const masukLibur: string[] = [];
  const luarRadius: string[] = [];
  let terjadwal = 0;
  let izin = 0;
  let dariCatatan = 0;
  for (const [d, h] of [...m.dasar].filter(([d]) => dalamMasa(d)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (h.sumber === "CATATAN") dariCatatan += 1;
    if (h.hadir && h.luarRadius) luarRadius.push(d);
    if (h.kind === "KERJA") {
      terjadwal += 1;
      if (h.hadir) continue;
      if (izinPada(m.izin, m.userId, d)) izin += 1;
      else tidakMasuk.push(d);
    } else if (h.hadir) {
      masukLibur.push(d);
    }
  }

  const penuh = masa.penuh;
  if (penuh && terjadwal === 0 && !beku) return { ok: false, alasan: "TANPA_HARI_KERJA", hari: [] };
  const sumberPembagi: "JADWAL" | "STANDAR" = beku ? beku.sumberPembagi : penuh ? "JADWAL" : "STANDAR";
  const pembagi = beku ? beku.pembagi : penuh ? terjadwal : hariKerjaStandar(m.bulan, m.hariKerjaSpg);
  const tarifHarian = pembagi > 0 ? Math.floor(m.gajiBulanan / pembagi) : 0;
  const hadirAtauIzin = terjadwal - tidakMasuk.length;
  const dasarGaji = penuh ? (hadirAtauIzin === 0 ? 0 : m.gajiBulanan - tidakMasuk.length * tarifHarian) : hadirAtauIzin * tarifHarian;
  const gajiPokok = Math.max(0, dasarGaji + masukLibur.length * tarifHarian);

  return {
    ok: true,
    rincian: {
      bulanKerja: m.bulan,
      gajiBulanan: m.gajiBulanan,
      penuh,
      hariAwal: masa.hariAwal,
      hariAkhir: masa.hariAkhir,
      sumberPembagi,
      pembagi,
      hariKerjaStandar: [...m.hariKerjaSpg],
      tarifHarian,
      hariTerjadwal: terjadwal,
      hariIzin: izin,
      hariTidakMasuk: tidakMasuk.length,
      tanggalTidakMasuk: tidakMasuk,
      hariMasukLibur: masukLibur.length,
      tanggalMasukLibur: masukLibur,
      tanggalLuarRadius: luarRadius,
      hariDariCatatan: dariCatatan,
      gajiPokok,
    },
  };
}

/** Rincian yang dibekukan dari `salaryDetail` sebuah baris yang sudah dibayar; null kalau bentuknya tidak dikenal. */
export function bekuDariRincian(x: unknown): BekuGaji | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.hariAwal !== "string" || typeof r.hariAkhir !== "string" || typeof r.penuh !== "boolean") return null;
  if (typeof r.pembagi !== "number" || !Number.isFinite(r.pembagi)) return null;
  const sumber = r.sumberPembagi === "JADWAL" ? "JADWAL" : r.sumberPembagi === "STANDAR" ? "STANDAR" : null;
  if (!sumber) return null;
  return { hariAwal: r.hariAwal, hariAkhir: r.hariAkhir, penuh: r.penuh, pembagi: r.pembagi, sumberPembagi: sumber };
}

/** `salaryDetail` sebuah baris: rinciannya, sebab ditahan, atau tanda gajinya sudah dihitung di baris lain. */
export type DetailGajiTersimpan =
  | { jenis: "RINCIAN"; rincian: RincianGaji }
  | { jenis: "TAHAN"; alasan: AlasanTahanBayar; hari: string[] }
  | { jenis: "DI_BARIS_LAIN"; refType: string; refId: string };

export function detailGajiUntukDisimpan(g: HasilGaji | null, diBarisLain: { refType: string; refId: string } | null): DetailGajiTersimpan | null {
  if (diBarisLain) return { jenis: "DI_BARIS_LAIN", refType: diBarisLain.refType, refId: diBarisLain.refId };
  if (!g) return null;
  return g.ok ? { jenis: "RINCIAN", rincian: g.rincian } : { jenis: "TAHAN", alasan: g.alasan, hari: g.hari };
}

export function bacaDetailGaji(x: unknown): DetailGajiTersimpan | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (r.jenis === "DI_BARIS_LAIN" && typeof r.refType === "string" && typeof r.refId === "string") {
    return { jenis: "DI_BARIS_LAIN", refType: r.refType, refId: r.refId };
  }
  if (r.jenis === "TAHAN" && adalahAlasanTahanBayar(r.alasan)) {
    return { jenis: "TAHAN", alasan: r.alasan, hari: Array.isArray(r.hari) ? r.hari.filter((h): h is string => typeof h === "string") : [] };
  }
  if (r.jenis === "RINCIAN" && r.rincian && typeof r.rincian === "object") {
    return bekuDariRincian(r.rincian) ? { jenis: "RINCIAN", rincian: r.rincian as RincianGaji } : null;
  }
  return null;
}

/**
 * Peserta gaji satu toko × satu bulan (B19): gabungan urut tanpa kembar dari pemegang jadwal bulan
 * itu (status apa pun), penjual di toko itu bulan itu, pemilik catatan check-in, dan setiap orang
 * yang masa tugasnya di toko itu menyentuh bulan itu (`tugas`: mulai wajib diisi; akhir null =
 * masih bertugas).
 */
export function pesertaGajiBulan(m: {
  jadwal: readonly string[];
  penjual: readonly string[];
  catatan: readonly string[];
  tugas: ReadonlyArray<{ userId: string; mulai: string | null; akhir: string | null }>;
  bulan: string;
}): string[] {
  const awalBulan = `${m.bulan}-01`;
  const akhirBulan = `${m.bulan}-${String(jumlahHariBulan(m.bulan)).padStart(2, "0")}`;
  const ikut = new Set<string>([...m.jadwal, ...m.penjual, ...m.catatan].filter(Boolean));
  for (const t of m.tugas) {
    if (!t.mulai || t.mulai > akhirBulan) continue;
    if (t.akhir && t.akhir < awalBulan) continue;
    ikut.add(t.userId);
  }
  return [...ikut].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** "3.500.000 ÷ 26 hari = Rp 134.615/hari" — dipakai HP dan kantor; angka diformat pemanggil. */
export function ringkasRincianGaji(r: RincianGaji): { pembagi: number; tarifHarian: number; dipotong: number; tambahan: number } {
  return {
    pembagi: r.pembagi,
    tarifHarian: r.tarifHarian,
    dipotong: r.penuh ? r.hariTidakMasuk * r.tarifHarian : 0,
    tambahan: r.hariMasukLibur * r.tarifHarian,
  };
}
