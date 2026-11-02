import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatIDR } from "@/lib/sales-orders/format";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { formatKoreksi } from "@/lib/spg/koreksi";
import { payloadGajiHp } from "@/lib/spg/komisi-hp";
import type { KomisiResmiHp } from "@/lib/spg/komisi-queries";

/*
 * Urutan beranda SPG: tombol Jual tepat di bawah kartu absen, check-out PALING
 * BAWAH (dulu check-out menempel di atas Jual — salah ketuk = kunjungan selesai),
 * kepala hanya ⓘ dan lonceng, dan baris tugas "pesanan untuk toko". Komponen
 * anak ditiru jadi penanda supaya yang diuji hanya susunannya.
 *
 * Terjemahan ditiru menjadi kuncinya, kecuali `h.en` dinyalakan: kartu gaji
 * diuji dengan teks bahasa Inggris sungguhan, karena rupiahnya hanya terlihat
 * di dalam kalimat terjemahan.
 */

const h = vi.hoisted(() => ({ lokal: null as null | { keadaan: string; waktu: number }, en: false }));

vi.mock("next-intl", async () => {
  const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
  const en = (await import("@/lib/i18n/messages/en.json")).default;
  return {
    useTranslations: (namespace?: string) =>
      h.en ? createTranslator({ locale: "en", messages: en as never, namespace: namespace as never }) : (k: string) => k,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("./stores/[id]/CheckInButton", () => ({ CheckInButton: () => createElement("i", null, "[CHECKIN]") }));
vi.mock("./stores/[id]/CheckOutButton", () => ({ CheckOutButton: () => createElement("i", null, "[CHECKOUT]") }));
vi.mock("./TombolKeluar", () => ({ TombolKeluar: () => createElement("i", null, "[KELUAR]") }));
vi.mock("./kabar/TombolKabar", () => ({ TombolKabar: () => createElement("i", null, "[KABAR]") }));
vi.mock("./TombolBantuanHp", () => ({ TombolBantuanHp: () => createElement("i", null, "[BANTUAN]") }));
vi.mock("./beranda/KartuPengumuman", () => ({ KartuPengumuman: () => null }));
vi.mock("@/components/spg/PenghitungPengunjungMini", () => ({ PenghitungPengunjungMini: () => null }));
vi.mock("@/components/gerak/AngkaNaik", () => ({ AngkaNaik: () => createElement("span", null, "0") }));
vi.mock("@/lib/pwa/offline/hitung", () => ({ hitungBelumTerkirim: async () => 0, PERISTIWA_ANTREAN: "antrean" }));
vi.mock("@/lib/pwa/offline/luring-kunjungan-hook", () => ({ useKunjunganLokal: () => ({ kunjungan: h.lokal }) }));
vi.mock("@/lib/pwa/offline/luring-kunjungan", () => ({
  kunjunganLokalSah: (k: { keadaan: string } | null) => k !== null && k.keadaan !== "ditolak",
}));

const { SpgHomeShell } = await import("./SpgHomeShell");

type Data = ComponentProps<typeof SpgHomeShell>["data"];

const DATA: Data = {
  pengumuman: null,
  toko: { id: "toko-1", name: "Toko Uji", code: "TU", address: null, mapsUrl: null },
  kunjungan: null,
  tokoLainTerbuka: null,
  hariIniLabel: "Senin, 6 Okt",
  hariIni: { nota: 0, total: 0, barang: 0 },
  bulanIni: { total: 0, target: null, persen: null },
  hariMasuk: 3,
  terlaris: [],
  hampirHabis: 0,
  stokDilacak: true,
  kirimanMenunggu: 0,
  pesananDiproses: 0,
  pesananLama: 0,
  notaHariIni: [],
  gaji: { perkiraan: null, terakhir: null },
  shift: null,
  titipDatang: 0,
  tukarMasuk: 0,
  tutupPerlu: false,
  pengunjung: null,
  userId: "spg-1",
};

const KUNJUNGAN = { id: "v1", jamMasuk: "08.00", diLuarRadius: false, jarak: null };
const JUAL = 'href="/pwa/spg/sale"';

const gambar = (d: Partial<Data> = {}) => renderToStaticMarkup(createElement(SpgHomeShell, { userName: "Sari", data: { ...DATA, ...d } }));

beforeEach(() => {
  h.lokal = null;
  h.en = false;
});

afterEach(() => {
  h.en = false;
});

describe("beranda SPG — urutan tombol kunjungan dan Jual", () => {
  it("belum check-in: tombol check-in di kartu absen, tanpa Jual (alasannya disebut), tanpa check-out", () => {
    const html = gambar();
    expect(html).toContain("[CHECKIN]");
    expect(html).not.toContain(JUAL);
    expect(html).not.toContain("[CHECKOUT]");
    expect(html.indexOf("[CHECKIN]")).toBeLessThan(html.indexOf("sellNeedsCheckin"));
  });

  it("sudah check-in hari ini: Jual tepat di bawah absen, check-out paling bawah dan tidak menempel", () => {
    const html = gambar({ kunjungan: KUNJUNGAN });
    const jual = html.indexOf(JUAL);
    const keluar = html.indexOf("[CHECKOUT]");
    expect(jual).toBeGreaterThan(-1);
    expect(keluar).toBeGreaterThan(jual);
    // Di antara keduanya ada isi beranda — bukan dua tombol bertumpuk.
    const antara = html.slice(jual, keluar);
    for (const bagian of ["bestTitle", "notesTitle", "payTitle"]) expect(antara).toContain(bagian);
    // Check-out berdiri di kartunya sendiri, di bawah gaji.
    expect(html.indexOf("checkoutTitle")).toBeGreaterThan(html.indexOf("payTitle"));
    expect(html).not.toContain("[CHECKIN]");
    expect(html).not.toContain("sellNeedsCheckin");
  });

  it("check-in yang masih di HP (tanpa sinyal) juga membuka Jual; kartu kunjungannya di bawah", () => {
    h.lokal = { keadaan: "antre", waktu: Date.UTC(2026, 9, 6, 1, 30) };
    const html = gambar();
    const jual = html.indexOf(JUAL);
    expect(jual).toBeGreaterThan(-1);
    expect(html.indexOf("[CHECKIN]")).toBeGreaterThan(html.indexOf("payTitle"));
    expect(html.indexOf("[CHECKIN]")).toBeGreaterThan(jual);
  });

  it("check-in dari hari lain: check-out di kartu absen, dan Jual TIDAK ditawarkan tepat di bawahnya", () => {
    const html = gambar({ kunjungan: { ...KUNJUNGAN, lama: true } });
    expect(html).toContain("checkedInEarlier");
    expect(html).not.toContain(JUAL);
    expect(html.indexOf("[CHECKOUT]")).toBeLessThan(html.indexOf("sellNeedsCheckin"));
    expect(html).not.toContain("checkoutTitle");
  });

  it("check-in tanpa sinyal dari hari lain: tanpa Jual, kartu kunjungan HP-nya SEKALI di kartu absen, jamnya bertanggal", () => {
    // Senin 5 Okt 2026 19.16 WIB; halaman dibuat Selasa 6 Okt.
    h.lokal = { keadaan: "antre", waktu: Date.UTC(2026, 9, 5, 12, 16) };
    const html = gambar({ hariKunci: "2026-10-06" });
    expect(html).not.toContain(JUAL);
    expect(html.split("[CHECKIN]")).toHaveLength(2);
    expect(html.indexOf("[CHECKIN]")).toBeLessThan(html.indexOf("sellNeedsCheckin"));
    expect(html).toContain("checkedInEarlier");
  });

  it("kepala beranda hanya ⓘ dan lonceng — Tema dan Keluar ada di Lainnya", () => {
    const html = gambar({ kunjungan: KUNJUNGAN });
    const kepala = html.slice(0, html.indexOf("</header>"));
    expect(kepala).toContain("[BANTUAN]");
    expect(kepala).toContain("[KABAR]");
    expect(html).not.toContain("[KELUAR]");
    expect(html).not.toContain("/pwa/tampilan");
  });
});

describe("beranda SPG — tugas pesanan untuk toko", () => {
  it("ada pesanan yang diproses kantor → baris tugas ke bagian pesanan di Terima kiriman", () => {
    const html = gambar({ pesananDiproses: 2 });
    expect(html).toContain('href="/pwa/spg/terima#pesanan-toko"');
    expect(html).toContain("taskOrdersComing");
  });

  it("pesanan konsi lama menunggu konfirmasi → baris tugasnya sendiri ke bagian pesanan", () => {
    const html = gambar({ pesananLama: 1, pesananDiproses: 0 });
    expect(html).toContain('href="/pwa/spg/terima#pesanan-toko"');
    expect(html).toContain("taskOldOrdersConfirm");
    expect(html).not.toContain("taskOrdersComing");
  });

  it("tanpa pesanan → tanpa baris tugas", () => {
    const html = gambar({ pesananDiproses: 0 });
    expect(html).not.toContain("#pesanan-toko");
    expect(html).not.toContain("taskOrdersComing");
    expect(html).not.toContain("taskOldOrdersConfirm");
  });
});

describe("beranda SPG — kartu gaji memakai bulan pembayaran, bulan penjualan sebagai catatan", () => {
  const TERAKHIR = { bulanJualLabel: "Oktober 2026", bulanBayarLabel: "November 2026", diterima: 500_000, dibayar: false };

  it("pembayaran resmi terakhir: bulan pembayarannya di baris utama, bulan penjualannya di catatan", () => {
    const html = gambar({ gaji: { perkiraan: null, terakhir: TERAKHIR } });
    expect(html).toContain("payLastUnpaid");
    expect(html).toContain("salesMonthNote");
    expect(html).not.toContain("payLastPending");
  });

  it("laporannya dibuka lagi kantor (tanpa bulan pembayaran): disebut menunggu, catatan bulan penjualan tetap ada", () => {
    const html = gambar({ gaji: { perkiraan: null, terakhir: { ...TERAKHIR, bulanBayarLabel: null } } });
    expect(html).toContain("payLastPending");
    expect(html).not.toContain("payLastUnpaid");
    expect(html).toContain("salesMonthNote");
  });

  it("koreksi komisi yang menunggu pembayaran berikutnya punya barisnya sendiri; tanpa koreksi, tidak ada", () => {
    expect(gambar({ gaji: { perkiraan: null, terakhir: TERAKHIR, koreksiMenunggu: -2_500 } })).toContain("payCorrectionsWaiting");
    expect(gambar({ gaji: { perkiraan: null, terakhir: TERAKHIR, koreksiMenunggu: null } })).not.toContain("payCorrectionsWaiting");
  });

  it("pembayaran yang ditahan menunggu keputusan kantor disebut menunggu, bukan belum dibayar", () => {
    const html = gambar({ gaji: { perkiraan: null, terakhir: { ...TERAKHIR, ditahan: true } } });
    expect(html).toContain("payLastPending");
    expect(html).not.toContain("payLastUnpaid");
  });

  it("perkiraan bulan berjalan tampil di atas pembayaran resmi terakhir — yang terakhir tetap dengan catatan bulan penjualannya", () => {
    const html = gambar({ gaji: { perkiraan: { totalToko: 0, bagianSaya: 120_000 }, terakhir: TERAKHIR } });
    expect(html).toContain("payEstimate");
    expect(html.indexOf("payEstimate")).toBeLessThan(html.indexOf("payLastUnpaid"));
    expect(html).toContain("salesMonthNote");
    expect(html).not.toContain("payNone");
  });
});

describe("beranda SPG — kartu gaji memakai angka DITERIMA yang sama dengan layar Gaji & komisi (teks bahasa Inggris)", () => {
  /** Oktober dicek November: komisi Rp 30.000, beban barang hilang Rp 2.500, koreksi September +Rp 17.500. */
  const RESMI: KomisiResmiHp = {
    kunci: "putus:r1",
    jenis: "PUTUS",
    bulanJual: "2026-10",
    bulanBayar: "2026-11",
    toko: "Toko Uji",
    gaji: null,
    komisi: 30_000,
    komisiLama: null,
    total: 30_000,
    potonganHilang: 2_500,
    potong: 15,
    ditetapkan: "2026-11-03T03:00:00.000Z",
    dibayar: null,
    aturanLama: false,
    koreksi: [{ bulanJual: "2026-09", toko: "Toko Uji", jumlah: 17_500, diterapkan: false, dibawa: 0 }],
    diterima: 45_000,
    ditahan: false,
  };
  const fmt = { bulan: salesMonthLabelId, tanggal: (iso: string) => iso.slice(0, 10) };

  it("baris utama: bulan pembayarannya dan yang diterima — rupiahnya sama dengan muatan layar Gaji & komisi", () => {
    h.en = true;
    const [p] = payloadGajiHp({ perkiraan: null, resmi: [RESMI] }, false, fmt).resmi;
    const html = gambar({
      gaji: {
        perkiraan: null,
        terakhir: { bulanJualLabel: p.bulanJualLabel, bulanBayarLabel: p.bulanBayarLabel, diterima: p.diterima, dibayar: false },
        koreksiMenunggu: null,
      },
    });
    expect(html).toContain("Payout November 2026");
    expect(html).toContain(formatIDR(p.diterima));
    // Bukan komisi kotornya, dan bukan total sebelum potongan dan koreksi.
    expect(html).not.toContain(formatIDR(RESMI.total));
  });

  it("koreksi yang menunggu pembayaran berikutnya tampil dengan tandanya", () => {
    h.en = true;
    const html = gambar({ gaji: { perkiraan: null, terakhir: null, koreksiMenunggu: 17_500 } });
    expect(html).toContain(formatKoreksi(17_500));
  });
});
