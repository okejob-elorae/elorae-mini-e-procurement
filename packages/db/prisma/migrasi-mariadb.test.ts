import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * Penjaga statis: rantai migrasi MariaDB (`prisma/migrations/`) harus
 * membangun ulang `schema.prisma` persis — setiap tabel, kolom, indeks, tipe,
 * NULL/NOT NULL, dan nilai ENUM.
 *
 * Kenapa ada: cabang ini berjalan di PostgreSQL, jadi kolom yang hanya diberi
 * migrasi Postgres lolos semua tes lokal lalu meledak di produksi (MariaDB)
 * sebagai "Unknown column". Tidak butuh basis data — hanya membaca berkas.
 */

const ROOT = __dirname;
const SKEMA = readFileSync(path.join(ROOT, "schema.prisma"), "utf8");
const DIR_MIGRASI = path.join(ROOT, "migrations");

type Kolom = { tipe: string; baris: string; opsional: boolean; unik: boolean };
type Model = { tabel: string; kolom: Map<string, Kolom>; atribut: string[]; petaField: Map<string, string> };

function buangKomentar(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

function bacaSkema(): { model: Map<string, Model>; enumNilai: Map<string, string[]> } {
  const bersih = buangKomentar(SKEMA);
  const blok = [...bersih.matchAll(/^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const namaModel = new Set(blok.filter((b) => b[1] === "model").map((b) => b[2]));
  const enumNilai = new Map<string, string[]>();
  const model = new Map<string, Model>();
  for (const [, jenis, nama, isi] of blok) {
    const baris = isi.split("\n").map((l) => l.trim()).filter(Boolean);
    if (jenis === "enum") {
      enumNilai.set(nama, baris.filter((l) => !l.startsWith("@@")).map((l) => l.split(/\s+/)[0]));
      continue;
    }
    const peta = isi.match(/@@map\("([^"]+)"\)/);
    const m: Model = { tabel: peta ? peta[1] : nama, kolom: new Map(), atribut: [], petaField: new Map() };
    for (const l of baris) {
      if (l.startsWith("@@")) {
        m.atribut.push(l);
        continue;
      }
      const [field, tipeMentah] = l.split(/\s+/);
      if (!tipeMentah) continue;
      const tipe = tipeMentah.replace(/\[\]$/, "").replace(/\?$/, "");
      if (namaModel.has(tipe)) continue;
      const map = l.match(/@map\("([^"]+)"\)/);
      const kolom = map ? map[1] : field;
      m.petaField.set(field, kolom);
      m.kolom.set(kolom, { tipe, baris: l, opsional: tipeMentah.endsWith("?"), unik: /@unique\b/.test(l) });
    }
    model.set(nama, m);
  }
  return { model, enumNilai };
}

function pecahPernyataan(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pisah pada koma tingkat teratas (koma di dalam ENUM(...)/DECIMAL(...) diabaikan).
function pecahKoma(isi: string): string[] {
  const hasil: string[] = [];
  let dalam = 0;
  let kini = "";
  for (const ch of isi) {
    if (ch === "(") dalam++;
    if (ch === ")") dalam--;
    if (ch === "," && dalam === 0) {
      hasil.push(kini);
      kini = "";
    } else kini += ch;
  }
  hasil.push(kini);
  return hasil.map((s) => s.trim()).filter(Boolean);
}

type Keadaan = { tabel: Map<string, Map<string, string>>; indeks: Map<string, Set<string>>; takTerbaca: string[] };

function putarMigrasi(): Keadaan {
  const tabel = new Map<string, Map<string, string>>();
  const indeks = new Map<string, Set<string>>();
  const takTerbaca: string[] = [];
  const kolomDari = (t: string) => {
    if (!tabel.has(t)) tabel.set(t, new Map());
    if (!indeks.has(t)) indeks.set(t, new Set());
    return tabel.get(t)!;
  };
  const indeksDari = (t: string) => {
    kolomDari(t);
    return indeks.get(t)!;
  };
  const folder = readdirSync(DIR_MIGRASI).filter((d) => existsSync(path.join(DIR_MIGRASI, d, "migration.sql"))).sort();
  for (const d of folder) {
    for (const s of pecahPernyataan(readFileSync(path.join(DIR_MIGRASI, d, "migration.sql"), "utf8"))) {
      let m = s.match(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*)\)[^()]*$/i);
      if (m) {
        const k = kolomDari(m[1]);
        for (const def of pecahKoma(m[2])) {
          const c = def.match(/^`(\w+)`\s+([\s\S]*)$/);
          if (c) k.set(c[1], c[2]);
          const i = def.match(/^(?:UNIQUE\s+)?(?:INDEX|KEY)\s+`(\w+)`/i);
          if (i) indeksDari(m[1]).add(i[1]);
        }
        continue;
      }
      m = s.match(/^ALTER TABLE\s+`?(\w+)`?\s+([\s\S]*)$/i);
      if (m) {
        let t = m[1];
        for (const cl of pecahKoma(m[2])) {
          const k = kolomDari(t);
          let a: RegExpMatchArray | null;
          if (/^ADD\s+(UNIQUE\s+)?(INDEX|KEY)\b/i.test(cl)) {
            a = cl.match(/^ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)\s+(?:IF NOT EXISTS\s+)?`(\w+)`/i);
            if (a) indeksDari(t).add(a[1]);
            else takTerbaca.push(`${d}: ${cl.slice(0, 80)}`);
            continue;
          }
          if (/^ADD\s+(CONSTRAINT|PRIMARY|FOREIGN)\b/i.test(cl)) continue;
          if ((a = cl.match(/^ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?`(\w+)`\s+([\s\S]*)$/i))) {
            k.set(a[1], a[2]);
            continue;
          }
          if ((a = cl.match(/^MODIFY\s+(?:COLUMN\s+)?(?:IF EXISTS\s+)?`(\w+)`\s+([\s\S]*)$/i))) {
            k.set(a[1], a[2]);
            continue;
          }
          if ((a = cl.match(/^CHANGE\s+(?:COLUMN\s+)?`(\w+)`\s+`(\w+)`\s+([\s\S]*)$/i))) {
            k.delete(a[1]);
            k.set(a[2], a[3]);
            continue;
          }
          if ((a = cl.match(/^RENAME COLUMN\s+`(\w+)`\s+TO\s+`(\w+)`/i))) {
            const lama = k.get(a[1]);
            k.delete(a[1]);
            k.set(a[2], lama ?? "?");
            continue;
          }
          if ((a = cl.match(/^DROP\s+(?:INDEX|KEY)\s+(?:IF EXISTS\s+)?`(\w+)`/i))) {
            indeksDari(t).delete(a[1]);
            continue;
          }
          if (/^DROP\s+(FOREIGN|PRIMARY)\b/i.test(cl)) continue;
          if ((a = cl.match(/^DROP\s+(?:COLUMN\s+)?(?:IF EXISTS\s+)?`(\w+)`/i))) {
            k.delete(a[1]);
            continue;
          }
          if ((a = cl.match(/^RENAME\s+(?:INDEX|KEY)\s+`(\w+)`\s+TO\s+`(\w+)`/i))) {
            indeksDari(t).delete(a[1]);
            indeksDari(t).add(a[2]);
            continue;
          }
          if ((a = cl.match(/^RENAME\s+(?:TO\s+)?`(\w+)`/i))) {
            tabel.set(a[1], k);
            indeks.set(a[1], indeksDari(t));
            tabel.delete(t);
            indeks.delete(t);
            t = a[1];
            continue;
          }
          takTerbaca.push(`${d}: ${cl.slice(0, 80)}`);
        }
        continue;
      }
      m = s.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?`(\w+)`\s+ON\s+`(\w+)`/i);
      if (m) {
        indeksDari(m[2]).add(m[1]);
        continue;
      }
      m = s.match(/^DROP INDEX\s+(?:IF EXISTS\s+)?`(\w+)`\s+ON\s+`(\w+)`/i);
      if (m) {
        indeksDari(m[2]).delete(m[1]);
        continue;
      }
      m = s.match(/^DROP TABLE\s+(?:IF EXISTS\s+)?`(\w+)`/i);
      if (m) {
        tabel.delete(m[1]);
        indeks.delete(m[1]);
        continue;
      }
      m = s.match(/^RENAME TABLE\s+`(\w+)`\s+TO\s+`(\w+)`/i);
      if (m) {
        tabel.set(m[2], tabel.get(m[1]) ?? new Map());
        indeks.set(m[2], indeks.get(m[1]) ?? new Set());
        tabel.delete(m[1]);
        indeks.delete(m[1]);
        continue;
      }
      // DML (INSERT/UPDATE/SELECT pra-periksa) tidak mengubah bentuk tabel.
    }
  }
  return { tabel, indeks, takTerbaca };
}

