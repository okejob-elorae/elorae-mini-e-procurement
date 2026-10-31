import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * GRN tidak diputar ulang dari antrean luring: tabel GRN tidak punya kunci
 * idempotensi, jadi jawaban yang hilang lalu dikirim ulang menerima barang dua
 * kali (stok, harga rata-rata, status PO, jurnal hutang). Formulir GRN butuh
 * sinyal dan menyimpan isiannya sebagai draf. Rute ini menolak GRN dengan kode
 * yang jelas — bahkan untuk admin — supaya tidak ada yang menyambungkannya
 * diam-diam lewat jalur yang tidak memakai penjaga `createGRN`.
 */

const sesi = vi.hoisted(() => ({ permissions: ["*"] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-gudang", email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: async () => "Penguji",
  notifySupplierCreated: async () => {},
  notifyPOCreated: async () => {},
}));

const { POST } = await import("./route");

function kirim(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/sync", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const GRN = {
  type: "GRN_CREATE",
  payload: {
    poId: "po-77",
    supplierId: "sup-12",
    items: [{ itemId: "kain-katun", qty: 98.5, unitCost: 32500, uomId: "uom-m" }],
  },
};

describe("/api/sync — GRN butuh sinyal", () => {
  it("admin pun ditolak 400 dengan kode GRN_BUTUH_SINYAL", async () => {
    sesi.permissions = ["*"];
    const res = await kirim(GRN);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "GRN_BUTUH_SINYAL" });
  });

  it("tanpa izin inventori juga 400 berkode, bukan 403 — GRN memang tidak lewat sini", async () => {
    sesi.permissions = [];
    const res = await kirim(GRN);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "GRN_BUTUH_SINYAL" });
  });
});
