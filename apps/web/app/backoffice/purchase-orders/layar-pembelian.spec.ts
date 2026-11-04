import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis layar pembelian & inventori (repo ini tidak punya pustaka
 * render). Logika murninya dites di spek masing-masing; ini menjaga
 * sambungannya di layar dari temuan audit kantor 2026-10-06.
 */
const WEB = path.resolve(__dirname, "../../..");
const baca = (rel: string) => readFileSync(path.join(WEB, rel), "utf8");

const DAFTAR_PO = "app/backoffice/purchase-orders/PurchaseOrdersPageClient.tsx";
const RINCIAN_PO = "app/backoffice/purchase-orders/[id]/page.tsx";
const BAYAR = "app/backoffice/supplier-payments/page.tsx";
// Register pembayaran pemasok sejak 2026-10-08: halaman server (tab + saringan) + klien tabelnya.
const BAYAR_KLIEN = "app/backoffice/supplier-payments/PembayaranPemasokClient.tsx";
const INVENTORI = "app/backoffice/inventory/InventoryPageClient.tsx";
const DAFTAR_RETUR = "app/backoffice/vendor-returns/page.tsx";
const RINCIAN_RETUR = "app/backoffice/vendor-returns/[id]/page.tsx";
const UBAH_RETUR = "app/backoffice/vendor-returns/[id]/edit/page.tsx";
const GRN_BARU = "app/backoffice/inventory/grn/new/GrnBaruClient.tsx";
const GUDANG = "app/gudang-retur/GudangClient.tsx";

describe("layar pembelian & inventori", () => {
  it("tanpa confirm() bawaan peramban — konfirmasi lewat AlertDialog aplikasi", () => {
    for (const f of [DAFTAR_PO, RINCIAN_PO, BAYAR, BAYAR_KLIEN, INVENTORI, DAFTAR_RETUR, RINCIAN_RETUR]) {
      expect(baca(f), f).not.toMatch(/(^|[^.\w])confirm\(|window\.confirm\(/m);
    }
  });

  it("rincian PO: tombol Terima barang membuka GRN dengan ?poId, dan kartu GRN menaut ke rinciannya", () => {
    const s = baca(RINCIAN_PO);
    expect(s).toContain("/backoffice/inventory/grn/new?poId=");
    expect(s).toContain("/backoffice/inventory/grn/${g.id}");
    expect(s).toMatch(/keadaanBatalPo\(po\)/);
  });

  it("tandai lunas selalu lewat dialog konfirmasi (register dan rincian PO)", () => {
    for (const f of [BAYAR_KLIEN, RINCIAN_PO]) {
      const s = baca(f);
      expect(s, f).toContain("<KonfirmasiBayarDialog");
      expect(s, f).not.toMatch(/onClick=\{\(\) => handle(MarkPaid|PaidToggle)\(/);
    }
  });

  it("daftar PO: batal lewat dialog alasan, tanpa alasan Inggris tetap; nomor PO menaut", () => {
    const s = baca(DAFTAR_PO);
    expect(s).toContain("<BatalPoDialog");
    expect(s).not.toContain("PO cancelled from list");
    expect(s).toContain("href={`/backoffice/purchase-orders/${po.id}`} className={TAUTAN_DOKUMEN}");
  });

  it("tab Penerimaan Barang: nomor GRN dan PO menaut; tab ditulis ke URL", () => {
    const s = baca(INVENTORI);
    expect(s).toContain("href={`/backoffice/inventory/grn/${grn.id}`} className={TAUTAN_DOKUMEN}");
    expect(s).toContain("window.history.replaceState");
    expect(s).toContain("<KeputusanPemilikGrn");
  });

  it("pemilih pemasok untuk saringan dan dokumen lama tidak memakai approvedOnly", () => {
    for (const f of [DAFTAR_RETUR, GRN_BARU]) {
      const s = baca(f);
      expect(s, f).not.toContain("approvedOnly");
      expect(s, f).toContain("getPemasokPilihan");
    }
    // Register pembayaran memuat pemasoknya di server: yang aktif DAN yang punya PO/GRN
    // walau belum disetujui — sama maksudnya dengan getPemasokPilihan.
    for (const f of [BAYAR, BAYAR_KLIEN]) expect(baca(f), f).not.toContain("approvedOnly");
    expect(baca(BAYAR)).toMatch(/OR: \[\{ status: "ACTIVE" \}, \{ purchaseOrders: \{ some: \{\} \} \}, \{ grns: \{ some: \{\} \} \}\]/);
    // Ubah retur: pemasok retur itu sendiri ditambahkan bila tidak disetujui.
    expect(baca(UBAH_RETUR)).toContain("ret.vendor");
  });

  it("tautan dokumen hanya ke halaman yang boleh dibuka (pembeli tanpa inventory:view, gudang tanpa purchase_orders:view)", () => {
    expect(baca(RINCIAN_PO)).toMatch(/bolehBukaGrn \? \(\s*<Link href=\{`\/backoffice\/inventory\/grn\/\$\{g\.id\}`\}/);
    expect(baca("app/backoffice/inventory/grn/[id]/RincianGrnClient.tsx")).toContain("grn.po && bolehBukaPo ?");
    expect(baca(INVENTORI)).toContain("&& bolehBukaPo ? (");
    expect(baca(RINCIAN_RETUR)).toContain("{bolehBukaGrn ? (");
    expect(baca(GRN_BARU)).toContain("poIdAwal && bolehBukaPo");
  });

  it("GRN baru: pemasok belum disetujui hanya bisa dipakai sebagai pemasok PO/draf yang sedang dipilih", () => {
    expect(baca("components/grn/GRNForm.tsx")).toContain("disabled: s.disetujui === false && s.id !== supplierId");
  });

  it("angka uang format Indonesia (bukan locale peramban)", () => {
    for (const f of [DAFTAR_RETUR, RINCIAN_RETUR, BAYAR, RINCIAN_PO, "components/forms/POForm.tsx"]) {
      expect(baca(f), f).not.toContain("toLocaleString(undefined");
    }
  });

  it("/gudang-retur: judul sama dengan menu dan punya ⓘ Bantuan", () => {
    const s = baca(GUDANG);
    expect(s).toContain('useTranslations("navigation")("navHitungRetur")');
    expect(s).toContain("<TombolBantuan");
  });
});
