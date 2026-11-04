import { describe, expect, it } from "vitest";
import { pesanPesananWa, type BahanPesanPesanan } from "./pesan-pesanan-wa";

const dasar: BahanPesanPesanan = {
  toko: "Toko Sinar Jaya",
  orderNo: "PUTUS/2026/0042",
  // 1 Okt 2026 07.05 UTC = 14.05 WIB.
  tanggal: new Date("2026-10-01T07:05:00Z"),
  orderType: "PUTUS",
  status: "PENDING_APPROVAL",
  baris: [
    { nama: "Kaos Polos — Hitam / L", varian: "Hitam / L", qty: 6, bonus: false, hargaSatuan: 50000, total: 300000 },
    { nama: "Kemeja Flanel", varian: null, qty: 2, bonus: false, hargaSatuan: 125000, total: 250000 },
    { nama: "Kaos Polos — Hitam / L (bonus)", varian: "Hitam / L", qty: 1, bonus: true, hargaSatuan: 0, total: 0 },
  ],
  subtotal: 550000,
  potongan: 25000,
  total: 525000,
  catatan: "Kirim sebelum Jumat\n[Bonus] Kurang 1 pcs Kaos (promo X) — stok tidak cukup.",
  salesman: "Budi",
  inden: null,
};

describe("pesanPesananWa — PUTUS", () => {
  const teks = pesanPesananWa(dasar);

  it("greets the store and names the order, the WIB date and the status", () => {
    expect(teks).toContain("Halo Toko Sinar Jaya");
    expect(teks).toContain("No. pesanan: PUTUS/2026/0042");
    expect(teks).toContain("Tanggal: 1 Okt 2026");
    expect(teks).toContain("14.05 WIB");
    expect(teks).toContain("Status: menunggu persetujuan kantor");
  });

  it("lists lines as name × qty with server prices, without repeating a variant already in the name", () => {
    // `formatRupiah` memakai spasi tak-putus sesudah "Rp" — dicocokkan dengan "." di regex.
    expect(teks).toMatch(/1\. Kaos Polos — Hitam \/ L × 6 @ Rp.50\.000 = Rp.300\.000/);
    expect(teks).not.toContain("Hitam / L — Hitam / L");
    expect(teks).toMatch(/2\. Kemeja Flanel × 2 @ Rp.125\.000 = Rp.250\.000/);
  });

  it("marks bonus lines as bonus, once, and without a price", () => {
    const baris = teks.split("\n").find((b) => b.startsWith("3. "));
    expect(baris).toBe("3. Kaos Polos — Hitam / L × 1 (bonus)");
  });

  it("prints subtotal, promo discount and total, then says the price is final only after approval", () => {
    expect(teks).toMatch(/Subtotal: Rp.550\.000/);
    expect(teks).toMatch(/Potongan promo: -Rp.25\.000/);
    expect(teks).toMatch(/Total: Rp.525\.000/);
    expect(teks).toContain("Harga final setelah disetujui kantor.");
  });

  it("keeps the salesman's note but drops the system bonus-shortage line", () => {
    expect(teks).toContain("Catatan: Kirim sebelum Jumat");
    expect(teks).not.toContain("[Bonus] Kurang");
  });

  it("signs off with the salesman's name", () => {
    expect(teks.trimEnd().endsWith("Budi")).toBe(true);
  });

  it("an approved order says so and drops the 'final after approval' sentence", () => {
    const disetujui = pesanPesananWa({ ...dasar, status: "APPROVED" });
    expect(disetujui).toContain("Status: disetujui");
    expect(disetujui).not.toContain("Harga final setelah disetujui kantor.");
  });

  it("omits the discount line when there is none", () => {
    expect(pesanPesananWa({ ...dasar, potongan: 0 })).not.toContain("Potongan");
  });

  it("names a pre-order window", () => {
    expect(pesanPesananWa({ ...dasar, inden: { nama: "Lebaran 2027" } })).toContain("Pre-order: Lebaran 2027");
  });
});

describe("pesanPesananWa — KONSI never carries a price", () => {
  const konsi: BahanPesanPesanan = {
    ...dasar,
    orderNo: "KONSI/2026/0007",
    orderType: "KONSI",
    // Sengaja diisi: pembangun harus membuangnya sendiri, bukan bergantung pada pemanggil.
    baris: [
      { nama: "Kaos Polos — Hitam / L", varian: "Hitam / L", qty: 6, bonus: false, hargaSatuan: 50000, total: 300000 },
      { nama: "Kemeja Flanel", varian: null, qty: 2, bonus: false, hargaSatuan: 125000, total: 250000 },
    ],
    subtotal: 550000,
    potongan: 25000,
    total: 525000,
    catatan: "Titip di rak depan",
  };
  const teks = pesanPesananWa(konsi);

  it("has no Rp, no price, no total anywhere in the real text", () => {
    expect(teks).not.toMatch(/Rp/i);
    expect(teks).not.toContain("50.000");
    expect(teks).not.toContain("300.000");
    expect(teks).not.toContain("525.000");
    expect(teks).not.toMatch(/subtotal|total|potongan|harga/i);
  });

  it("still lists every line and the piece count", () => {
    expect(teks).toContain("1. Kaos Polos — Hitam / L × 6");
    expect(teks).toContain("2. Kemeja Flanel × 2");
    expect(teks).toContain("Jumlah: 8 pcs");
    expect(teks).toContain("Catatan: Titip di rak depan");
  });
});

describe("pesanPesananWa — defensive shapes", () => {
  it("appends a variant that the name does not already carry", () => {
    const teks = pesanPesananWa({ ...dasar, baris: [{ nama: "Kaos", varian: "M", qty: 3, bonus: false, hargaSatuan: 1000, total: 3000 }] });
    expect(teks).toContain("1. Kaos — M × 3");
  });

  it("works without a note or a salesman name", () => {
    const teks = pesanPesananWa({ ...dasar, catatan: null, salesman: null });
    expect(teks).not.toContain("Catatan:");
    expect(teks).toContain("Terima kasih");
  });
});
