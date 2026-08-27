import { adalahAngka, keAngka } from './angka';

/**
 * Membaca nota retur toko dari baris teks hasil OCR.
 *
 * Fungsi MURNI: masuk baris teks, keluar usulan baris barang. Mesin OCR-nya
 * berdiri di berkas lain, dan pemisahan itu disengaja — bagian yang berharga di
 * sini bukan mesinnya melainkan aturan bacanya, dan aturan itu harus bisa
 * diuji tanpa gambar apa pun.
 *
 * SATU HAL YANG PALING PENTING: fungsi ini MENGUSULKAN, tidak pernah mengisi.
 * OCR salah sesekali — itu sifatnya, bukan cacat yang bisa diperbaiki — jadi
 * yang membuatnya aman dipakai adalah ia menunjukkan DI MANA ia mungkin salah:
 * angka yang diturunkan mengaku diturunkan, baris yang tidak menjumlah mengaku
 * janggal, dan baris yang tidak terbaca muncul apa adanya alih-alih hilang.
 */

/** Dari mana angka jumlah berasal. */
export type AsalQty = 'dibaca' | 'dihitung';

export type BarisTerbaca = {
  itemName: string;
  qty: number;
  price: number;
  amount: number;
  asalQty: AsalQty;
  /**
   * Ada yang tidak konsisten pada baris ini — qty × harga tidak sama dengan
   * nilainya, atau angkanya kurang. Bukan berarti salah; berarti harus dilihat.
   */
  janggal: boolean;
};

export type HasilBacaNota = {
  noNota: string | null;
  /** Tanggal saja (YYYY-MM-DD), bukan waktu — nota tidak punya jam. */
  tanggal: string | null;
  baris: BarisTerbaca[];
  total: number | null;
  /** Baris yang tidak bisa dibaca sebagai barang, ditampilkan apa adanya. */
  dilewati: string[];
};

/**
 * Kata yang menandai baris itu BUKAN barang.
 *
 * Dicocokkan sebagai kata utuh di awal baris, bukan sebagai potongan di mana
 * pun. Sebuah barang bernama "Totebag" tidak boleh hilang karena diawali
 * "total"; itu jenis kehilangan yang tidak akan pernah ada yang melaporkannya.
 */
const BUKAN_BARANG = [
  'total',
  'subtotal',
  'sub total',
  'jumlah',
  'grand total',
  'ppn',
  'pph',
  'pajak',
  'diskon',
  'potongan',
  'bayar',
  'dibayar',
  'tunai',
  'kembali',
  'kembalian',
  'terbilang',
  'nota',
  'no',
  'tgl',
  'tanggal',
  'hormat',
  'terima kasih',
];

const KATA_TOTAL = ['total', 'grand total', 'jumlah'];

/**
 * Batas bawah sebuah nilai uang di nota retur.
 *
 * Sebuah baris yang HANYA membawa satu angka bisa berarti dua hal: barang yang
 * kehilangan kolom harga dan jumlahnya, atau sebaris teks yang kebetulan
 * berakhir dengan angka — nomor rumah pada alamat toko, nomor urut, tahun.
 * Yang membedakan keduanya adalah besarannya: dalam rupiah tidak ada barang
 * yang diretur seharga dua belas.
 *
 * Ini TEBAKAN, dan tebakan yang salah punya harga. Yang dibayar: sebuah barang
 * sungguhan seharga di bawah seribu rupiah tidak akan diusulkan. Yang dihindari:
 * "Jl. Merdeka 12" muncul sebagai barang seharga Rp 12 di setiap nota, dan
 * daftar yang selalu berisi sampah yang sama akan berhenti dibaca.
 */
const MIN_RUPIAH = 1_000;

