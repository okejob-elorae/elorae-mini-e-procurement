import { afterEach, describe, expect, it, vi } from "vitest";
import { isPostgresUrl } from "@elorae/db";
import { cariTeks, dialekPostgres, samaTeks } from "./cari-teks";

/**
 * Prisma hanya mengenal opsi abai-huruf di PostgreSQL. Klien MariaDB tidak
 * punya field itu sama sekali, jadi mengirimnya ke sana = "Unknown argument"
 * pada setiap pencarian — padahal collation utf8mb4 *_ci MariaDB sudah abai
 * huruf dengan sendirinya. Helper ini harus memilih per dialek.
 */

const PG = "postgresql://u:p@127.0.0.1:55432/elorae";
const PG_PENDEK = "postgres://u:p@db.example.com:5432/elorae";
const MYSQL = "mysql://u:p@127.0.0.1:3306/elorae";
const MARIADB = "mariadb://u:p@db:3306/elorae";
// Nilai enum QueryMode Prisma; ditulis lewat konstanta agar penjaga sumber
// (cari-teks.penjaga.test.ts) tidak perlu mengecualikan berkas ini.
const ABAI_HURUF = "insensitive";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cariTeks", () => {
  it("menambahkan opsi abai-huruf bila DATABASE_URL PostgreSQL", () => {
    vi.stubEnv("DATABASE_URL", PG);
    expect(cariTeks("Lime")).toEqual({ contains: "Lime", mode: ABAI_HURUF });

    vi.stubEnv("DATABASE_URL", PG_PENDEK);
    expect(cariTeks("Lime")).toEqual({ contains: "Lime", mode: ABAI_HURUF });
  });

  it("hanya contains biasa bila DATABASE_URL MySQL/MariaDB — tanpa kunci mode sama sekali", () => {
    for (const url of [MYSQL, MARIADB]) {
      vi.stubEnv("DATABASE_URL", url);
      const hasil = cariTeks("Lime");
      expect(hasil).toEqual({ contains: "Lime" });
      expect(Object.keys(hasil)).toEqual(["contains"]);
    }
  });

  it("DATABASE_URL kosong jatuh ke MySQL, sama seperti prisma.config.ts memilih schema.prisma", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(cariTeks("x")).toEqual({ contains: "x" });
  });

  it("dibaca per panggilan, bukan saat modul dimuat (dotenv bisa mengisi belakangan)", () => {
    vi.stubEnv("DATABASE_URL", MYSQL);
    expect(cariTeks("a")).toEqual({ contains: "a" });
    vi.stubEnv("DATABASE_URL", PG);
    expect(cariTeks("a")).toEqual({ contains: "a", mode: ABAI_HURUF });
  });

  it("tidak mengubah teks pencarian (pemanggil yang memangkas)", () => {
    vi.stubEnv("DATABASE_URL", MYSQL);
    expect(cariTeks("  Ab ")).toEqual({ contains: "  Ab " });
  });
});

describe("samaTeks", () => {
  it("equals abai-huruf di PostgreSQL", () => {
    vi.stubEnv("DATABASE_URL", PG);
    expect(samaTeks("27000038P")).toEqual({ equals: "27000038P", mode: ABAI_HURUF });
  });

  it("equals biasa di MySQL/MariaDB", () => {
    vi.stubEnv("DATABASE_URL", MARIADB);
    const hasil = samaTeks("27000038P");
    expect(hasil).toEqual({ equals: "27000038P" });
    expect(Object.keys(hasil)).toEqual(["equals"]);
  });
});

describe("dialekPostgres", () => {
  it("memutus persis sama dengan isPostgresUrl milik @elorae/db (yang memilih adaptor)", () => {
    const contoh = [
      PG,
      PG_PENDEK,
      "  postgresql://u:p@h/db",
      "POSTGRESQL://u:p@h/db",
      "Postgres://u:p@h/db",
      MYSQL,
      MARIADB,
      "mysql://u:p@h/db?sslaccept=strict",
      "",
      "postgresqlx://u:p@h/db",
      "file:./dev.db",
    ];
    for (const url of contoh) {
      expect(dialekPostgres(url), url).toBe(isPostgresUrl(url));
    }
  });

  it("tanpa argumen membaca DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", PG);
    expect(dialekPostgres()).toBe(true);
    vi.stubEnv("DATABASE_URL", MYSQL);
    expect(dialekPostgres()).toBe(false);
  });
});
