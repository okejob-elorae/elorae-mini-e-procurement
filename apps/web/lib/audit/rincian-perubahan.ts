/**
 * Turns `AuditLog.changes` into rows a person can read: one row per field,
 * with the value before and after, instead of a raw JSON dump.
 *
 * Writers store `{ before?, after? }` (see `lib/audit.ts`), but older rows and
 * a few writers use other shapes — a flat object, `{ field: { from, to } }`,
 * or a bare value — so every shape degrades to rows rather than to JSON.
 *
 * Pure: no React, no translator calls except through the `t` passed in.
 */
import { humanizeAuditCode, type AuditLabelTranslator } from "./action-label";

export type BarisPerubahan = {
  /** Field path; nested objects one level deep are joined with a dot. "" = the whole value. */
  kunci: string;
  sebelum: unknown;
  sesudah: unknown;
  adaSebelum: boolean;
  adaSesudah: boolean;
  /** Both sides present and different. */
  berubah: boolean;
};

export type NilaiTampil =
  | { jenis: "kosong" }
  | { jenis: "teks"; teks: string }
  | { jenis: "angka"; nilai: number }
  | { jenis: "yaTidak"; nilai: boolean }
  | { jenis: "tanggal"; teks: string; denganJam: boolean }
  | { jenis: "id"; teks: string }
  | { jenis: "daftar"; isi: string[] }
  | { jenis: "json"; teks: string };

const LOOKUP_SAFE = /^[A-Za-z0-9_]+$/;
const PASANGAN = [
  ["before", "after"],
  ["from", "to"],
  ["old", "new"],
] as const;

function objekBiasa(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `{ a: 1, b: { c: 2 } }` → `[["a", 1], ["b.c", 2]]` (one nesting level). */
function ratakan(obj: Record<string, unknown>): Array<[string, unknown]> {
  const hasil: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    if (objekBiasa(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => !objekBiasa(x))) {
      for (const [k2, v2] of Object.entries(v)) hasil.push([`${k}.${k2}`, v2]);
    } else {
      hasil.push([k, v]);
    }
  }
  return hasil;
}

function sama(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function baris(kunci: string, sebelum: unknown, sesudah: unknown, adaSebelum: boolean, adaSesudah: boolean): BarisPerubahan {
  return {
    kunci,
    sebelum,
    sesudah,
    adaSebelum,
    adaSesudah,
    berubah: adaSebelum && adaSesudah && !sama(sebelum, sesudah),
  };
}

/** Pairs a before-side and an after-side into rows, field by field. */
function pasangkan(sebelum: unknown, sesudah: unknown, adaSebelum: boolean, adaSesudah: boolean): BarisPerubahan[] {
  const kiriObjek = !adaSebelum || sebelum == null || objekBiasa(sebelum);
  const kananObjek = !adaSesudah || sesudah == null || objekBiasa(sesudah);
  if (!kiriObjek || !kananObjek) {
    return [baris("", sebelum, sesudah, adaSebelum, adaSesudah)];
  }
  const kiri = new Map(objekBiasa(sebelum) ? ratakan(sebelum) : []);
  const kanan = new Map(objekBiasa(sesudah) ? ratakan(sesudah) : []);
  const urutan = [...kiri.keys(), ...[...kanan.keys()].filter((k) => !kiri.has(k))];
  return urutan.map((k) => baris(k, kiri.get(k), kanan.get(k), kiri.has(k), kanan.has(k)));
}

/** Which before/after pair, if any, an object is written in. */
function pasanganDari(obj: Record<string, unknown>): readonly [string, string] | null {
  const kunci = Object.keys(obj);
  if (kunci.length === 0) return null;
  for (const p of PASANGAN) {
    if (kunci.every((k) => k === p[0] || k === p[1])) return p;
  }
  return null;
}

export function barisPerubahan(changes: unknown): BarisPerubahan[] {
  if (changes === null || changes === undefined) return [];
  if (!objekBiasa(changes)) return [baris("", undefined, changes, false, true)];

  const pasangan = pasanganDari(changes);
  if (pasangan) {
    const [kiri, kanan] = pasangan;
    return pasangkan(changes[kiri], changes[kanan], kiri in changes, kanan in changes);
  }

  // `{ field: { from, to } }` — every value is itself a before/after pair.
  const nilai = Object.values(changes);
  if (nilai.length > 0 && nilai.every((v) => objekBiasa(v) && pasanganDari(v))) {
    return Object.entries(changes).map(([k, v]) => {
      const o = v as Record<string, unknown>;
      const [kiri, kanan] = pasanganDari(o)!;
      return baris(k, o[kiri], o[kanan], kiri in o, kanan in o);
    });
  }

  // A flat object with no before side: everything is "after".
  return ratakan(changes).map(([k, v]) => baris(k, undefined, v, false, true));
}

const POLA_ID = /^(c[a-z0-9]{20,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const POLA_WAKTU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function nilaiTampil(v: unknown): NilaiTampil {
  if (v === null || v === undefined || v === "") return { jenis: "kosong" };
  if (typeof v === "boolean") return { jenis: "yaTidak", nilai: v };
  if (typeof v === "number") return Number.isFinite(v) ? { jenis: "angka", nilai: v } : { jenis: "teks", teks: String(v) };
  if (typeof v === "string") {
    if (POLA_WAKTU.test(v) && !Number.isNaN(Date.parse(v))) return { jenis: "tanggal", teks: v, denganJam: true };
    if (POLA_TANGGAL.test(v)) return { jenis: "tanggal", teks: v, denganJam: false };
    if (POLA_ID.test(v)) return { jenis: "id", teks: v };
    return { jenis: "teks", teks: v };
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return { jenis: "kosong" };
    if (v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))) {
      return { jenis: "daftar", isi: v.map((x) => String(x ?? "—")) };
    }
  }
  return { jenis: "json", teks: JSON.stringify(v) };
}

/**
 * Readable name of a field: `storeId` → "Toko", `after.invoiceNo` → "No. faktur".
 * Looks up `fields.<segment>` in the `auditActions` namespace, else humanises.
 */
export function labelKolomAudit(t: AuditLabelTranslator, kunci: string): string {
  if (!kunci) return t.has("fields.value") ? t("fields.value") : "Nilai";
  return kunci
    .split(".")
    .map((seg) => {
      const key = `fields.${seg}`;
      if (LOOKUP_SAFE.test(seg) && t.has(key)) return t(key);
      return humanizeAuditCode(seg);
    })
    .join(" › ");
}