const { model: MODEL, enumNilai: ENUM } = bacaSkema();
const KEADAAN = putarMigrasi();

// Isi literal '...' dikosongkan supaya kata di dalamnya (mis. ENUM 'DEFAULTS_CHANGE') tidak terbaca sebagai SQL.
function tanpaLiteral(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
}

function pernyataanMigrasi(): { folder: string; sql: string }[] {
  return readdirSync(DIR_MIGRASI)
    .filter((d) => existsSync(path.join(DIR_MIGRASI, d, "migration.sql")))
    .sort()
    .flatMap((d) =>
      pecahPernyataan(readFileSync(path.join(DIR_MIGRASI, d, "migration.sql"), "utf8")).map((sql) => ({ folder: d, sql })),
    );
}

// Kolom NOT NULL tanpa DEFAULT dari fase awal, ditambahkan sebelum tabelnya berisi data.
// Jangan menambah daftar ini: kolom baru di tabel yang sudah berisi butuh DEFAULT atau NULL.
const NOT_NULL_TANPA_DEFAULT_LAMA = new Set([
  "20260210070620_phase4_schema_updates VendorReturn.createdById",
  "20260210070620_phase4_schema_updates VendorReturn.totalValue",
  "20260210070620_phase4_schema_updates WorkOrder.finishedGoodId",
]);

