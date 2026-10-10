import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baca = (jalur) => readFileSync(new URL(`../${jalur}`, import.meta.url), "utf8");

describe("manifest", () => {
  test("setiap modul yang dimuat konten.js (beserta impor-impornya) ada di web_accessible_resources", () => {
    const manifest = JSON.parse(baca("manifest.json"));
    const boleh = new Set(manifest.web_accessible_resources.flatMap((w) => w.resources));
    // konten.js skrip klasik: modul dimuat dengan import(chrome.runtime.getURL("lib/x.js")).
    const antre = [...baca("konten.js").matchAll(/getURL\("([^"]+\.js)"\)/g)].map((m) => m[1]);
    assert.ok(antre.includes("lib/aturan.js"), "konten.js memuat lib/aturan.js untuk kiriman otomatis");
    const dilihat = new Set();
    while (antre.length) {
      const berkas = antre.shift();
      if (dilihat.has(berkas)) continue;
      dilihat.add(berkas);
      assert.ok(boleh.has(berkas), `${berkas} dimuat di halaman TikTok tetapi tidak ada di web_accessible_resources`);
      const folder = berkas.slice(0, berkas.lastIndexOf("/") + 1);
      for (const m of baca(berkas).matchAll(/^import\b[^;]*?from\s+"\.\/([^"]+)"/gm)) antre.push(folder + m[1]);
    }
  });

  test("versi berbentuk x.y.z", () => {
    assert.match(JSON.parse(baca("manifest.json")).version, /^\d+\.\d+\.\d+$/);
  });
});
