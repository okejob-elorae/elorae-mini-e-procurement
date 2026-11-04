/**
 * Coba OCR pada sebuah foto nota, dari baris terminal.
 *
 *   pnpm -F @elorae/web exec tsx scripts/coba-ocr.mts <jalur-foto>
 *
 * Menjalankan persis jalur yang dipakai `bacaNotaAction`, tanpa lapisan auth —
 * jadi hasilnya di sini sama dengan yang akan muncul di layar. Gunanya untuk
 * mencoba foto nota SUNGGUHAN sebelum menyimpulkan fiturnya kurang: yang paling
 * sering membuat bacaan buruk adalah fotonya (miring, gelap, terlalu jauh),
 * bukan aturannya, dan itu cuma bisa dilihat dengan mencoba.
 *
 * Perhatikan baris "jumlah baris vs total tertulis": itu pemeriksaan terpenting
 * yang ada. Sebuah baris bisa hilang tanpa tanda apa pun sementara keyakinannya
 * tetap tinggi, dan cuma angka itu yang menyadarinya.
 */
import { readFileSync } from 'node:fs';
import { bacaGambar } from '../lib/ocr/mesin';
import { bacaNota } from '../lib/ocr/nota';

async function jalan() {
  const b = readFileSync(process.argv[2]);
  console.log(`gambar: ${b.length} byte`);
  const { baris, keyakinan, msBaca } = await bacaGambar(b);
  console.log(`dibaca ${msBaca} ms, keyakinan ${keyakinan.toFixed(1)}%`);
  console.log('--- baris mentah dari mesin ---');
  for (const x of baris) console.log('  ' + x);

  const h = bacaNota(baris);
  console.log('--- hasil urai ---');
  console.log('  no nota :', h.noNota);
  console.log('  tanggal :', h.tanggal);
  console.log('  total   :', h.total);
  for (const r of h.baris) {
    console.log(`  ${r.itemName} | qty ${r.qty} (${r.asalQty}) | ${r.price} | ${r.amount}${r.janggal ? ' | JANGGAL' : ''}`);
  }
  console.log('  dilewati:', h.dilewati);
  const jml = h.baris.reduce((s, r) => s + r.amount, 0);
  console.log(`  jumlah baris ${jml} vs total tertulis ${h.total} → ${jml === h.total ? 'COCOK' : 'BEDA'}`);
  process.exit(0);
}
void jalan();