// Tanda SQL yang tersalin dari migrasi Postgres dan gagal (atau berarti lain) di MariaDB.
const SINTAKS_POSTGRES: [string, RegExp][] = [
  ["identifier berkutip ganda", /"/],
  ["cast ::", /::/],
  ["gen_random_uuid()", /gen_random_uuid/i],
  ["TIMESTAMP(3)", /\bTIMESTAMP\(3\)/i],
  ["TIMESTAMPTZ", /\bTIMESTAMPTZ\b/i],
  ["SERIAL", /\b(BIG)?SERIAL\b/i],
  ["JSONB", /\bJSONB\b/i],
  ["BYTEA", /\bBYTEA\b/i],
  ["ILIKE", /\bILIKE\b/i],
  ["ON CONFLICT", /\bON\s+CONFLICT\b/i],
];

function bacaSql(p: string): string {
  return pecahPernyataan(readFileSync(p, "utf8")).join(";\n");
}

function kodeIzin(sql: string): string[] {
  return [...new Set([...sql.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((x) => x[1]))].sort();
}

// Peran yang ditautkan lewat `r.name = '...'` atau `r.name IN (...)` (Postgres tanpa backtick, MariaDB dengan).
function namaPeran(sql: string): string[] {
  const hasil = new Set<string>();
  for (const m of sql.matchAll(/\br\.`?name`?\s*(?:=\s*'([^']+)'|IN\s*\(([^)]*)\))/gi)) {
    if (m[1]) hasil.add(m[1]);
    for (const x of (m[2] ?? "").matchAll(/'([^']+)'/g)) hasil.add(x[1]);
  }
  return [...hasil].sort();
}

// Urutan tabel tujuan setiap INSERT — langkah turunan (mis. dari pemegang receivables:*) ikut terhitung.
function tabelInsert(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim().match(/^INSERT\s+(?:IGNORE\s+)?INTO\s+[`"]?(\w+)[`"]?/i)?.[1])
    .filter((x): x is string => Boolean(x));
}

function indeksDiharapkan(m: Model): string[] {
  const hasil: string[] = [];
  for (const a of m.atribut) {
    const x = a.match(/^@@(index|unique)\(\s*(?:fields:\s*)?\[([^\]]*)\]([\s\S]*)\)$/);
    if (!x) continue;
    const kolom = x[2]
      .split(",")
      .map((f) => f.trim().replace(/\(.*$/, ""))
      .filter(Boolean)
      .map((f) => m.petaField.get(f) ?? f);
    const map = x[3].match(/map:\s*"([^"]+)"/);
    hasil.push(map ? map[1] : `${m.tabel}_${kolom.join("_")}_${x[1] === "index" ? "idx" : "key"}`);
  }
  for (const [kolom, info] of m.kolom) {
    if (!info.unik) continue;
    const map = info.baris.match(/@unique\(map:\s*"([^"]+)"/);
    hasil.push(map ? map[1] : `${m.tabel}_${kolom}_key`);
  }
  return hasil;
}

const TIPE_SQL: Record<string, string[]> = {
  String: ["VARCHAR", "TEXT", "MEDIUMTEXT", "LONGTEXT", "CHAR"],
  Int: ["INT", "INTEGER"],
  BigInt: ["BIGINT"],
  Float: ["DOUBLE", "FLOAT"],
  Decimal: ["DECIMAL"],
  Boolean: ["BOOLEAN", "TINYINT", "BOOL"],
  DateTime: ["DATETIME", "TIMESTAMP", "DATE"],
  Json: ["JSON", "LONGTEXT"],
  Bytes: ["LONGBLOB", "BLOB", "MEDIUMBLOB"],
};

// Satu keluhan per kolom yang tipe/NULL-nya tidak sama dengan yang dibuat Prisma untuk MySQL.
function bedaTipe(kolom: Kolom, def: string): string | null {
  const d = def.trim().toUpperCase();
  const tipeSql = d.split(/\s+/)[0];
  const rapat = d.replace(/\s+/g, "");
  if (ENUM.has(kolom.tipe)) {
    if (!tipeSql.startsWith("ENUM")) return `harus ENUM, tertulis ${def.slice(0, 40)}`;
  } else if (TIPE_SQL[kolom.tipe]) {
    if (!TIPE_SQL[kolom.tipe].some((x) => tipeSql.startsWith(x))) return `tipe ${kolom.tipe} vs ${tipeSql}`;
    const db = kolom.baris.match(/@db\.(\w+)(?:\(([^)]*)\))?/);
    if (db) {
      const anot = db[1].toUpperCase();
      const arg = (db[2] ?? "").replace(/\s+/g, "");
      if (anot === "DECIMAL" && !rapat.startsWith(`DECIMAL(${arg})`)) return `@db.Decimal(${arg}) vs ${def.slice(0, 30)}`;
      if (["TEXT", "MEDIUMTEXT", "LONGTEXT", "LONGBLOB"].includes(anot) && tipeSql !== anot) return `@db.${db[1]} vs ${tipeSql}`;
      if (anot === "VARCHAR" && !rapat.startsWith(`VARCHAR(${arg})`)) return `@db.VarChar(${arg}) vs ${def.slice(0, 30)}`;
      if (anot === "DATE" && tipeSql !== "DATE") return `@db.Date vs ${tipeSql}`;
    } else if (kolom.tipe === "String" && !tipeSql.startsWith("VARCHAR(191)")) {
      return `String tanpa @db harus VARCHAR(191), tertulis ${tipeSql}`;
    }
  }
  const notNull = /NOT NULL/.test(d);
  if (kolom.opsional && notNull) return "skema opsional tapi DB NOT NULL";
  if (!kolom.opsional && !notNull && !/PRIMARY/.test(d)) return "skema wajib tapi DB boleh NULL";
  return null;
}

describe("migrasi MariaDB membangun ulang schema.prisma", () => {
  it("pemeriksa benar-benar membaca skema dan migrasi (bukan lulus karena kosong)", () => {
    expect(MODEL.size).toBeGreaterThan(150);
    expect(KEADAAN.tabel.size).toBeGreaterThan(150);
    expect(MODEL.get("PaymentClaim")?.kolom.has("receivedAmount")).toBe(true);
    expect(KEADAAN.tabel.get("PaymentClaim")?.get("receivedAmount")).toMatch(/^DECIMAL\(15, 2\)/);
  });

  it("setiap klausa ALTER terbaca oleh pemeriksa", () => {
    expect(KEADAAN.takTerbaca).toEqual([]);
  });

  it("setiap tabel dan kolom ada", () => {
    const hilang: string[] = [];
    for (const m of MODEL.values()) {
      const kolom = KEADAAN.tabel.get(m.tabel);
      if (!kolom) {
        hilang.push(`tabel ${m.tabel}`);
        continue;
      }
      for (const k of m.kolom.keys()) if (!kolom.has(k)) hilang.push(`${m.tabel}.${k}`);
    }
    expect(hilang).toEqual([]);
  });

  it("tidak ada kolom basis data yang tidak dikenal skema", () => {
    const lebih: string[] = [];
    for (const m of MODEL.values()) {
      for (const k of KEADAAN.tabel.get(m.tabel)?.keys() ?? []) if (!m.kolom.has(k)) lebih.push(`${m.tabel}.${k}`);
    }
    expect(lebih).toEqual([]);
  });

  it("setiap indeks dan kunci unik ada dengan nama yang dibuat Prisma", () => {
    const hilang: string[] = [];
    for (const m of MODEL.values()) {
      const ada = KEADAAN.indeks.get(m.tabel) ?? new Set<string>();
      for (const n of indeksDiharapkan(m)) if (!ada.has(n) && !ada.has(n.slice(0, 64))) hilang.push(`${m.tabel}: ${n}`);
    }
    expect(hilang).toEqual([]);
  });

  it("tipe dan NULL/NOT NULL setiap kolom sama dengan skema", () => {
    const beda: string[] = [];
    for (const m of MODEL.values()) {
      const kolom = KEADAAN.tabel.get(m.tabel);
      if (!kolom) continue;
      for (const [k, info] of m.kolom) {
        const def = kolom.get(k);
        if (def === undefined) continue;
        const salah = bedaTipe(info, def);
        if (salah) beda.push(`${m.tabel}.${k}: ${salah}`);
      }
    }
    expect(beda).toEqual([]);
  });

  it("nilai ENUM sama dengan skema", () => {
    const beda: string[] = [];
    for (const m of MODEL.values()) {
      const kolom = KEADAAN.tabel.get(m.tabel);
      if (!kolom) continue;
      for (const [k, info] of m.kolom) {
        const nilai = ENUM.get(info.tipe);
        const def = kolom.get(k);
        if (!nilai || def === undefined) continue;
        const e = def.match(/ENUM\(([\s\S]*?)\)/i);
        const ada = e ? [...e[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
        const kurang = nilai.filter((v) => !ada.includes(v));
        const lebih = ada.filter((v) => !nilai.includes(v));
        if (kurang.length || lebih.length) beda.push(`${m.tabel}.${k}: kurang ${kurang.join(",")} lebih ${lebih.join(",")}`);
      }
    }
    expect(beda).toEqual([]);
  });

  it("kolom ber-@default di skema punya DEFAULT di MariaDB", () => {
    // Default yang dibuat Prisma di sisi aplikasi (cuid/uuid/...) dan Json tidak punya DEFAULT SQL.
    const hilang: string[] = [];
    for (const m of MODEL.values()) {
      const kolom = KEADAAN.tabel.get(m.tabel);
      if (!kolom) continue;
      for (const [k, info] of m.kolom) {
        const d = info.baris.match(/@default\(([\s\S]*)/);
        const def = kolom.get(k);
        if (!d || def === undefined || info.tipe === "Json") continue;
        if (/^(cuid|uuid|nanoid|ulid|autoincrement)\(/.test(d[1])) continue;
        if (!/\bDEFAULT\b/i.test(tanpaLiteral(def))) hilang.push(`${m.tabel}.${k}: ${def.slice(0, 40)}`);
      }
    }
    expect(hilang).toEqual([]);
  });

  it("ADD COLUMN NOT NULL selalu membawa DEFAULT (tabel lama sudah berisi data)", () => {
    const salah: string[] = [];
    for (const { folder, sql } of pernyataanMigrasi()) {
      const m = sql.match(/^ALTER TABLE\s+`?(\w+)`?\s+([\s\S]*)$/i);
      if (!m) continue;
      for (const cl of pecahKoma(m[2])) {
        const a = cl.match(/^ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?`(\w+)`\s+([\s\S]*)$/i);
        if (!a) continue;
        const def = tanpaLiteral(a[2]);
        if (!/\bNOT NULL\b/i.test(def) || /\bDEFAULT\b/i.test(def)) continue;
        const kunci = `${folder} ${m[1]}.${a[1]}`;
        if (!NOT_NULL_TANPA_DEFAULT_LAMA.has(kunci)) salah.push(kunci);
      }
    }
    expect(salah).toEqual([]);
  });

  it("migrasi dan SQL tangan MariaDB tidak memakai sintaks PostgreSQL", () => {
    const berkas = [
      ...readdirSync(DIR_MIGRASI)
        .filter((d) => existsSync(path.join(DIR_MIGRASI, d, "migration.sql")))
        .map((d) => path.join(DIR_MIGRASI, d, "migration.sql")),
      ...readdirSync(ROOT)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => path.join(ROOT, f)),
    ];
    expect(berkas.length).toBeGreaterThan(100);
    const salah: string[] = [];
    for (const p of berkas) {
      const sql = tanpaLiteral(pecahPernyataan(readFileSync(p, "utf8")).join(";\n"));
      for (const [nama, pola] of SINTAKS_POSTGRES) if (pola.test(sql)) salah.push(`${path.relative(ROOT, p)}: ${nama}`);
    }
    expect(salah).toEqual([]);
  });
});

describe("seed izin MariaDB", () => {
  const DIR_PG = path.join(ROOT, "postgres");
  const seedPg = readdirSync(DIR_PG).filter((f) => /^seed-.*-permissions\.sql$/.test(f));
  const seedMaria = readdirSync(ROOT).filter((f) => /^seed-.*\.sql$/.test(f));

  it("setiap seed izin Postgres punya kembaran MariaDB dengan izin, peran dan langkah yang sama", () => {
    expect(seedPg.length).toBeGreaterThanOrEqual(4);
    for (const f of seedPg) {
      expect(seedMaria, `seed MariaDB ${f} belum ada`).toContain(f);
      const pg = bacaSql(path.join(DIR_PG, f));
      const maria = bacaSql(path.join(ROOT, f));
      expect(kodeIzin(maria), f).toEqual(kodeIzin(pg));
      expect(kodeIzin(maria).length, f).toBeGreaterThan(0);
      expect(namaPeran(maria), f).toEqual(namaPeran(pg));
      expect(tabelInsert(maria), f).toEqual(tabelInsert(pg));
    }
  });

  it("setiap INSERT di seed MariaDB idempoten", () => {
    const salah: string[] = [];
    for (const f of seedMaria) {
      for (const s of pecahPernyataan(readFileSync(path.join(ROOT, f), "utf8"))) {
        if (!/^INSERT\b/i.test(s)) continue;
        if (!/\bNOT EXISTS\b|^INSERT\s+IGNORE\b|\bON DUPLICATE KEY\b/i.test(s)) salah.push(`${f}: ${s.slice(0, 60)}`);
      }
    }
    expect(salah).toEqual([]);
  });
});
