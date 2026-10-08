import { describe, expect, it } from "vitest";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import { KODE_GALAT_SALDO_AWAL, kunciGalatSaldoAwal, nilaiGalat, type KodeGalatSaldoAwalLengkap } from "./galat";
import { JENIS_SALDO_AWAL, JEJAK_SALDO_AWAL } from "./jenis";
import type { KodeGalatSaldoAwal } from "./writer";
import { SEBAB_KONFLIK_TEMPLAT } from "@/lib/finance/templat-akun/rencana";
import { JEJAK_TEMPLAT_AKUN } from "@/lib/finance/templat-akun/pasang";

// Setiap kode penulis punya tempat di daftar kode layar (diperiksa tsc, bukan vitest).
const _setiapKodePenulisAdaDiDaftar: KodeGalatSaldoAwalLengkap = "" as KodeGalatSaldoAwal;
void _setiapKodePenulisAdaDiDaftar;

type Pesan = Record<string, unknown>;
function ambil(obj: Pesan, jalur: string): unknown {
  return jalur.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Pesan)[k] : undefined), obj);
}

const LOKAL: [string, Pesan][] = [
  ["id", id as Pesan],
  ["en", en as Pesan],
];

describe("pesan saldo awal & templat bagan akun di kedua bahasa", () => {
  const kunci = [
    ...KODE_GALAT_SALDO_AWAL.map((k) => `saldoAwal.galat.${k}`),
    ...JENIS_SALDO_AWAL.map((j) => `saldoAwal.jenis.${j}`),
    ...["BELUM", "DRAF", "DIPOSTING", "BEDA_TANGGAL"].map((s) => `saldoAwal.status.${s}`),
    ...["QTY_NEGATIF", "QTY_NOL", "HPP_LAMA_BEDA"].map((s) => `saldoAwal.persediaan.peringatan.${s}`),
    ...["HPP_TIDAK_TERBACA", "HPP_NEGATIF", "SKU_GANDA"].map((s) => `saldoAwal.persediaan.galat.${s}`),
    ...SEBAB_KONFLIK_TEMPLAT.map((s) => `templatAkun.sebab.${s}`),
    ...["TANPA_AKSES", "BENTROK", "GAGAL"].map((s) => `templatAkun.galat.${s}`),
    ...["openingNone", "openingSome", "openingStale", "linkOpening"].map((s) => `financeLedgerStatus.${s}`),
    ...[...Object.values(JEJAK_SALDO_AWAL), JEJAK_TEMPLAT_AKUN].map((a) => `auditActions.actions.${a}`),
    "auditActions.entities.OpeningBalanceImport",
    "navigation.navFinanceSaldoAwal",
  ];
  for (const [lokal, pesan] of LOKAL) {
    it(`${lokal}: setiap kunci ada dan berisi teks`, () => {
      const hilang = kunci.filter((k) => typeof ambil(pesan, k) !== "string" || (ambil(pesan, k) as string).trim() === "");
      expect(hilang).toEqual([]);
    });
  }

  it("kode tak dikenal jatuh ke pesan umum; sisipan selalu lengkap", () => {
    expect(kunciGalatSaldoAwal("PERIODE_TERTUTUP")).toBe("galat.PERIODE_TERTUTUP");
    expect(kunciGalatSaldoAwal("ENTAH")).toBe("galat.GAGAL");
    expect(nilaiGalat({ periode: "2026-07" })).toEqual({ baris: "-", peran: "-", periode: "2026-07", rincian: "-" });
  });
});
