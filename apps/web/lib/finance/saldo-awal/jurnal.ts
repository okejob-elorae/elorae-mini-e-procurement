import type { PostingRole } from "@/lib/constants/journal-roles";
import { LABEL_KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import type { EntriAkun, EntriHutang, EntriPiutangMarketplace, EntriPiutangToko } from "./jenis";

/*
 * Baris jurnal saldo awal — murni, dalam SEN supaya jumlahnya persis. Setiap
 * jenis menghasilkan baris bertanda (positif = debit), lalu
 * `susunJurnalSaldoAwal` menambahkan SATU baris lawan ke `OPENING_EQUITY`
 * sebesar selisihnya. Pratinjau di layar dan penulis memakai fungsi yang sama.
 */

export type TargetBaris = { peran: PostingRole; akunId?: undefined } | { akunId: string; peran?: undefined };

export type BarisBertanda = TargetBaris & {
  /** Sen; positif = debit, negatif = kredit. */
  nilaiSen: number;
  memo?: string;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

export type BarisJurnalSaldoAwal = TargetBaris & {
  debit: number;
  kredit: number;
  memo?: string;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

export type JurnalSaldoAwal = {
  baris: BarisJurnalSaldoAwal[];
  /** Efek bersih ke Ekuitas saldo awal dalam sen — kredit positif. */
  ekuitasSen: number;
};

/** Rupiah → sen, setengah menjauh dari nol (bukan −0). */
export function keSen(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = Math.sign(n) * Math.round(Math.abs(n) * 100);
  return s === 0 ? 0 : s;
}

export function dariSen(sen: number): number {
  return sen / 100;
}

/**
 * qty × HPP dalam sen, pasti (BigInt): qty dan HPP masing-masing dua desimal,
 * hasilnya dibulatkan ke sen setengah menjauh dari nol — sama dengan
 * `ROUND(qty * hpp, 2)` di basis data dan pembulatan kolom `totalValue`.
 */
export function nilaiKaliHppSen(qty: number, hpp: number): number {
  const hasil = BigInt(keSen(qty)) * BigInt(keSen(hpp)); // dalam 1/10.000 rupiah
  const negatif = hasil < BigInt(0);
  const mutlak = negatif ? -hasil : hasil;
  const sen = (mutlak + BigInt(50)) / BigInt(100);
  const n = Number(sen);
  return negatif && n !== 0 ? -n : n;
}

export function susunJurnalSaldoAwal(baris: readonly BarisBertanda[]): JurnalSaldoAwal {
  const hasil: BarisJurnalSaldoAwal[] = [];
  let total = 0;
  for (const b of baris) {
    if (!Number.isInteger(b.nilaiSen) || b.nilaiSen === 0) continue;
    total += b.nilaiSen;
    const target: TargetBaris = b.peran ? { peran: b.peran } : { akunId: b.akunId! };
    hasil.push({
      ...target,
      debit: b.nilaiSen > 0 ? dariSen(b.nilaiSen) : 0,
      kredit: b.nilaiSen < 0 ? dariSen(-b.nilaiSen) : 0,
      ...(b.memo ? { memo: b.memo } : {}),
      ...(b.channel ? { channel: b.channel } : {}),
      ...(b.storeId ? { storeId: b.storeId } : {}),
    });
  }
  if (total !== 0) {
    hasil.push({
      peran: "OPENING_EQUITY",
      debit: total < 0 ? dariSen(-total) : 0,
      kredit: total > 0 ? dariSen(total) : 0,
      memo: "Lawan saldo awal",
    });
  }
  return { baris: hasil, ekuitasSen: total };
}

export function barisBertandaAkun(entri: readonly EntriAkun[]): BarisBertanda[] {
  return entri.map((e) => ({
    akunId: e.akunId,
    nilaiSen: keSen(e.debit) - keSen(e.kredit),
    ...(e.catatan ? { memo: e.catatan } : {}),
  }));
}

export function barisBertandaPersediaan(nilaiPerPeranSen: Partial<Record<"INVENTORY" | "INVENTORY_FG", number>>): BarisBertanda[] {
  return (["INVENTORY", "INVENTORY_FG"] as const).map((peran) => ({
    peran,
    nilaiSen: nilaiPerPeranSen[peran] ?? 0,
    memo: peran === "INVENTORY_FG" ? "Saldo awal persediaan barang jadi" : "Saldo awal persediaan bahan",
  }));
}

export function barisBertandaPiutangToko(entri: readonly EntriPiutangToko[]): BarisBertanda[] {
  return entri.map((e) => ({
    peran: "AR_STORE" as const,
    nilaiSen: keSen(e.jumlah),
    storeId: e.storeId,
    memo: `Saldo awal piutang ${e.nama ?? e.kode ?? ""}`.trim(),
  }));
}

export function barisBertandaPiutangMarketplace(entri: readonly EntriPiutangMarketplace[]): BarisBertanda[] {
  return entri.map((e) => ({
    peran: "AR" as const,
    nilaiSen: keSen(e.jumlah),
    channel: e.kanal,
    memo: `Saldo awal piutang ${LABEL_KANAL_JURNAL[e.kanal]}`,
  }));
}

export function barisBertandaHutang(entri: readonly EntriHutang[]): BarisBertanda[] {
  return entri.map((e) => ({
    peran: "AP" as const,
    nilaiSen: -keSen(e.jumlah),
    memo: `Saldo awal hutang ${e.nama ?? e.kode ?? ""}`.trim(),
  }));
}
