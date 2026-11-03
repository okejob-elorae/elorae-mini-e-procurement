import { hariAntara, masaKerjaBulan } from "./gaji-pokok";
import type { AturanShift } from "./pengaturan";
import { rencanakanSimpanJadwalSpg, type BarisShift, type IsianSel, type RencanaJadwalSpg, type TolakJadwalSpg } from "./shift";

/**
 * Jadwal kerja BULANAN SPG — aturan murni, tanpa basis data (keputusan pemilik 2026-11-02, P7c:
 * "SPG yang bisa mengisi dan di acc oleh kantor … ini biasanya kewajiban dari SPG").
 *
 * Sel jadwalnya tetap `SpgShift` (satu SPG × satu hari). Di atasnya satu kepala per SPG × bulan
 * (`SpgMonthSchedule`): DRAF → DIAJUKAN (SPG menekan "Ajukan ke kantor") → DISETUJUI / DITOLAK
 * (kantor, `spg_schedules:approve`). Setiap penulisan sel — isian SPG, kisi mingguan kantor, tukar
 * shift yang disetujui — menaikkan `version` kepalanya di transaksi yang sama
 * (`sentuhJadwalBulan`), jadi keputusan kantor selalu atas versi yang ia lihat. Bulan yang sudah
 * disetujui kembali DIAJUKAN begitu diubah oleh orang yang tidak memegang izin menyetujui.
 *
 * Gaji pokok dihitung dari jadwal yang DISETUJUI (`lib/spg/gaji-pokok.ts`). Hari yang sudah lewat
 * tidak bisa diubah siapa pun (`HARI_LEWAT`); hari kosong yang sudah lewat ditutup catatan
 * check-in toko yang dimasukkan kantor (P7d, P7e).
 */

export const STATUS_JADWAL_BULAN = ["DRAF", "DIAJUKAN", "DISETUJUI", "DITOLAK"] as const;
export type StatusJadwalBulan = (typeof STATUS_JADWAL_BULAN)[number];

export const statusJadwalBulanDari = (s: string | null | undefined): StatusJadwalBulan | null =>
  s && (STATUS_JADWAL_BULAN as readonly string[]).includes(s) ? (s as StatusJadwalBulan) : null;

/** `AuditLog.action` — label di `auditActions.actions.<KODE>`. */
export const JEJAK_JADWAL_BULAN = {
  DIAJUKAN: "SPG_MONTH_SCHEDULE_SUBMITTED",
  DISETUJUI: "SPG_MONTH_SCHEDULE_APPROVED",
  DITOLAK: "SPG_MONTH_SCHEDULE_REJECTED",
  DIBUKA_LAGI: "SPG_MONTH_SCHEDULE_REOPENED",
} as const;

export const ENTITAS_JADWAL_BULAN = "SpgMonthSchedule";

/** Kategori `AdminNotification` saat SPG mengajukan jadwal bulannya (`spg_schedules:approve`). */
export const KATEGORI_NOTIF_JADWAL_BULAN = "SPG_SCHEDULE_SUBMITTED";

export const MAKS_ALASAN_JADWAL = 300;

/** Bulan berikut "2026-12" → "2027-01". */
export function bulanBerikut(bulan: string): string {
  const [th, bl] = bulan.split("-").map(Number);
  return bl === 12 ? `${th + 1}-01` : `${th}-${String(bl + 1).padStart(2, "0")}`;
}

/** Bulan yang boleh diisi SPG dari HP: bulan berjalan dan bulan berikutnya (WIB). */
export function bulanBolehDiisiSpg(hariIni: string): string[] {
  const bulan = hariIni.slice(0, 7);
  return [bulan, bulanBerikut(bulan)];
}

export type KodeTolakIsiBulan = "BULAN_TIDAK_BOLEH" | "BUKAN_BULAN_INI" | "DI_LUAR_MASA_KERJA";

