import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis: dialog "Catat pembayaran toko" mengirim kunci kiriman
 * bersama pembayaran, dan kuncinya diganti HANYA sesudah simpan berhasil.
 * Perilaku kuncinya dites terhadap basis data di
 * `lib/konsinyasi/bayar-toko-kunci.test.ts`.
 *
 * Kenapa bukan per pembukaan dialog: jawaban yang hilang (uangnya sudah
 * tercatat) lalu dialog ditutup, dibuka lagi, dan pembayaran yang sama diketik
 * ulang — kunci baru di situ mencatat uang yang sama dua kali.
 */

const KARTU = readFileSync(path.join(__dirname, "TagihanKonsiCard.tsx"), "utf8");

describe("TagihanKonsiCard — kunci kiriman pembayaran toko", () => {
  it("kunci dari newLocalId (sekali per kartu)", () => {
    expect(KARTU).toMatch(/import \{ newLocalId \} from "@\/lib\/pwa\/id-lokal";/);
    expect(KARTU).toMatch(/const \[kunciBayar, setKunciBayar\] = useState\(\(\) => newLocalId\(\)\);/);
  });

  it("membuka dialog TIDAK mengganti kunci", () => {
    const buka = KARTU.slice(KARTU.indexOf("const bukaCatat = () => {"), KARTU.indexOf("setCatatTerbuka(true);"));
    expect(buka.length).toBeGreaterThan(0);
    expect(buka).not.toMatch(/setKunciBayar\(/);
  });

  it("simpan mengirim kunci; kunci baru hanya di jalur berhasil", () => {
    expect(KARTU).toMatch(/catatPembayaranTokoAction\(\{[^}]*idempotencyKey: kunciBayar \}\)/);
    expect(KARTU.match(/setKunciBayar\(/g)).toHaveLength(1);
    // Satu-satunya penggantian ada di callback `bersih` milik simpan pembayaran
    // (dipanggil `jalankan` hanya bila hasil.ok).
    expect(KARTU).toMatch(
      /t\("okRecorded"\),\s*\(\) => \{\s*setCatatTerbuka\(false\);\s*setKunciBayar\(newLocalId\(\)\);\s*\}/,
    );
    const jalankan = KARTU.slice(KARTU.indexOf("const jalankan = "), KARTU.indexOf("const bukaCatat = "));
    expect(jalankan).toMatch(/if \(hasil\.ok\) \{[^}]*bersih\(\);/);
  });
});
