import { describe, expect, it } from 'vitest';
import { bacaNota, cocokTotal } from './nota';

/**
 * Membaca nota retur dari baris teks hasil OCR.
 *
 * Yang dijaga di sini bukan "seberapa pintar bacanya" melainkan KEJUJURANNYA:
 * angka yang diturunkan harus mengaku diturunkan, baris yang tidak menjumlah
 * harus mengaku janggal, dan yang tidak terbaca harus muncul apa adanya alih-
 * alih hilang. OCR selalu salah sesekali; yang membuatnya aman dipakai adalah
 * ia menunjukkan di mana ia mungkin salah.
 */

describe('bacaNota', () => {
  it('membaca baris lengkap: nama, qty, harga, nilai', () => {
    const h = bacaNota(['Blus Katun XL 2 150.000 300.000']);
    expect(h.baris).toHaveLength(1);
    expect(h.baris[0]).toMatchObject({
      itemName: 'Blus Katun XL',
      qty: 2,
      price: 150_000,
      amount: 300_000,
      asalQty: 'dibaca',
      janggal: false,
    });
  });

  it('MENURUNKAN qty dari nilai / harga saat qty-nya hilang', () => {
    /*
     * Temuan brief: mesin OCR membuang angka pendek yang berdiri sendiri, yaitu
     * persis kolom qty. Tanpa penurunan ini, setiap baris nota kehilangan
     * jumlahnya dan orang harus mengetik ulang semuanya.
     */
    const h = bacaNota(['Rok Denim M 225.000 675.000']);
    expect(h.baris[0]).toMatchObject({ qty: 3, price: 225_000, amount: 675_000 });
  });

  it('MENANDAI qty turunan sebagai dihitung, bukan dibaca', () => {
    // Supaya manusia tahu angka itu bukan hasil baca langsung. Angka turunan
    // yang menyamar sebagai hasil baca adalah kebohongan kecil yang menumpuk.
    const h = bacaNota(['Rok Denim M 225.000 675.000']);
    expect(h.baris[0].asalQty).toBe('dihitung');
  });

  it('TIDAK menurunkan qty kalau pembagiannya tidak bulat', () => {
    // 700.000 / 225.000 bukan bilangan bulat: notanya salah baca, bukan qty 3,1.
    const h = bacaNota(['Rok Denim M 225.000 700.000']);
    expect(h.baris[0].qty).toBe(0);
    expect(h.baris[0].janggal).toBe(true);
  });

  it('menandai baris yang qty x harga tidak sama dengan nilainya', () => {
    // Angkanya semua terbaca, tapi tidak menjumlah — salah satu salah baca.
    const h = bacaNota(['Blus Katun XL 2 150.000 250.000']);
    expect(h.baris[0].janggal).toBe(true);
  });

  it('TIDAK menganggap alamat toko sebagai barang seharga dua belas rupiah', () => {
    // "Jl. Merdeka 12" berakhir dengan angka, tapi dua belas rupiah bukan uang.
    const h = bacaNota(['Jl. Merdeka 12', 'Blus Katun XL 2 150.000 300.000']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toHaveLength(0);
  });

  it('membaca baris yang hanya punya nama dan satu angka sebagai nilai', () => {
    // Nota tulisan tangan sering hanya menulis nama dan totalnya.
    const h = bacaNota(['Blus Katun XL 300.000']);
    expect(h.baris[0]).toMatchObject({ amount: 300_000, qty: 0, price: 0 });
    expect(h.baris[0].janggal).toBe(true);
  });

  it('MELEWATI baris total dan pajak, tidak menganggapnya barang', () => {
    const h = bacaNota([
      'Blus Katun XL 2 150.000 300.000',
      'TOTAL 300.000',
      'PPN 11% 33.000',
    ]);
    expect(h.baris).toHaveLength(1);
    expect(h.total).toBe(300_000);
  });

  it('mengumpulkan baris yang TIDAK TERBACA alih-alih membuangnya diam-diam', () => {
    /*
     * Baris yang hilang tanpa jejak adalah cara tercepat kehilangan satu barang
     * dari sebuah nota tanpa ada yang menyadarinya. Yang masuk `dilewati`
     * adalah yang GAGAL dibaca — biasanya baris barang yang harganya kacau
     * kena OCR, dan itu justru yang paling perlu dilihat orang.
     */
    const h = bacaNota(['Blus Katun XL 2 150.000 300.000', '340.000 Kemeja Linen']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toContain('340.000 Kemeja Linen');
  });

  it('TIDAK menyampahi daftar tinjauan dengan baris yang sama sekali tanpa angka', () => {
    /*
     * Kepala nota, nama toko, alamat — tidak satu pun bisa jadi baris barang,
     * karena barang selalu membawa setidaknya satu angka. Menaruhnya di daftar
     * tinjauan berarti daftar itu selalu berisi hal yang sama pada setiap nota,
     * dan daftar yang selalu berisi hal yang sama akan berhenti dibaca.
     */
    const h = bacaNota(['TOKO SINAR JAYA', 'Jl. Merdeka 12', 'Blus Katun XL 2 150.000 300.000']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toHaveLength(0);
  });

  it('MENAMPILKAN angka yang berdiri sendiri tanpa nama — itu baris yang terbelah', () => {
    /*
     * Justru yang paling perlu dilihat: kolom yang terlepas dari namanya berarti
     * ADA barang di nota itu yang tidak masuk ke mana pun.
     */
    const h = bacaNota(['Blus Katun XL 2 150.000 300.000', '225.000 675.000']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toContain('225.000 675.000');
  });

  it('membuang baris yang DIKENALI bukan barang tanpa menyampahi daftar tinjauan', () => {
    /*
     * Beda dengan yang di atas, dan bedanya penting. "Terima kasih" bukan baris
     * yang gagal dibaca — ia dikenali sebagai bukan barang. Menumpuknya di
     * daftar tinjauan bersama kegagalan sungguhan hanya melatih orang
     * mengabaikan daftar itu, dan daftar yang diabaikan sama saja tidak ada.
     */
    const h = bacaNota(['Blus Katun XL 2 150.000 300.000', 'Terima kasih', 'NOTA RETUR BARANG']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toHaveLength(0);
  });

  it('TIDAK membuang barang yang namanya kebetulan diawali kata terlarang', () => {
    /*
     * "Totebag" diawali "tote", tapi juga cukup mirip "total" untuk hilang
     * kalau pencocokannya potongan teks, bukan kata utuh. Barang yang hilang
     * karena namanya tidak akan pernah ada yang melaporkannya.
     */
    const h = bacaNota(['Totebag Kanvas 1 95.000 95.000', 'Nota Bene Tas Kecil 2 50.000 100.000']);
    expect(h.baris.map((b) => b.itemName)).toEqual(['Totebag Kanvas', 'Nota Bene Tas Kecil']);
  });

  it('TIDAK membuang barang yang namanya MEMUAT kata terlarang di tengahnya', () => {
    /*
     * `no` ada di daftar kata terlarang, dan "Kimono" memuatnya. Kalau
     * pencocokannya potongan teks alih-alih kata utuh, setiap kimono di setiap
     * nota lenyap — dan barisnya di sini sengaja TIDAK lengkap (cuma satu
     * angka), supaya aturan "baris lengkap menang" tidak menutupi cacatnya.
     *
     * Pernah lolos dari tes sampai mutasinya diuji: aturan kata-utuh itu benar
     * sejak awal, tapi tidak ada satu pun tes yang gagal ketika ia dilonggarkan.
     */
    const h = bacaNota(['Kimono Batik 700.000']);
    expect(h.baris.map((b) => b.itemName)).toEqual(['Kimono Batik']);
    expect(h.dilewati).toHaveLength(0);
  });

  it('memungut nomor nota toko', () => {
    const h = bacaNota(['NOTA RETUR', 'NRT-4471', 'Blus Katun XL 2 150.000 300.000']);
    expect(h.noNota).toBe('NRT-4471');
  });

  it('memungut tanggal dan mengembalikannya sebagai tanggal saja', () => {
    const h = bacaNota(['21/08/2026', 'Blus Katun XL 2 150.000 300.000']);
    expect(h.tanggal).toBe('2026-08-21');
  });

  it('membaca tahun dua digit sebagai 20xx', () => {
    const h = bacaNota(['21/08/26', 'Blus 2 150.000 300.000']);
    expect(h.tanggal).toBe('2026-08-21');
  });

  it('menolak tanggal yang tidak masuk akal alih-alih menebaknya', () => {
    // Bulan 13 berarti salah baca. Menebaknya jadi Januari tahun depan
    // memindahkan sebuah nota ke periode yang salah tanpa ada yang tahu.
    const h = bacaNota(['21/13/2026', 'Blus 2 150.000 300.000']);
    expect(h.tanggal).toBeNull();
  });

  it('mengabaikan baris kosong sepenuhnya', () => {
    const h = bacaNota(['', '   ', 'Blus Katun XL 2 150.000 300.000']);
    expect(h.baris).toHaveLength(1);
    expect(h.dilewati).toHaveLength(0);
  });

  it('tidak menghasilkan apa pun dari teks kosong', () => {
    const h = bacaNota([]);
    expect(h).toEqual({ noNota: null, tanggal: null, baris: [], total: null, dilewati: [] });
  });

  it('membaca nota sungguhan dari ujung ke ujung', () => {
    const h = bacaNota([
      'TOKO SINAR JAYA',
      'NOTA RETUR BARANG',
      'No. NRT-4471',
      'Tgl 21/08/2026',
      'Blus Katun XL     2   150.000   300.000',
      'Rok Denim M           225.000   675.000',
      'Kemeja Linen L    1   340.000   340.000',
      'TOTAL                         1.315.000',
      'Hormat kami',
    ]);
    expect(h.noNota).toBe('NRT-4471');
    expect(h.tanggal).toBe('2026-08-21');
    expect(h.baris.map((b) => b.itemName)).toEqual([
      'Blus Katun XL',
      'Rok Denim M',
      'Kemeja Linen L',
    ]);
    expect(h.baris.map((b) => b.qty)).toEqual([2, 3, 1]);
    expect(h.baris[1].asalQty).toBe('dihitung');
    expect(h.total).toBe(1_315_000);
    // Jumlah barisnya cocok dengan total yang tertulis — nota ini sehat.
    expect(h.baris.reduce((s, b) => s + b.amount, 0)).toBe(h.total);
  });
});

describe('cocokTotal', () => {
  /**
   * Diuji tersendiri karena inilah satu-satunya sinyal yang menangkap kegagalan
   * paling berbahaya: satu baris yang dijatuhkan mesin OCR TANPA tanda apa pun.
   *
   * Terbukti pada foto uji yang satu barisnya tertutup tinta: mesinnya
   * menjatuhkan seluruh baris "Rok Denim M 3 225.000 675.000", tidak menaruh
   * apa pun di daftar tinjauan, dan tetap melaporkan keyakinan 93%. Semua
   * sinyal lain bersih. Yang tersisa cuma angka ini.
   */
  const baris = (n: number[]) =>
    n.map((amount) => ({
      itemName: 'x',
      qty: 1,
      price: amount,
      amount,
      asalQty: 'dibaca' as const,
      janggal: false,
    }));

  it('menangkap satu baris yang hilang tanpa jejak', () => {
    expect(cocokTotal(baris([300_000, 340_000]), 1_315_000)).toBe(false);
  });

  it('membenarkan bacaan yang utuh', () => {
    expect(cocokTotal(baris([300_000, 675_000, 340_000]), 1_315_000)).toBe(true);
  });

  it('bertoleransi pembulatan satu rupiah', () => {
    // Selisih satu rupiah yang ditandai hanya melatih orang mengabaikan tandanya.
    expect(cocokTotal(baris([300_000, 675_000, 340_001]), 1_315_000)).toBe(true);
  });

  it('mengembalikan null kalau notanya tidak menuliskan total', () => {
    // Bukan kegagalan — pemeriksaannya memang tidak tersedia untuk nota itu.
    expect(cocokTotal(baris([300_000]), null)).toBeNull();
  });
});
