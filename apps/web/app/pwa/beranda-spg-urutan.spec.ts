import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Urutan beranda SPG: tombol Jual tepat di bawah kartu absen, check-out PALING
 * BAWAH (dulu check-out menempel di atas Jual — salah ketuk = kunjungan selesai),
 * kepala hanya ⓘ dan lonceng, dan baris tugas "pesanan untuk toko". Komponen
 * anak ditiru jadi penanda supaya yang diuji hanya susunannya.
 */

const h = vi.hoisted(() => ({ lokal: null as null | { keadaan: string; waktu: number } }));

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
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
vi.mock("@/components/dashboard/AngkaNaik", () => ({ AngkaNaik: () => createElement("span", null, "0") }));
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

  it("tanpa pesanan → tanpa baris tugas", () => {
    const html = gambar({ pesananDiproses: 0 });
    expect(html).not.toContain("#pesanan-toko");
    expect(html).not.toContain("taskOrdersComing");
  });
});