export function bacaNota(barisTeks: string[]): HasilBacaNota {
  const hasil: HasilBacaNota = {
    noNota: null,
    tanggal: null,
    baris: [],
    total: null,
    dilewati: [],
  };

  for (const mentah of barisTeks) {
    const baris = mentah.replace(/\s+/g, ' ').trim();
    // Baris kosong bukan kegagalan membaca; ia memang tidak berisi apa-apa.
    if (baris === '') continue;

    if (hasil.noNota === null) {
      const no = pungutNomor(baris);
      if (no) hasil.noNota = no;
    }
    if (hasil.tanggal === null) {
      const tgl = pungutTanggal(baris);
      if (tgl) hasil.tanggal = tgl;
    }

    /*
     * Dibaca DULU, baru diputuskan. Baris yang berbentuk barang LENGKAP —
     * nama, jumlah, harga, nilai yang menjumlah — menang atas daftar kata
     * terlarang, karena "Nota Bene Tas Kecil 2 50.000 100.000" adalah barang
     * dan "NOTA RETUR BARANG" bukan, dan yang membedakan keduanya adalah
     * bentuknya, bukan kata pembukanya.
     *
     * Ketimpangannya disengaja: baris bukan-barang yang terlanjur masuk akan
     * TERLIHAT di daftar tinjauan dan bisa dihapus dalam sedetik. Baris barang
     * yang terlanjur dibuang tidak terlihat di mana pun.
     */
    const terbaca = bacaBarisBarang(baris);
    const lengkap = terbaca !== null && !terbaca.janggal && terbaca.qty > 0;

    if (!lengkap) {
      const awalan = kataAwal(baris);
      if (awalan !== null) {
        // Baris total tetap dipungut angkanya — ia bahan pembanding paling
        // berguna yang dipunyai sebuah nota.
        if (hasil.total === null && KATA_TOTAL.includes(awalan)) {
          const angka = angkaEkor(baris);
          if (angka.length > 0) hasil.total = angka[angka.length - 1];
        }
        continue;
      }
    }

    if (terbaca) {
      hasil.baris.push(terbaca);
      continue;
    }
    /*
     * Yang masuk daftar tinjauan hanya baris yang MEMBAWA ANGKA tapi tidak bisa
     * dirakit — itu tanda sebuah baris barang terbelah, dan berarti ada barang
     * di nota yang tidak masuk ke mana pun.
     *
     * Baris tanpa angka sama sekali tidak mungkin barang: setiap barang membawa
     * setidaknya satu angka. Itu kepala nota, nama toko, alamat — dan ia muncul
     * di SETIAP nota. Daftar tinjauan yang selalu berisi hal yang sama akan
     * berhenti dibaca, dan yang berhenti dibaca sama saja tidak ada.
     */
    const adaUang = baris
      .split(' ')
      .some((token) => {
        const n = keAngka(token);
        return n !== null && n >= MIN_RUPIAH;
      });
    if (adaUang) hasil.dilewati.push(baris);
  }

  return hasil;
}

/**
 * Baca satu baris sebagai barang, atau `null` kalau memang bukan.
 *
 * Bentuk baris nota: NAMA … lalu satu sampai tiga angka di ujung kanan. Yang
 * paling kanan selalu nilainya; yang sebelumnya harga; yang sebelum itu jumlah.
 */
function bacaBarisBarang(baris: string): BarisTerbaca | null {
  const angka = angkaEkor(baris);
  if (angka.length === 0) return null;

  const potong = baris.split(' ');
  const nama = potong.slice(0, potong.length - jumlahTokenEkor(baris)).join(' ').trim();
  // Angka tanpa nama bukan baris barang — itu potongan tabel yang terbelah.
  if (nama === '') return null;

  const amount = angka[angka.length - 1];

  if (angka.length >= 3) {
    const [qty, price] = [angka[angka.length - 3], angka[angka.length - 2]];
    return {
      itemName: nama,
      qty,
      price,
      amount,
      asalQty: 'dibaca',
      janggal: !mendekati(qty * price, amount),
    };
  }

  if (angka.length === 2) {
    /*
     * Qty-nya hilang. Mesin OCR membuang angka pendek yang berdiri sendiri —
     * temuan brief, dan kolom qty persis berbentuk begitu. Diturunkan dari
     * nilai ÷ harga, lalu DITANDAI supaya tidak menyamar sebagai hasil baca.
     */
    const price = angka[0];
    if (price > 0) {
      const bagi = amount / price;
      const bulat = Math.round(bagi);
      if (bulat >= 1 && mendekati(bulat * price, amount)) {
        return {
          itemName: nama,
          qty: bulat,
          price,
          amount,
          asalQty: 'dihitung',
          janggal: false,
        };
      }
    }
    // Tidak membagi bulat: notanya salah baca, bukan jumlahnya pecahan.
    return { itemName: nama, qty: 0, price, amount, asalQty: 'dibaca', janggal: true };
  }

  // Satu angka saja — nota tulisan tangan yang cuma menulis nama dan nilainya.
  // Kecuali angkanya terlalu kecil untuk jadi uang; lihat MIN_RUPIAH.
  if (amount < MIN_RUPIAH) return null;
  return { itemName: nama, qty: 0, price: 0, amount, asalQty: 'dibaca', janggal: true };
}

