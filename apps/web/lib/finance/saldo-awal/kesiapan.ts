import { JENIS_SALDO_AWAL, STATUS_SALDO_AWAL, type JenisSaldoAwal } from "./jenis";

/*
 * Ringkasan "kesiapan saldo awal" — murni, dibaca spanduk kesiapan buku besar
 * dan halaman Saldo awal. TIDAK menahan "buku besar aktif": usaha baru sah
 * tanpa piutang, hutang, atau persediaan awal.
 */

/** BEDA_TANGGAL = sudah diposting, tetapi untuk tanggal mulai yang lain dari sekarang. */
export type StatusJenisSaldoAwal = "BELUM" | "DRAF" | "DIPOSTING" | "BEDA_TANGGAL";

export type RingkasanSaldoAwal = {
  jenis: Record<JenisSaldoAwal, StatusJenisSaldoAwal>;
  jumlahDiposting: number;
  total: number;
  adaBedaTanggal: boolean;
};

export type BarisKesiapanSaldoAwal = { kind: string; status: string; tanggalMulai: string };

/**
 * Butir spanduk kesiapan buku besar. "Beres" = setidaknya satu jenis diposting
 * untuk tanggal mulai yang berlaku dan tidak ada yang tertinggal di tanggal
 * mulai lama. Kunci pesan di `financeLedgerStatus.*`.
 */
export function butirSaldoAwal(r: RingkasanSaldoAwal): { ok: boolean; kunci: "openingNone" | "openingSome" | "openingStale"; n: number; total: number } {
  if (r.adaBedaTanggal) return { ok: false, kunci: "openingStale", n: r.jumlahDiposting, total: r.total };
  if (r.jumlahDiposting === 0) return { ok: false, kunci: "openingNone", n: 0, total: r.total };
  return { ok: true, kunci: "openingSome", n: r.jumlahDiposting, total: r.total };
}

export function ringkasSaldoAwal(rows: readonly BarisKesiapanSaldoAwal[], tanggalMulai: string | null): RingkasanSaldoAwal {
  const jenis = Object.fromEntries(JENIS_SALDO_AWAL.map((j) => [j, "BELUM"])) as Record<JenisSaldoAwal, StatusJenisSaldoAwal>;
  for (const j of JENIS_SALDO_AWAL) {
    const milik = rows.filter((r) => r.kind === j);
    const posting = milik.find((r) => r.status === STATUS_SALDO_AWAL.DIPOSTING);
    if (posting) jenis[j] = tanggalMulai && posting.tanggalMulai !== tanggalMulai ? "BEDA_TANGGAL" : "DIPOSTING";
    else if (milik.some((r) => r.status === STATUS_SALDO_AWAL.DRAF)) jenis[j] = "DRAF";
  }
  const nilai = Object.values(jenis);
  return {
    jenis,
    jumlahDiposting: nilai.filter((s) => s === "DIPOSTING" || s === "BEDA_TANGGAL").length,
    total: JENIS_SALDO_AWAL.length,
    adaBedaTanggal: nilai.includes("BEDA_TANGGAL"),
  };
}
