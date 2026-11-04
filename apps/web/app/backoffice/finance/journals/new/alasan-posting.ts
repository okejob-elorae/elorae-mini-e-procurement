/*
 * Kenapa tombol "Posting Jurnal" masih mati — kekurangan PERTAMA menurut
 * urutan isian, supaya kalimatnya menunjuk tempat yang harus diisi (pola
 * `KeteranganKirim` di PWA). Murni, dites di `alasan-posting.spec.ts`.
 */

type BarisIsian = { chartAccountId: string; debit: string; credit: string };

export type AlasanBelumPosting =
  | { kunci: "description" }
  | { kunci: "lineAccount"; n: number }
  | { kunci: "twoLines" }
  | { kunci: "unbalanced" };

const angka = (v: string): number => parseFloat(v) || 0;

/** Selisih di bawah satu sen dianggap seimbang (sama dengan pemeriksaan server). */
const TOLERANSI = 0.01;

export function alasanBelumBisaPosting(isian: { description: string; lines: BarisIsian[] }): AlasanBelumPosting | null {
  if (isian.description.trim() === "") return { kunci: "description" };

  const tanpaAkun = isian.lines.findIndex((l) => !l.chartAccountId && (angka(l.debit) > 0 || angka(l.credit) > 0));
  if (tanpaAkun >= 0) return { kunci: "lineAccount", n: tanpaAkun + 1 };

  const lengkap = isian.lines.filter((l) => l.chartAccountId && (angka(l.debit) > 0 || angka(l.credit) > 0));
  if (lengkap.length < 2) return { kunci: "twoLines" };

  const debit = isian.lines.reduce((s, l) => s + angka(l.debit), 0);
  const kredit = isian.lines.reduce((s, l) => s + angka(l.credit), 0);
  if (keadaanSaldo(debit, kredit) !== "seimbang") return { kunci: "unbalanced" };

  return null;
}

/** "kosong" saat belum ada nominal sama sekali — jangan menampilkan "Seimbang" hijau pada Rp 0. */
export function keadaanSaldo(debit: number, kredit: number): "kosong" | "seimbang" | "belum" {
  if (debit === 0 && kredit === 0) return "kosong";
  return Math.abs(debit - kredit) < TOLERANSI ? "seimbang" : "belum";
}
