/**
 * Riwayat rekonsiliasi: kegagalan BERURUTAN dengan sebab yang sama disatukan
 * menjadi satu baris ("Gagal 26 kali sejak 27 Sep"). Dulu setiap baris gagal
 * mengulang kalimat sebab yang sama, dan halaman 2.400 piksel berisi teks yang
 * itu-itu saja. Urutan masukan dipertahankan (terbaru dulu). Murni.
 */
export type GrupRun<T> =
  | { jenis: "tunggal"; run: T }
  | { jenis: "gagalBeruntun"; runs: T[]; sebab: string };

export function kelompokkanRun<T extends { status: string }>(runs: readonly T[], sebab: (run: T) => string): GrupRun<T>[] {
  const hasil: GrupRun<T>[] = [];
  for (const run of runs) {
    const akhir = hasil[hasil.length - 1];
    if (run.status === "FAILED") {
      const s = sebab(run);
      if (akhir && akhir.jenis === "gagalBeruntun" && akhir.sebab === s) {
        akhir.runs.push(run);
        continue;
      }
      if (akhir && akhir.jenis === "tunggal" && akhir.run.status === "FAILED" && sebab(akhir.run) === s) {
        hasil[hasil.length - 1] = { jenis: "gagalBeruntun", runs: [akhir.run, run], sebab: s };
        continue;
      }
    }
    hasil.push({ jenis: "tunggal", run });
  }
  return hasil;
}
