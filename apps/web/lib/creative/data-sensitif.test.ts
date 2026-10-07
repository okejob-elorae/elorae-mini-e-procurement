import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DataSensitifRusak,
  dataPajakLengkap,
  dekripsi,
  empatTerakhir,
  enkripsi,
  KunciEnkripsiTidakAda,
  konteksKol,
  kunciTersedia,
  rapikanSensitif,
} from "./data-sensitif";

/* Kunci uji — bukan kunci sungguhan; dipasang dan dipulihkan per tes. */
const KUNCI_UJI = "kunci-uji-kol-sensitif-32-karakter";
let asli: string | undefined;

beforeEach(() => {
  asli = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KUNCI_UJI;
});
afterEach(() => {
  if (asli === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = asli;
});

describe("enkripsi/dekripsi AES-256-GCM", () => {
  it("bolak-balik, tidak memuat teks asli, dan setiap enkripsi berbeda (IV acak)", () => {
    const k = konteksKol("kol1", "nik");
    const a = enkripsi("3174012345678901", k);
    const b = enkripsi("3174012345678901", k);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("3174012345678901");
    expect(a).not.toBe(b);
    expect(dekripsi(a, k)).toBe("3174012345678901");
    expect(dekripsi(b, k)).toBe("3174012345678901");
  });

  it("isi yang diubah satu bit ditolak", () => {
    const k = konteksKol("kol1", "bankAccount");
    const a = enkripsi("1234567890", k);
    const buf = Buffer.from(a.slice(3), "base64url");
    buf[buf.length - 1] ^= 1;
    expect(() => dekripsi(`v1:${buf.toString("base64url")}`, k)).toThrow(DataSensitifRusak);
    const tag = Buffer.from(a.slice(3), "base64url");
    tag[13] ^= 1;
    expect(() => dekripsi(`v1:${tag.toString("base64url")}`, k)).toThrow(DataSensitifRusak);
  });

  it("isi yang dipindah ke baris atau kolom lain ditolak (AAD)", () => {
    const a = enkripsi("1234567890", konteksKol("kol1", "bankAccount"));
    expect(() => dekripsi(a, konteksKol("kol2", "bankAccount"))).toThrow(DataSensitifRusak);
    expect(() => dekripsi(a, konteksKol("kol1", "nik"))).toThrow(DataSensitifRusak);
  });

  it("bentuk asing dan versi lain ditolak", () => {
    expect(() => dekripsi("1234567890", "x")).toThrow(DataSensitifRusak);
    expect(() => dekripsi("v2:abcd", "x")).toThrow(DataSensitifRusak);
    expect(() => dekripsi("v1:pendek", "x")).toThrow(DataSensitifRusak);
  });

  it("kunci server berbeda tidak bisa membuka", () => {
    const a = enkripsi("rahasia", "x");
    process.env.ENCRYPTION_KEY = "kunci-lain-yang-cukup-panjang-12345";
    expect(() => dekripsi(a, "x")).toThrow(DataSensitifRusak);
  });

  it("kunci tidak ada atau terlalu pendek → menolak dengan jelas, tidak pernah mengembalikan teks asli", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(kunciTersedia()).toBe(false);
    expect(() => enkripsi("3174012345678901", "x")).toThrow(KunciEnkripsiTidakAda);
    process.env.ENCRYPTION_KEY = "pendek";
    expect(kunciTersedia()).toBe(false);
    expect(() => enkripsi("3174012345678901", "x")).toThrow(KunciEnkripsiTidakAda);
    expect(() => dekripsi("v1:AAAA", "x")).toThrow(KunciEnkripsiTidakAda);
  });
});

describe("rapikan & lengkap", () => {
  it("NIK 16 digit, NPWP 15/16 digit, rekening 5–20 digit; tanda baca dibuang", () => {
    expect(rapikanSensitif("nik", "3174 0123 4567 8901")).toEqual({ ok: true, nilai: "3174012345678901" });
    expect(rapikanSensitif("nik", "12345")).toEqual({ ok: false, kode: "NIK_TIDAK_VALID" });
    expect(rapikanSensitif("npwp", "01.234.567.8-901.000")).toEqual({ ok: true, nilai: "012345678901000" });
    expect(rapikanSensitif("npwp", "abc")).toEqual({ ok: false, kode: "NPWP_TIDAK_VALID" });
    expect(rapikanSensitif("bankAccount", "123-456-7890")).toEqual({ ok: true, nilai: "1234567890" });
    expect(rapikanSensitif("bankAccount", "12a45")).toEqual({ ok: false, kode: "REKENING_TIDAK_VALID" });
    expect(rapikanSensitif("bankName", "  BCA ")).toEqual({ ok: true, nilai: "BCA" });
    expect(empatTerakhir("123-456-4821")).toBe("4821");
  });

  it("lengkap: rekening + identitas sesuai subjek", () => {
    const semua = { bankName: true, bankAccount: true, bankHolder: true, nik: true, npwp: false };
    expect(dataPajakLengkap("ORANG_PRIBADI", semua)).toBe(true);
    expect(dataPajakLengkap("BADAN", semua)).toBe(false);
    expect(dataPajakLengkap("BADAN", { ...semua, npwp: true })).toBe(true);
    expect(dataPajakLengkap("ORANG_PRIBADI", { ...semua, bankHolder: false })).toBe(false);
    expect(dataPajakLengkap("TIDAK_DIPOTONG", { ...semua, nik: false })).toBe(true);
  });
});
