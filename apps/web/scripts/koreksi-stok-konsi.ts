/**
 * Sekali jalan: kiriman konsinyasi yang tercatat SEBELUM aturan "toko konsinyasi = gudang lain"
 * (keputusan pemilik) tidak pernah keluar dari stok gudang utama, sementara returnya (NRI) sudah
 * menambahkannya kembali — stok gudang membengkak. Skrip ini melaporkan per (barang, varian):
 *   terkirim − sudah dipotong − cadangan dilepas = selisih
 * dan, dengan --apply, membuat penyesuaian NEGATIVE `KONSI_TRANSFER` berkunci per baris kiriman
 * modul konsinyasi (kunci yang sama dengan penulis baru, jadi menjalankan ulang — atau pengiriman
 * yang terjadi sesudahnya — tidak pernah memotong dua kali).
 *
 * Pesanan KONSI salesman yang disetujui hanya DILAPORKAN — tidak pernah dipotong dan cadangannya
 * tidak pernah dilepas di sini. Stoknya pindah lewat alur pengiriman; yang belum berangkat tampil
 * sebagai "menunggu kirim", dan sisa yang tidak jadi dikirim ditutup dari halaman pesanan.
 *
 * Logika dan aturannya ada di `lib/konsinyasi/koreksi-stok-konsi.ts` (diuji terhadap basis data):
 *   - TERTIMPA: angka gudang barang itu sudah ditetapkan ulang sesudah tanggal kirim (opname,
 *     webhook stok Jubelio, rekonsiliasi Jubelio) — dilaporkan, TIDAK dipotong. Periksa bersama
 *     gudang; kalau memang belum termasuk, jalankan ulang dengan --sertakan-tertimpa.
 *   - VARIAN_TIDAK_PASTI: kiriman lama per barang untuk barang yang stoknya per varian —
 *     dilaporkan, tidak dipotong (perlu penyesuaian manual per varian).
 *   - Stok fisik lebih kecil dari jumlah kirim: dokumen itu ditolak utuh (gudang tidak dibuat
 *     negatif) dan dilaporkan sebagai gagal.
 *
 * PERHATIAN sebelum --apply di produksi: jalankan mode kering, tunjukkan daftarnya ke pemilik /
 * gudang, dan pastikan aplikasi baru (yang memotong saat kirim) SUDAH berjalan — kalau tidak,
 * kiriman yang dicatat aplikasi lama sesudah skrip ini tetap tidak memotong.
 *
 * Mode kering (bawaan, tidak menulis apa pun):
 *   corepack pnpm exec tsx scripts/koreksi-stok-konsi.ts
 * Terapkan (basis data lokal):
 *   corepack pnpm exec tsx scripts/koreksi-stok-konsi.ts --apply
 * Terapkan di basis data lain (produksi/terowongan):
 *   corepack pnpm exec tsx scripts/koreksi-stok-konsi.ts --apply --confirm-prod-writes
 * Ikut potong baris TERTIMPA yang sudah diperiksa:
 *   … --apply --sertakan-tertimpa
 */
import "dotenv/config";

const terapkan = process.argv.includes("--apply");
const konfirmasi = process.argv.includes("--confirm-prod-writes");
const sertakanTertimpa = process.argv.includes("--sertakan-tertimpa");

