import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Detail pesanan salesman untuk pesanan KONSINYASI LAMA yang cadangannya masih ditahan: barangnya
 * tidak dikirim lagi (pengirimannya ditolak), jadi layar tidak boleh menyebut "menunggu
 * pengiriman" atau "SPG menerima setiap antaran" — ia menyebut siapa yang mengonfirmasi di toko,
 * dan memberi pemegang toko tanpa SPG tombol ke layarnya. Komponen anak ditiru supaya yang diuji
 * hanya isi keterangan dan pembagian barisnya.
 */

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../actions", () => ({ batalkanPesananSayaAction: vi.fn() }));
vi.mock("../PesananSayaClient", () => ({ NADA_KEADAAN: new Proxy({}, { get: () => "" }) }));
vi.mock("./BuktiTerimaPengiriman", () => ({ BuktiTerimaPengiriman: () => null }));
vi.mock("./TerimaToko", () => ({ KartuTerimaToko: () => null }));
vi.mock("@/app/pwa/TautanKembali", () => ({ TautanKembali: () => createElement("a", { href: "/pwa/orders" }, "[KEMBALI]") }));
vi.mock("@/app/pwa/TombolBantuanHp", () => ({ TombolBantuanHp: () => null }));

const { DetailPesananClient } = await import("./DetailPesananClient");

type Props = ComponentProps<typeof DetailPesananClient>;

const PESANAN: Props["pesanan"] = {
  id: "fso-1",
  orderNo: "KONSI/2026/0001",
  storeId: "toko-1",
  storeName: "Toko Uji",
  orderType: "KONSI",
  status: "APPROVED",
  keadaan: "KONSI_DISETUJUI",
  dibuat: "1 Sep 2026",
  note: null,
  rejectReason: null,
  closeReason: null,
  subtotal: null,
  potonganBaris: null,
  orderDiscountAmount: null,
  appliedOrderPromoName: null,
  total: null,
  jumlahPcs: 10,
  kreditDitahan: false,
  kreditCatatan: null,
  baris: [
    {
      id: "l1",
      productName: "Kaos Polos",
      variantSku: "",
      variantLabel: null,
      qty: 10,
      deliveredQty: 4,
      cancelledQty: 0,
      outstanding: 6,
      unitPrice: null,
      lineTotal: null,
      discountAmount: null,
      appliedPromoName: null,
      isBonus: false,
      bonusPromoName: null,
      banding: null,
    },
  ],
  linimasa: [],
};

const HREF = "/pwa/stores/toko-1/pesanan-lama/fso-1";
const LAMA = { penerima: "SALESMAN" as const, sayaPemegang: true, href: HREF, jumlahBarang: 1, pcs: 6 };

const gambar = (p: Partial<Props> = {}) => renderToStaticMarkup(createElement(DetailPesananClient, { pesanan: PESANAN, ...p }));

describe("detail pesanan — konsinyasi lama yang cadangannya masih ditahan", () => {
  it("pemegang toko tanpa SPG: diberi tahu bahwa ia yang mengonfirmasi, dengan tombol ke layarnya", () => {
    const html = gambar({ pesananLama: LAMA });
    expect(html).toContain(">noticeKonsiLama<");
    expect(html).toContain("noticeKonsiLamaOleh.SAYA");
    expect(html).toContain(`href="${HREF}"`);
    expect(html).toContain("stepNextKonsiLama");
    // Bukan janji pengiriman yang tidak akan datang.
    expect(html).not.toContain(">noticeKonsi<");
    expect(html).not.toContain("stepNextDelivery");
  });

  it("toko ber-SPG: SPG-nya yang mengonfirmasi, tanpa tombol untuk salesman", () => {
    const html = gambar({ pesananLama: { ...LAMA, penerima: "SPG", sayaPemegang: false } });
    expect(html).toContain("noticeKonsiLamaOleh.SPG");
    expect(html).not.toContain(HREF);
  });

  it("toko tanpa SPG yang dipegang salesman lain: menyebut pemegangnya, tanpa tombol", () => {
    const html = gambar({ pesananLama: { ...LAMA, sayaPemegang: false } });
    expect(html).toContain("noticeKonsiLamaOleh.SALESMAN");
    expect(html).not.toContain(HREF);
  });

  it("pembagian baris memakai sudah sampai / belum dikonfirmasi, bukan terkirim / belum dikirim", () => {
    const html = gambar({ pesananLama: LAMA });
    expect(html).toContain(">arrived<");
    expect(html).toContain(">sisa<");
    expect(html).not.toContain(">outstanding<");
  });

  it("konsi alur pengiriman per antaran: tetap menunggu pengiriman, dan pembagian barisnya tampil", () => {
    const html = gambar();
    expect(html).toContain(">noticeKonsi<");
    expect(html).toContain("stepNextDelivery");
    expect(html).toContain(">delivered<");
    expect(html).toContain(">outstanding<");
    expect(html).not.toContain("noticeKonsiLama");
  });

  it("tidak ada harga konsinyasi di layar", () => {
    const html = gambar({ pesananLama: LAMA });
    expect(html).not.toContain("Rp");
  });
});