/**
 * Berapa token di ujung kanan baris yang berupa angka.
 *
 * Dihitung dari kanan dan berhenti pada token bukan-angka pertama, supaya angka
 * yang menempel pada nama barang — ukuran, tahun seri — tidak ikut tertarik.
 */
function jumlahTokenEkor(baris: string): number {
  const potong = baris.split(' ');
  let n = 0;
  for (let i = potong.length - 1; i >= 0; i--) {
    if (!adalahAngka(potong[i])) break;
    n++;
  }
  // Maksimal tiga: qty, harga, nilai. Lebih dari itu bagian dari nama.
  return Math.min(n, 3);
}

function angkaEkor(baris: string): number[] {
  const potong = baris.split(' ');
  const n = jumlahTokenEkor(baris);
  return potong
    .slice(potong.length - n)
    .map(keAngka)
    .filter((x): x is number => x !== null);
}

/**
 * Kata pembuka baris kalau baris itu bukan barang, atau `null`.
 *
 * Dicocokkan sebagai kata utuh supaya "Totebag" tidak dibaca sebagai "total".
 */
function kataAwal(baris: string): string | null {
  const kecil = baris.toLowerCase();
  for (const kata of BUKAN_BARANG) {
    if (kecil === kata) return kata;
    if (kecil.startsWith(kata + ' ') || kecil.startsWith(kata + '.') || kecil.startsWith(kata + ':')) {
      return kata;
    }
  }
  return null;
}

/** Nomor nota toko, mis. `NRT-4471`. Bentuknya milik toko, bukan milik kita. */
function pungutNomor(baris: string): string | null {
  const cocok = baris.match(/\b([A-Za-z]{2,5}[-/]\s?\d{2,8})\b/);
  return cocok ? cocok[1].replace(/\s/g, '').toUpperCase() : null;
}

/**
 * Tanggal dari sebuah baris, sebagai tanggal saja.
 *
 * MENOLAK tanggal yang tidak masuk akal alih-alih menebaknya. Bulan 13 berarti
 * salah baca; menebaknya jadi Januari tahun depan memindahkan sebuah nota ke
 * periode yang salah tanpa ada satu pun yang tahu.
 */
function pungutTanggal(baris: string): string | null {
  const cocok = baris.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (!cocok) return null;

  const hari = Number(cocok[1]);
  const bulan = Number(cocok[2]);
  let tahun = Number(cocok[3]);
  if (tahun < 100) tahun += 2000;

  if (bulan < 1 || bulan > 12) return null;
  if (hari < 1 || hari > 31) return null;
  if (tahun < 2000 || tahun > 2100) return null;
  // Hari yang tidak ada di bulan itu — 31 Februari — juga salah baca.
  if (hari > new Date(tahun, bulan, 0).getDate()) return null;

  return `${tahun}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

/**
 * Apakah jumlah baris yang dipilih cocok dengan total yang tertulis di nota.
 *
 * INI PEMERIKSAAN PALING PENTING YANG DITAWARKAN SELURUH FITUR INI, dan
 * alasannya terbukti saat diuji dengan foto yang satu barisnya terhapus tinta:
 * mesinnya menjatuhkan seluruh baris itu, TIDAK memberi tanda apa pun, dan
 * keyakinannya tetap 93% — jadi tidak ada satu pun sinyal lain yang menyadari
 * ada barang yang hilang. Yang menyadarinya cuma ini: 640.000 melawan
 * 1.315.000.
 *
 * `null` kalau notanya memang tidak menuliskan total; itu bukan kegagalan,
 * hanya berarti pemeriksaan ini tidak tersedia untuk nota itu.
 */
export function cocokTotal(baris: BarisTerbaca[], total: number | null): boolean | null {
  if (total === null) return null;
  return mendekati(
    baris.reduce((s, b) => s + b.amount, 0),
    total,
  );
}

/**
 * Dua nilai uang dianggap sama.
 *
 * Bertoleransi satu rupiah karena nota sungguhan membulatkan, dan selisih satu
 * rupiah yang ditandai janggal hanya melatih orang mengabaikan tanda itu.
 */
function mendekati(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}
