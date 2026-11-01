import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAFTAR_BANTUAN } from "./daftar";

/**
 * Setiap halaman kantor dan HP punya penjelasan di Bantuan. Penjelasan sudah
 * tidak tertulis di layar (keputusan pemilik 2026-10-05), jadi halaman baru
 * tanpa entri berarti halaman yang tidak dijelaskan di mana pun — tes ini yang
 * mengingatkan.
 */

const APP = path.resolve(__dirname, "../../app");

/*
 * Versi tim dari fitur yang dibangun dua kali. Pemilik memilih versi Max
 * (2026-10-29), jadi halaman ini akan dihapus dan tidak diberi penjelasan.
 * Begitu halamannya hilang, tes kedua di bawah mengingatkan untuk mencoretnya.
 */
const RETUR_TIM = "retur toko versi tim, akan dihapus: pemilik memilih retur versi Max (NRT/NRI)";
const PIUTANG_TIM = "piutang & pelunasan versi tim, akan dihapus: pemilik memilih piutang dan BKM versi Max";
const KONSI_TIM = "laporan konsinyasi versi tim, akan dihapus: pemilik memilih siklus konsinyasi versi Max";
const TRANSFER_TIM = "transfer toko versi tim, akan dihapus: pemilik memilih mutasi antar toko versi Max";
const KOMISI_SPG_TIM = "komisi SPG versi tim, akan dihapus: pemilik memilih gaji & komisi SPG versi Max";
const BAYAR_PEMASOK_TIM = "pembayaran tagihan vendor versi tim, akan dihapus: pemilik memilih pembayaran pemasok versi Max";

/** Halaman yang sengaja tanpa entri, dengan alasannya. */
const DIKECUALIKAN: Record<string, string> = {
  "/backoffice": "hanya mengalihkan ke beranda",
  "/backoffice/bantuan": "halaman Bantuan itu sendiri",
  "/backoffice/kreatif/brief": "alamat lama, hanya mengalihkan ke Kolaborasi",
  "/backoffice/sales-orders/[id]/pick-list": "halaman cetak, langsung memanggil print",
  "/backoffice/sales-orders/[id]/packing-slip": "halaman cetak, langsung memanggil print",
  "/pwa/offline": "pemberitahuan sedang tidak ada sinyal",

  "/backoffice/field-returns": RETUR_TIM,
  "/backoffice/field-returns/[id]": RETUR_TIM,
  "/pwa/stores/[id]/retur": RETUR_TIM,

  "/backoffice/finance/piutang": PIUTANG_TIM,
  "/backoffice/finance/piutang/[id]": PIUTANG_TIM,
  "/backoffice/finance/payments": PIUTANG_TIM,
  "/backoffice/finance/payments/[id]": PIUTANG_TIM,
  "/backoffice/finance/pelunasan": PIUTANG_TIM,
  "/backoffice/finance/pelunasan/[id]": PIUTANG_TIM,
  "/backoffice/finance/collections": PIUTANG_TIM,
  "/backoffice/settings/piutang": PIUTANG_TIM,
  "/pwa/collections": PIUTANG_TIM,
  "/pwa/collections/[receivableId]": PIUTANG_TIM,
  "/pwa/pelunasan": PIUTANG_TIM,
  "/pwa/pelunasan/[storeId]": PIUTANG_TIM,
  "/pwa/bkm/[settlementId]": PIUTANG_TIM,

  "/backoffice/konsi-sell-through": KONSI_TIM,
  "/backoffice/konsi-sell-through/[id]": KONSI_TIM,

  "/backoffice/store-transfers": TRANSFER_TIM,
  "/backoffice/store-transfers/new": TRANSFER_TIM,
  "/backoffice/store-transfers/[id]": TRANSFER_TIM,

  "/backoffice/spg-commission": KOMISI_SPG_TIM,
  "/backoffice/settings/spg-commission": KOMISI_SPG_TIM,

  "/backoffice/vendor-payments": BAYAR_PEMASOK_TIM,
  "/backoffice/vendor-payments/new": BAYAR_PEMASOK_TIM,
  "/backoffice/vendor-payments/[id]": BAYAR_PEMASOK_TIM,
};

function halaman(dir: string, rute: string[] = []): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const segmen = e.name.startsWith("(") ? [] : [e.name];
      hasil.push(...halaman(path.join(dir, e.name), [...rute, ...segmen]));
    } else if (e.name === "page.tsx") {
      hasil.push("/" + rute.join("/"));
    }
  }
  return hasil;
}

describe("cakupan Bantuan", () => {
  const semua = [...halaman(path.join(APP, "backoffice"), ["backoffice"]), ...halaman(path.join(APP, "pwa"), ["pwa"])];
  const terdaftar = new Set(DAFTAR_BANTUAN.map((e) => e.rute));

  it("setiap halaman kantor dan HP punya entri Bantuan", () => {
    const belum = semua.filter((r) => !terdaftar.has(r) && !(r in DIKECUALIKAN));
    expect(belum).toEqual([]);
  });

  it("daftar pengecualian hanya berisi halaman yang masih ada dan memang tanpa entri", () => {
    for (const r of Object.keys(DIKECUALIKAN)) {
      expect(semua, r).toContain(r);
      expect(terdaftar.has(r), r).toBe(false);
    }
  });
});
