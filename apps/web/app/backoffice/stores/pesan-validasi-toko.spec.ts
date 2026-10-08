import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pesanValidasiToko } from "./pesan-validasi-toko";

const skema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(191),
  address: z.string().min(1),
  paymentTempo: z.number().int().min(0).max(365),
  termsType: z.enum(["PUTUS", "KONSI"]),
  lat: z.number().min(-90).max(90).nullable(),
});

const sah = { code: "TK-1", name: "Toko", address: "Jl. A", paymentTempo: 30, termsType: "PUTUS", lat: null };

function pesan(isian: Record<string, unknown>): string {
  const r = skema.safeParse({ ...sah, ...isian });
  if (r.success) throw new Error("expected a validation failure");
  return pesanValidasiToko(r.error.issues);
}

describe("pesanValidasiToko", () => {
  it("names the field and says it is required for an empty text", () => {
    expect(pesan({ code: "" })).toBe("Kode toko wajib diisi.");
    expect(pesan({ address: "" })).toBe("Alamat wajib diisi.");
  });

  it("states the limit for too-long text and out-of-range numbers, in Indonesian number format", () => {
    expect(pesan({ name: "x".repeat(200) })).toBe("Nama toko terlalu panjang (maksimal 191 karakter).");
    expect(pesan({ paymentTempo: 400 })).toBe("Tempo bayar tidak boleh lebih dari 365.");
    expect(pesan({ paymentTempo: -1 })).toBe("Tempo bayar tidak boleh kurang dari 0.");
    expect(pesan({ lat: 120 })).toBe("Latitude tidak boleh lebih dari 90.");
  });

  it("asks for a whole number when an integer field gets a fraction", () => {
    expect(pesan({ paymentTempo: 7.5 })).toBe("Tempo bayar harus bilangan bulat.");
  });

  it("falls back to a generic sentence, never the raw zod text", () => {
    const m = pesan({ termsType: "X" });
    expect(m).toBe("Sistem toko tidak sah. Periksa kembali isiannya.");
    expect(pesanValidasiToko([])).toBe("Isian toko tidak sah. Periksa kembali formulir.");
    expect(pesanValidasiToko([{ code: "custom", path: ["tidakDikenal"] }])).toBe(
      "Isian toko tidak sah. Periksa kembali isiannya.",
    );
  });

  it("formats large limits with Indonesian thousand separators", () => {
    const r = z.object({ creditLimit: z.number().max(9_999_999_999_999) }).safeParse({ creditLimit: 1e14 });
    if (r.success) throw new Error("expected a validation failure");
    expect(pesanValidasiToko(r.error.issues)).toBe("Batas kredit tidak boleh lebih dari 9.999.999.999.999.");
  });
});
