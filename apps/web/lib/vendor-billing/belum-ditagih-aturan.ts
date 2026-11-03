/*
 * "Invoice belum ditagih" dan permintaan invoice ke pemasok — aturan MURNI, tanpa impor
 * (`belum-ditagih-aturan.test.ts`).
 *
 * Keputusan pemilik: Q18 ("Daftar WO belum di tagih … fitur untuk menanyakan invoice sehingga
 * kelengkapan dokumen nya terjamin"), 2026-10-29 ("Penerimaan yang belum ada invoice-nya terlihat
 * sebagai belum ditagih"), P19 ("pengingat bila 7 hari belum ada invoice", "pesan WhatsApp disiapkan
 * sistem", "warning di webapp bahwa invoice belum kita terima"), P52 (tombol "tidak perlu invoice"
 * dengan alasan). Semua penerimaan tampil, tanpa saringan tanggal.
 */

export const JENIS_SUMBER_TAGIH = ["GRN", "WO_STEP"] as const;
export type JenisSumberTagih = (typeof JENIS_SUMBER_TAGIH)[number];

/** Selisih qty di bawah ini dianggap nol. */
export const EPS_QTY = 0.005;

/** Permintaan invoice yang belum terjawab sekian hari kalender WIB sesudah diminta terakhir = terlambat (P19). */
export const HARI_PENGINGAT_INVOICE = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Per kunci barang satu GRN: neto = diterima − diretur (retur pemasok SELESAI yang menyebut GRN dan
 * kunci itu); belum = neto − ditagih (baris invoice hidup) − dibebaskan ("tidak perlu invoice" yang
 * berlaku), tidak pernah di bawah nol.
 */
export function belumDitagihPerKunci(
  b: ReadonlyArray<{ key: string; diterima: number; diretur: number; ditagih: number; dibebaskan: number }>,
): Array<{ key: string; belum: number; neto: number }> {
  return b.map((x) => {
    const neto = Math.max(0, round2(x.diterima - x.diretur));
    const belum = Math.max(0, round2(neto - x.ditagih - x.dibebaskan));
    return { key: x.key, neto, belum: belum <= EPS_QTY ? 0 : belum };
  });
}

/**
 * Satu langkah WO: pcs yang belum disebut invoice mana pun dan tidak dibebaskan. Pcs lama (penerimaan
 * sebelum ongkos jahit dibukukan saat diterima) diambil invoice lebih dulu, jadi yang belum ditagih
 * dari pcs lama = min(belum, pcs lama yang belum dibukukan tagihan mana pun).
 */
export function belumDitagihLangkah(a: { qtyDiterima: number; qtyDitagih: number; qtyDibebaskan: number; qtyLamaBelumDibukukan: number }): {
  qtyBelum: number;
  qtyLama: number;
  qtyBaru: number;
} {
  const belumMentah = Math.max(0, round2(a.qtyDiterima - a.qtyDitagih - a.qtyDibebaskan));
  const qtyBelum = belumMentah <= EPS_QTY ? 0 : belumMentah;
  const qtyLama = Math.min(qtyBelum, Math.max(0, round2(a.qtyLamaBelumDibukukan)));
  return { qtyBelum, qtyLama, qtyBaru: round2(qtyBelum - qtyLama) };
}

/** Selisih hari kalender antara dua tanggal "YYYY-MM-DD" (WIB), b − a. */
export function selisihHariKalender(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type StatusBarisPermintaan = "BELUM" | "SEBAGIAN" | "DITERIMA" | "TIDAK_PERLU" | "SUMBER_BATAL";
export type StatusPermintaan = "TERBUKA" | "DITERIMA" | "SELESAI_TANPA_INVOICE" | "DIBATALKAN";

/**
 * Satu baris permintaan dari keadaan sumbernya sekarang. `perlu` = qty yang harus tertutup (neto
 * diterima untuk GRN; qty diterima saat diminta untuk langkah). Tertutup = ditagih + dibebaskan ≥ perlu:
 * DITERIMA bila tagihannya bertambah sejak diminta, TIDAK_PERLU bila tidak. Belum tertutup: SEBAGIAN
 * bila tagihannya bertambah, BELUM bila tidak. Sumber yang hilang atau mati = SUMBER_BATAL.
 */
export function statusBarisPermintaan(
  line: { billedQty: number },
  keadaan: { mati: boolean; perlu: number; ditagih: number; dibebaskan: number } | null,
): StatusBarisPermintaan {
  if (!keadaan || keadaan.mati) return "SUMBER_BATAL";
  const bertambah = keadaan.ditagih > line.billedQty + EPS_QTY;
  const tertutup = keadaan.ditagih + keadaan.dibebaskan >= keadaan.perlu - EPS_QTY;
  if (tertutup) return bertambah ? "DITERIMA" : "TIDAK_PERLU";
  return bertambah ? "SEBAGIAN" : "BELUM";
}

/** Status permintaan dari baris-barisnya (selalu dihitung; `closedAt` hanya simpanan). */
export function statusPermintaan(r: { dibatalkan: boolean; baris: readonly StatusBarisPermintaan[] }): StatusPermintaan {
  if (r.dibatalkan) return "DIBATALKAN";
  if (r.baris.length === 0) return "SELESAI_TANPA_INVOICE";
  const selesai = r.baris.every((b) => b === "DITERIMA" || b === "TIDAK_PERLU" || b === "SUMBER_BATAL");
  if (!selesai) return "TERBUKA";
  return r.baris.some((b) => b === "DITERIMA") ? "DITERIMA" : "SELESAI_TANPA_INVOICE";
}

/** Terlambat: masih TERBUKA dan sudah `hari` hari kalender WIB sesudah diminta terakhir. */
export function adalahTerlambat(status: StatusPermintaan, terakhirWib: string, hariIniWib: string, hari: number = HARI_PENGINGAT_INVOICE): boolean {
  return status === "TERBUKA" && selisihHariKalender(terakhirWib, hariIniWib) >= hari;
}
