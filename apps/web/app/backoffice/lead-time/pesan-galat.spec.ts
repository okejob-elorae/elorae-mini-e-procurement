import { describe, expect, it } from "vitest";
import { processTemplateSchema } from "@/lib/validations/lead-time";
import { galatTakTerduga, namaKembar, pesanGalatLeadTime, PESAN_SESI_HABIS, PESAN_TANPA_IZIN } from "./pesan-galat";

const galatZod = (data: unknown) => {
  const hasil = processTemplateSchema.safeParse(data);
  if (hasil.success) throw new Error("seharusnya gagal");
  return hasil.error;
};

describe("pesanGalatLeadTime", () => {
  it("isian zod → kalimat per kolom, bukan JSON isu", () => {
    expect(pesanGalatLeadTime(galatZod({ name: "", leadTimeType: "FIXED", days: 1 }), "x")).toBe(
      "Nama wajib diisi, paling panjang 100 huruf.",
    );
    expect(pesanGalatLeadTime(galatZod({ name: "Jahit", leadTimeType: "PER_QTY", days: 3 }), "x")).toBe(
      "Per berapa pcs wajib diisi untuk proses per jumlah, paling sedikit 1.",
    );
    expect(pesanGalatLeadTime(galatZod({ name: "Jahit", leadTimeType: "FIXED", days: 0 }), "x")).toBe(
      "Lama harus bilangan bulat, paling sedikit 1 hari.",
    );
  });

  it("izin dan sesi punya kalimat sendiri; galat lain memakai cadangan", () => {
    const tanpaIzin = Object.assign(new Error("Forbidden: Insufficient permissions"), { status: 403 });
    expect(pesanGalatLeadTime(tanpaIzin, "cadangan")).toBe(PESAN_TANPA_IZIN);
    expect(pesanGalatLeadTime(new Error("Unauthorized"), "cadangan")).toBe(PESAN_SESI_HABIS);
    expect(pesanGalatLeadTime(new Error("Invalid `prisma.x.update()` invocation"), "cadangan")).toBe("cadangan");
    expect(pesanGalatLeadTime("bukan galat", "cadangan")).toBe("cadangan");
  });

  it("hanya galat tak terduga yang dicatat di log", () => {
    expect(galatTakTerduga(galatZod({}))).toBe(false);
    expect(galatTakTerduga(Object.assign(new Error("x"), { status: 403 }))).toBe(false);
    expect(galatTakTerduga(new Error("Unauthorized"))).toBe(false);
    expect(galatTakTerduga(new Error("koneksi putus"))).toBe(true);
  });
});

describe("namaKembar", () => {
  it("unik basis data → ya; nama kosong (zod, path name) → tidak", () => {
    expect(namaKembar(Object.assign(new Error("x"), { code: "P2002" }))).toBe(true);
    expect(namaKembar(new Error("Unique constraint failed on the fields: (`name`)"))).toBe(true);
    expect(namaKembar(new Error("Duplicate entry 'Jahit' for key 'ProcessTemplate_name_key'"))).toBe(true);
    expect(namaKembar(galatZod({ name: "", leadTimeType: "FIXED", days: 1 }))).toBe(false);
    expect(namaKembar(new Error("column name does not exist"))).toBe(false);
  });
});