/**
 * Rencana SPG mengisi jadwal bulannya sendiri. Hanya bulan berjalan dan berikutnya, hanya hari di
 * bulan itu, hanya hari di masa kerjanya (mulai/berhenti), lalu aturan simpan jadwal yang sama
 * dengan kisi kantor (`rencanakanSimpanJadwalSpg`: hari lewat tidak bisa diubah, shift harus ada di
 * Pengaturan → SPG).
 */
export function rencanakanIsiJadwalBulanSpg(m: {
  bulan: string;
  hariIni: string;
  userId: string;
  mulai: string | null;
  akhir: string | null;
  sebelum: readonly BarisShift[];
  isian: readonly IsianSel[];
  aturan: AturanShift;
}): RencanaJadwalSpg | TolakJadwalSpg | { ok: false; kode: KodeTolakIsiBulan; day?: string } {
  if (!bulanBolehDiisiSpg(m.hariIni).includes(m.bulan)) return { ok: false, kode: "BULAN_TIDAK_BOLEH" };
  const masa = masaKerjaBulan(m.bulan, m.mulai, m.akhir);
  for (const s of m.isian) {
    if (typeof s.day !== "string" || !s.day.startsWith(`${m.bulan}-`)) return { ok: false, kode: "BUKAN_BULAN_INI", day: String(s.day) };
    if (!masa || s.day < masa.hariAwal || s.day > masa.hariAkhir) return { ok: false, kode: "DI_LUAR_MASA_KERJA", day: s.day };
  }
  return rencanakanSimpanJadwalSpg({
    sebelum: m.sebelum,
    isian: m.isian.map((s) => ({ ...s, userId: m.userId })),
    aturan: m.aturan,
    hariIni: m.hariIni,
    spg: new Set([m.userId]),
  });
}

/**
 * Hari yang masih kosong dan masih bisa diisi: dari max(hari ini, hari mulai) sampai akhir masa
 * kerjanya di bulan itu. "Ajukan ke kantor" ditolak selama daftar ini tidak kosong
 * (`JADWAL_BELUM_LENGKAP`). Hari lewat yang kosong tidak termasuk — tidak ada yang bisa mengisinya
 * lagi, catatan check-in toko yang menutupnya.
 */
export function hariBelumTerisi(m: {
  bulan: string;
  hariIni: string;
  masa: { hariAwal: string; hariAkhir: string } | null;
  sel: { has(day: string): boolean };
}): string[] {
  if (!m.masa) return [];
  const dari = m.masa.hariAwal > m.hariIni ? m.masa.hariAwal : m.hariIni;
  return hariAntara(dari, m.masa.hariAkhir).filter((d) => d.startsWith(`${m.bulan}-`) && !m.sel.has(d));
}

/** Potret sel satu bulan untuk jejak: "YYYY-MM-DD" → "KERJA:<kode>" | "LIBUR". */
export function potretSel(sel: ReadonlyArray<{ day: string; kind: string; shiftCode: string | null }>): Record<string, string> {
  const hasil: Record<string, string> = {};
  for (const s of [...sel].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))) {
    hasil[s.day] = s.kind === "KERJA" ? `KERJA:${s.shiftCode ?? ""}` : "LIBUR";
  }
  return hasil;
}

/** Hari yang selnya berbeda dari potret persetujuan terakhir (dibuat, diubah, atau dikosongkan). */
export function hariBerubahSejak(potret: Readonly<Record<string, string>> | null, sekarang: Readonly<Record<string, string>>): string[] {
  if (!potret) return [];
  const hari = new Set([...Object.keys(potret), ...Object.keys(sekarang)]);
  return [...hari].filter((d) => potret[d] !== sekarang[d]).sort();
}

/** Teks alasan tolak/buka lagi: wajib, dirapikan, paling panjang `MAKS_ALASAN_JADWAL`. */
export function rapikanAlasanJadwal(x: unknown): { ok: true; teks: string } | { ok: false; kode: "ALASAN_WAJIB" | "ALASAN_TERLALU_PANJANG" } {
  const teks = typeof x === "string" ? x.trim() : "";
  if (!teks) return { ok: false, kode: "ALASAN_WAJIB" };
  if (teks.length > MAKS_ALASAN_JADWAL) return { ok: false, kode: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, teks };
}
