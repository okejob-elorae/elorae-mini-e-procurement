import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis formulir GRN (repo ini tidak punya pustaka render).
 *
 * Dulu GRN yang disimpan tanpa sinyal masuk `pendingGRNs` di IndexedDB dengan
 * pesan "akan disinkronkan" — padahal tidak ada kode yang pernah mengirimnya.
 * Sekarang GRN butuh sinyal: tombol simpan mati dengan alasan, dan isian
 * disimpan sebagai draf di perangkat. Aturan draf dites murni di
 * `lib/offline/grn-draf.test.ts`; tes ini menjaga sambungannya di layar.
 */

const WEB = path.resolve(__dirname, "../../../../..");
const FORM = readFileSync(path.join(WEB, "components/grn/GRNForm.tsx"), "utf8");

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasSumber(p));
    else if (/\.tsx?$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

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

describe("formulir GRN — tanpa janji sinkron palsu", () => {
  it("tidak ada kode yang menulis antrean GRN luring lama", () => {
    for (const akar of ["app", "components", "lib"]) {
      for (const berkas of berkasSumber(path.join(WEB, akar))) {
        const isi = readFileSync(berkas, "utf8");
        expect(isi, path.relative(WEB, berkas)).not.toMatch(/savePendingGRN|pendingGRNs\.(add|put|bulkAdd|bulkPut)\(/);
      }
    }
  });

  it("teks 'akan disinkronkan' tidak dipakai lagi", () => {
    expect(FORM).not.toMatch(/['"]savedOffline['"]|['"]offlineNotice['"]|['"]saveOfflineFailed['"]/);
  });

  it("tombol simpan mati tanpa sinyal, dan alasannya tertulis", () => {
    expect(FORM).toMatch(/const alasanSimpan = alasanTidakBisaSimpanGrn\(\{ daring \}\);/);
    expect(FORM).toMatch(/<Button type="submit" disabled=\{isLoading \|\| alasanSimpan !== null\}/);
    expect(FORM).toMatch(/\{alasanSimpan !== null && \(/);
    expect(FORM).toMatch(/useSyncExternalStore\(langgananSinyal,/);
  });

  it("handleSubmit menolak tanpa sinyal SEBELUM mengunggah foto atau menyimpan", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    const jaga = kirim.indexOf("alasanTidakBisaSimpanGrn({ daring: sinyalSekarang() })");
    expect(jaga).toBeGreaterThan(-1);
    expect(kirim.indexOf("fetch('/api/upload/grn-photo'")).toBeGreaterThan(jaga);
    expect(kirim.indexOf("simpanGRN(data)")).toBeGreaterThan(jaga);
    // Tidak ada lagi cabang yang menyimpan GRN ke perangkat.
    expect(kirim).not.toMatch(/isOnline\(\)|PendingGRN|pendingGRNs/);
  });

  it("draf dihapus hanya setelah GRN tersimpan, sebelum pindah halaman", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    const tolak = kirim.indexOf("if (!hasil.ok) {");
    const selesai = kirim.indexOf("await selesaikanDraf();");
    const pindah = kirim.indexOf("onSuccess?.();");
    expect(tolak).toBeGreaterThan(-1);
    expect(selesai).toBeGreaterThan(tolak);
    expect(pindah).toBeGreaterThan(selesai);
    // Satu-satunya pemanggil selesaikanDraf adalah jalur sukses itu.
    expect(FORM.match(/selesaikanDraf\(\)/g)).toHaveLength(1);
  });

  it("sambungan putus tidak dilaporkan sebagai gagal biasa (GRN mungkin sudah tercatat)", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    expect(kirim).toMatch(/if \(galatSambungan\(err\)\) \{\s*toast\.error\(t\('sambunganPutus'\)\);/);
  });

  it("draf dibaca dan ditulis lewat tabel drafGRN per pengguna", () => {
    expect(FORM).toMatch(/ambilDrafGrn\(offlineDB\.drafGRN, kunciDraf\)/);
    expect(FORM).toMatch(/simpanDrafGrn\(offlineDB\.drafGRN, kunciDraf,/);
    // Kunci lengket: sesi null (tab dibuka lagi tanpa sinyal) tidak mengosongkannya.
    expect(FORM).toMatch(/const kunciSekarang = kunciDrafLengket\(kunciDraf, idSesi\);/);
    expect(FORM).toMatch(/if \(kunciSekarang !== kunciDraf\) setKunciDraf\(kunciSekarang\);/);
    expect(FORM).not.toMatch(/const kunciDraf = session/);
    // Penulisan draf berhenti begitu GRN tersimpan (timer yang tertunda tidak menghidupkannya lagi).
    const simpan = blok(FORM, "const tulisDraf = useCallback(");
    expect(simpan).toMatch(/if \(selesaiRef\.current\) return;/);
  });

  it("simpan tetap bisa setelah sesi hilang karena sinyal putus (tidak memakai sesi langsung)", () => {
    const kirim = blok(FORM, "const handleSubmit = async (e: React.FormEvent) => {");
    expect(kirim).toMatch(/if \(!kunciDraf\) \{\s*toast\.error\(tToasts\('youMustBeLoggedIn'\)\);/);
    expect(kirim).not.toMatch(/session/);
  });

  it("draf yang dipulihkan memakai angka PO terbaru, dan PO yang dikosongkan melepas penanda draf", () => {
    const awal = FORM.indexOf("if (!poId) {");
    const efek = FORM.slice(awal, FORM.indexOf("}, [poId, t]);", awal));
    const kosong = blok(efek, "if (!poId) {");
    expect(kosong).toMatch(/lewatiBarisPo\.current = null;/);
    const dariDraf = efek.indexOf("if (dariDraf) {");
    expect(dariDraf).toBeGreaterThan(-1);
    expect(blok(efek, "if (dariDraf) {")).toMatch(/setLines\(\(prev\) => segarkanAngkaPo\(prev, angkaPo\)\);\s*return;/);
  });

  it("GRN lama yang tidak pernah terkirim ditampilkan dan bisa dimuat ke formulir", () => {
    expect(FORM).toMatch(/getPendingGRNs\(\)/);
    expect(FORM).toMatch(/drafDariGrnLama\(/);
    // Dihapus dari perangkat hanya setelah tersimpan atau atas konfirmasi pengguna.
    expect(FORM.match(/removePendingGRN\(/g)).toHaveLength(2);
  });
});
