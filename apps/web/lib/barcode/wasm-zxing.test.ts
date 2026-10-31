import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";
import { jalurWasmZxing } from "./detektor";

/**
 * Berkas WASM di `public/` harus PERSIS milik versi pustaka yang terpasang.
 * Kode perekat JavaScript dan WASM-nya berpasangan: versi yang tidak cocok
 * gagal dimuat di HP, dan kegagalan itu baru terlihat saat SPG membuka
 * kamera. Perbaikannya: `node scripts/salin-zxing-wasm.mjs` dari apps/web.
 */
describe("WASM pembaca barcode yang disajikan sendiri", () => {
  const berkas = path.join(process.cwd(), "public", jalurWasmZxing(ZXING_WASM_VERSION));

  it("ada untuk versi zxing-wasm yang terpasang", () => {
    expect(existsSync(berkas), `${berkas} tidak ada — jalankan node scripts/salin-zxing-wasm.mjs`).toBe(true);
  });

  it("isinya sama persis dengan milik pustaka", () => {
    const hash = createHash("sha256").update(readFileSync(berkas)).digest("hex");
    expect(hash).toBe(ZXING_WASM_SHA256);
  });
});
