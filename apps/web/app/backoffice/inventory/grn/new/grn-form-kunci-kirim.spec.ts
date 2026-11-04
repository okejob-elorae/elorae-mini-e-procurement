import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis sambungan kunci kiriman di formulir GRN (repo ini tidak punya
 * pustaka render). Perilaku servernya dites terhadap basis data di
 * `app/actions/grn-kunci-kirim.spec.ts`, aturan draf di `lib/offline/grn-draf.test.ts`.
 *
 * Kunci dibuat SEKALI per isian dan ikut draf: simpan ulang sesudah jawaban
 * hilang (atau sesudah muat ulang halaman) membawa kunci yang sama, sehingga
 * server mengembalikan GRN yang sudah tercatat — bukan GRN kedua.
 */

const WEB = path.resolve(__dirname, "../../../../..");
const FORM = readFileSync(path.join(WEB, "components/grn/GRNForm.tsx"), "utf8");

/** Isi fungsi/blok mulai dari `penanda` sampai kurung kurawal penutupnya. */
function blok(sumber: string, penanda: string): string {
  const awal = sumber.indexOf(penanda);
  if (awal < 0) throw new Error(`blok tidak ditemukan: ${penanda}`);
  const buka = sumber.indexOf("{", awal + penanda.length - 1);
  let dalam = 0;
  for (let i = buka; i < sumber.length; i++) {
    if (sumber[i] === "{") dalam++;
    else if (sumber[i] === "}" && --dalam === 0) return sumber.slice(awal, i + 1);
  }
  throw new Error(`blok tidak tertutup: ${penanda}`);
}

describe("formulir GRN — kunci kiriman", () => {
  it("kunci dibuat sekali per isian (lazy useState) dari newLocalId", () => {
    expect(FORM).toMatch(/import \{ newLocalId \} from '@\/lib\/pwa\/id-lokal';/);
    expect(FORM).toMatch(/const \[kunciKirim, setKunciKirim\] = useState\(\(\) => newLocalId\(\)\);/);
  });

  it("kiriman GRN membawa kunci isian", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    expect(kirim).toMatch(/idempotencyKey: kunciKirim,/);
    // Kunci TIDAK diganti di jalur kirim: tombol yang ditekan lagi sesudah sukses
    // (atau sesudah jawaban hilang) mendapat GRN yang sama.
    expect(kirim).not.toMatch(/setKunciKirim\(/);
  });

  it("kunci ikut draf (ditulis dan dipulihkan); draf tanpa kunci mendapat kunci baru", () => {
    const tulis = FORM.match(/drafDariIsian\(\{[^}]*\}/g) ?? [];
    expect(tulis.length).toBeGreaterThanOrEqual(2);
    for (const t of tulis) expect(t).toMatch(/kunciKirim/);
    expect(blok(FORM, "const terapkanDraf = useCallback(")).toMatch(/setKunciKirim\(draf\.kunciKirim \|\| newLocalId\(\)\);/);
  });

  it("membuang draf = isian baru = kunci baru", () => {
    expect(blok(FORM, "const buangDraf = () => {")).toMatch(/setKunciKirim\(newLocalId\(\)\);/);
  });

  it("kiriman ulang yang dijawab `ulang` diberi pesan GRN yang sudah tercatat", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    expect(kirim).toMatch(/hasil\.ulang \? t\('sudahTercatat', \{ doc: hasil\.docNumber \}\) : t\('createdToast'\)/);
  });
});
