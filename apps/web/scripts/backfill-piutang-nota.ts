/**
 * Sekali jalan: piutang untuk nota tagihan pengiriman putus yang tercatat SEBELUM aturan
 * "setiap nota tagihan otomatis menjadi piutang" (keputusan pemilik). Tanpa ini cek kredit toko
 * buta terhadap nota lama — tokonya tampak bersih padahal sudah berutang.
 *
 * Aturannya sama persis dengan penulis pengiriman (`buatPiutangNota`): nomor piutang = nomor nota,
 * tanggal faktur/jatuh tempo = tanggal nota, nilai = total nota, sales = sales pemilik pesanan,
 * sisa = nilai (belum ada klaim). Dilewati dan DILAPORKAN, tidak dibuat:
 *   - nota bernilai 0 atau kurang (hanya barang bonus);
 *   - nota yang nomornya sudah dipegang piutang lain (impor/manual) — butuh keputusan orang;
 *   - nota dari pesanan yang bukan PUTUS (seharusnya tidak ada);
 *   - DUGAAN GANDA: nota yang mungkin sudah ditagih lewat impor SSG / faktur manual dengan nomor
 *     lain (toko sama, nilai sama sampai sen, tanggal faktur ≤ 31 hari). Setelah diperiksa bersama
 *     pemilik dan memang bukan tagihan yang sama, jalankan ulang dengan --sertakan-dugaan-ganda.
 * Aman dijalankan ulang: nota yang sudah punya piutang tidak disentuh.
 *
 * PERHATIAN sebelum --apply di produksi: pastikan migrasi MariaDB modul piutang
 * (`20260827090000_piutang_pelunasan_modul`) sudah berjalan. Penjaga dugaan ganda hanya menangkap
 * tagihan bernilai SAMA; nota yang ditagih dengan nilai lain (mis. digabung atau dipotong retur)
 * tetap terhitung dua kali — periksa daftar "akan dibuat" dari mode kering bersama pemilik dulu.
 *
 * Mode kering (bawaan, tidak menulis apa pun):
 *   corepack pnpm exec tsx scripts/backfill-piutang-nota.ts
 * Terapkan (basis data lokal):
 *   corepack pnpm exec tsx scripts/backfill-piutang-nota.ts --apply
 * Terapkan di basis data lain (produksi/terowongan):
 *   corepack pnpm exec tsx scripts/backfill-piutang-nota.ts --apply --confirm-prod-writes
 * Sertakan dugaan ganda yang sudah diperiksa (hati-hati — menagih toko dua kali kalau salah):
 *   … --apply --sertakan-dugaan-ganda
 */
import "dotenv/config";

const terapkan = process.argv.includes("--apply");
const konfirmasi = process.argv.includes("--confirm-prod-writes");
const sertakanDugaanGanda = process.argv.includes("--sertakan-dugaan-ganda");

/** Basis data lokal: Postgres :55432 atau bed MariaDB :3308 di mesin ini. */
function basisDataLokal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\]):(55432|3308)(\/|$)/.test(url);
}

function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log(`DATABASE_URL: ${url.replace(/:[^:@/]+@/, ":****@").slice(0, 80)}…`);
  console.log(`mode: ${terapkan ? "TERAPKAN" : "KERING (tidak menulis)"}`);
  if (terapkan && !basisDataLokal(url) && !konfirmasi) {
    throw new Error("Menolak menulis: bukan basis data lokal. Tambahkan --confirm-prod-writes (dan --apply).");
  }

  const { prisma } = await import("@elorae/db");
  const { isiPiutangNotaLama } = await import("../lib/field-sales/delivery/writer");
  try {
    const l = await isiPiutangNotaLama({ terapkan, sertakanDugaanGanda });
    console.log("");
    console.log(`Nota diperiksa              : ${l.diperiksa}`);
    console.log(`Sudah punya piutang         : ${l.sudahPunya}`);
    console.log(`${terapkan ? "Dicoba dibuat" : "Akan dibuat  "}               : ${l.akanDibuat} (${rupiah(l.nilaiAkanDibuat)})`);
    if (terapkan) console.log(`Benar-benar dibuat          : ${l.dibuat} (${rupiah(l.nilaiDibuat)})`);
    console.log(`Dilewati — bernilai 0       : ${l.nol.length}`);
    for (const n of l.nol) console.log(`    ${n.docNo}  ${rupiah(n.total)}`);
    console.log(`Dilewati — nomor dipakai    : ${l.nomorDipakai.length}`);
    for (const n of l.nomorDipakai) console.log(`    ${n.docNo}  dipegang piutang ${n.receivableId} (${n.source})`);
    console.log(`Dilewati — bukan PUTUS      : ${l.bukanPutus.length}`);
    for (const n of l.bukanPutus) console.log(`    ${n.docNo}  ${n.orderType}`);
    console.log(
      `${sertakanDugaanGanda ? "Dugaan ganda (DISERTAKAN)   " : "Dilewati — dugaan ganda     "}: ${l.dugaanGanda.length}`,
    );
    for (const n of l.dugaanGanda) {
      console.log(`    ${n.docNo}  ${rupiah(n.total)}  ↔ ${n.invoiceNo} (${n.source}, piutang ${n.receivableId})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