/** Basis data lokal: Postgres :55432 atau bed MariaDB :3308 di mesin ini. */
function basisDataLokal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\]):(55432|3308)(\/|$)/.test(url);
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log(`DATABASE_URL: ${url.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`);
  if (process.argv.includes("--lepas-cadangan-opname")) {
    throw new Error(
      "--lepas-cadangan-opname tidak berlaku lagi: cadangan pesanan konsinyasi milik alur pengiriman. Tutup sisa pesanan dari halaman pesanan.",
    );
  }
  console.log(`mode: ${terapkan ? "TERAPKAN" : "KERING (tidak menulis)"}${sertakanTertimpa ? " + sertakan TERTIMPA" : ""}`);
  if (terapkan && !basisDataLokal(url) && !konfirmasi) {
    throw new Error("Menolak menulis: bukan basis data lokal. Tambahkan --confirm-prod-writes (dan --apply).");
  }

  const { prisma } = await import("@elorae/db");
  const { koreksiStokKonsi } = await import("../lib/konsinyasi/koreksi-stok-konsi");
  try {
    const lap = await koreksiStokKonsi({ terapkan, sertakanTertimpa });
    const hitung = (k: string) => lap.baris.filter((b) => b.keadaan === k).length;
    console.log("");
    console.log(`Baris kiriman konsinyasi diperiksa : ${lap.baris.length}`);
    console.log(`  dari pesanan KONSI (dilaporkan)  : ${lap.baris.filter((b) => b.sumber === "PESANAN").length}`);
    console.log(`  dari kiriman modul konsinyasi    : ${lap.baris.filter((b) => b.sumber === "KIRIMAN").length}`);
    console.log(`  sudah dipotong                   : ${hitung("SUDAH_DIPOTONG")}`);
    console.log(`  ${terapkan ? "dicoba dipotong " : "akan dipotong   "}                 : ${hitung("AKAN_DIPOTONG")}`);
    console.log(`  tertimpa hitung ulang (dilewati) : ${hitung("TERTIMPA")}`);
    console.log(`  varian tidak pasti (dilewati)    : ${hitung("VARIAN_TIDAK_PASTI")}`);
    console.log(`  cadangan dilepas tanpa potong    : ${hitung("CADANGAN_DILEPAS")}`);
    console.log(`  menunggu kirim (alur pengiriman) : ${hitung("MENUNGGU_KIRIM")}`);
    if (hitung("MENUNGGU_KIRIM") > 0) {
      const berangkat = lap.baris.filter((b) => b.keadaan === "MENUNGGU_KIRIM").reduce((n, b) => n + b.sudahKeluar, 0);
      console.log(`    (${berangkat} pcs di antaranya sudah berangkat lewat pengiriman sebagian; sisanya dikirim atau ditutup dari halaman pesanan)`);
    }

    console.log("");
    console.log("Per barang × varian (pcs):");
    if (lap.perBarang.length === 0) console.log("  (tidak ada kiriman konsinyasi yang menunjuk barang katalog)");
    let nilaiAkan = 0;
    for (const r of lap.perBarang) {
      const nilai = r.akanDipotong * (r.avgCost ?? 0);
      nilaiAkan += nilai;
      console.log(
        `  ${r.sku || r.itemId}${r.variantSku ? ` [${r.variantSku}]` : ""} ${r.nama}\n` +
          `    terkirim ${r.terkirim} − sudah dipotong ${r.sudahDipotong} − cadangan dilepas ${r.cadanganDilepas} = selisih ${r.selisih}` +
          ` | akan dipotong ${r.akanDipotong} (${rupiah(nilai)}) | tertimpa ${r.tertimpa}` +
          `${r.tertimpa > 0 ? ` (hitung ulang terakhir: ${r.sumberHitungUlang})` : ""}` +
          ` | varian tidak pasti ${r.variantTidakPasti} | menunggu kirim ${r.menungguKirim}\n` +
          `    gudang kini ${r.stokGudang ?? "—"} (cadangan ${r.cadanganGudang ?? "—"}) | retur NRI dari toko konsi ${r.returDariKonsi}`,
      );
    }
    console.log("");
    console.log(`Nilai yang ${terapkan ? "dicoba " : "akan "}dipotong (avgCost kini): ${rupiah(nilaiAkan)}`);

    console.log("");
    console.log("Retur NRI (layak) dari toko konsi atas barang yang TIDAK pernah tercatat dikirim — tidak dikoreksi, periksa:");
    if (lap.returTanpaKiriman.length === 0) console.log("  (tidak ada)");
    for (const r of lap.returTanpaKiriman) {
      console.log(`  ${r.sku || r.itemId}${r.variantSku ? ` [${r.variantSku}]` : ""} ${r.nama}: ${r.qty} pcs`);
    }

    if (lap.diterapkan) {
      console.log("");
      console.log(`Dokumen dipotong : ${lap.diterapkan.dokumenDipotong}`);
      console.log(`Baris dipotong   : ${lap.diterapkan.barisDipotong}`);
      console.log(`Gagal (stok fisik kurang, dokumen batal utuh): ${lap.diterapkan.gagal.length}`);
      for (const g of lap.diterapkan.gagal) {
        for (const k of g.kurang) {
          console.log(`    ${g.sumber} ${g.dokumen}: ${k.itemId}${k.variantSku ? ` [${k.variantSku}]` : ""} butuh ${k.requested}, gudang ${k.available}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
