/**
 * Menyalin mesin pembaca barcode (WASM milik ZXing) ke `public/vendor/`, supaya
 * pemindai kamera memuatnya dari server kita sendiri, bukan dari CDN bawaan
 * pustaka `barcode-detector`.
 *
 * Jalankan ulang setiap kali `barcode-detector` diperbarui:
 *   node scripts/salin-zxing-wasm.mjs        (dari apps/web)
 * `lib/barcode/wasm-zxing.test.ts` gagal kalau berkasnya tertinggal versi.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// `zxing-wasm` bukan dependensi langsung apps/web — cari dari tempat
// `barcode-detector` memasangnya.
const dariPustaka = createRequire(realpathSync(path.join(web, "node_modules/barcode-detector/package.json")));
const sumber = dariPustaka.resolve("zxing-wasm/reader/zxing_reader.wasm");
const tujuan = path.join(web, "public/vendor", `zxing-wasm-${ZXING_WASM_VERSION}`, "zxing_reader.wasm");

const isi = readFileSync(sumber);
const hash = createHash("sha256").update(isi).digest("hex");
if (hash !== ZXING_WASM_SHA256) {
  throw new Error(`Hash ${sumber} tidak cocok dengan versi ${ZXING_WASM_VERSION} yang dipakai pustaka.`);
}
mkdirSync(path.dirname(tujuan), { recursive: true });
copyFileSync(sumber, tujuan);
console.log(`Disalin: ${path.relative(web, tujuan)} (${isi.length} byte, zxing-wasm ${ZXING_WASM_VERSION})`);
