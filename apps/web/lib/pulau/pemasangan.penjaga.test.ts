import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Penjaga pemasangan pulau status. Dua kapsul (atau satu kapsul plus tumpukan
 * toast bawaan sonner) berarti setiap pesan tampil dua kali di dua tempat;
 * pemantau sinyal yang terpasang dua kali saling menimpa keadaannya.
 */

const WEB = path.resolve(__dirname, "../..");

function semuaBerkas(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama.startsWith(".")) continue;
    const penuh = path.join(dir, nama);
    if (statSync(penuh).isDirectory()) hasil.push(...semuaBerkas(penuh));
    else if (/\.(tsx?|jsx?|mjs)$/.test(nama) && !/\.(test|spec)\.tsx?$/.test(nama)) hasil.push(penuh);
  }
  return hasil;
}

const BERKAS = ["app", "components", "lib"].flatMap((d) => semuaBerkas(path.join(WEB, d)));
const ISI = new Map(BERKAS.map((f) => [path.relative(WEB, f).split(path.sep).join("/"), readFileSync(f, "utf8")]));

/** Berkas yang memuat pola, beserta jumlah kemunculannya. */
function temukan(pola: RegExp): Record<string, number> {
  const hasil: Record<string, number> = {};
  for (const [f, isi] of ISI) {
    const n = isi.match(new RegExp(pola.source, pola.flags.includes("g") ? pola.flags : `${pola.flags}g`))?.length ?? 0;
    if (n > 0) hasil[f] = n;
  }
  return hasil;
}

describe("pemasangan pulau status", () => {
  it("kapsulnya dipasang tepat SEKALI, di app/layout.tsx", () => {
    expect(temukan(/<PulauStatus\b/)).toEqual({ "app/layout.tsx": 1 });
  });

  it("tidak ada <Toaster> lain — hanya jembatan toast di app/layout.tsx", () => {
    expect(temukan(/<Toaster\b/)).toEqual({ "app/layout.tsx": 1 });
  });

  it("tumpukan bawaan sonner tidak diimpor di mana pun; jembatannya membaca lewat useSonner", () => {
    expect(temukan(/import\s*\{[^}]*\bToaster\b[^}]*\}\s*from\s*["']sonner["']/)).toEqual({});
    expect(ISI.get("components/ui/sonner.tsx")).toMatch(/useSonner\(\)/);
  });

  it("pustaka gerak hanya dipakai pulau status", () => {
    const pemakai = Object.keys(temukan(/from\s*["'](motion\/react[^"']*|framer-motion)["']/));
    expect(pemakai.length).toBeGreaterThan(0);
    expect(pemakai.filter((f) => !f.startsWith("components/pulau/"))).toEqual([]);
  });

  it("setiap pemantau dipasang sekali di tempatnya", () => {
    expect(temukan(/<OfflineIndicator\b/)).toEqual({ "app/backoffice/BackofficeShell.tsx": 1 });
    expect(temukan(/<PemantauLuringHp\b/)).toEqual({ "app/pwa/layout.tsx": 1 });
    expect(temukan(/<PemantauKabarHp\b/)).toEqual({ "app/pwa/layout.tsx": 1 });
  });
});
