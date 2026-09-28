/**
 * Lelucon harian di layar masuk.
 *
 * Menggantikan sapaan "Selamat siang, <nama>" atas permintaan pemilik: yang
 * menyambut orang tiap pagi lebih baik sesuatu yang bisa dibaca dan
 * ditertawakan, bukan namanya sendiri.
 *
 * Temanya pekerjaan — gudang, retur, stok opname, piutang, rapat, Senin — dan
 * sebagian sengaja agak gelap. Batasnya: gelap tentang NASIB orang kantor,
 * tidak pernah tentang siapa pun. Tidak ada lelucon soal suku, agama,
 * disabilitas, penampilan, atau orang sungguhan.
 *
 * Satu lelucon per hari KALENDER WIB, sama untuk seluruh tim — supaya bisa jadi
 * bahan obrolan di pantry. Setiap lelucon punya pembuka dan punchline yang
 * ditampilkan bergantian, dengan jeda di antaranya.
 */

export type Lelucon = {
  id: { pembuka: string; punchline: string };
  en: { pembuka: string; punchline: string };
};

export const LELUCON: readonly Lelucon[] = [
  {
    id: { pembuka: "Kenapa selisih stok tidak pernah nol?", punchline: "Karena di suatu tempat, ada satu kaus yang sedang menjalani hidup terbaiknya tanpa kita." },
    en: { pembuka: "Why is the stock variance never zero?", punchline: "Because somewhere out there, one T-shirt is living its best life without us." },
  },
  {
    id: { pembuka: "Senin sebenarnya bukan hari yang buruk.", punchline: "Senin hanya hari Minggu yang gagal bertahan hidup." },
    en: { pembuka: "Monday isn't actually a bad day.", punchline: "It's just a Sunday that didn't survive." },
  },
  {
    id: { pembuka: "Hidup itu seperti retur marketplace.", punchline: "Kita kirim yang terbaik. Yang kembali cuma kardusnya, penyok." },
    en: { pembuka: "Life is like a marketplace return.", punchline: "You send out your best. What comes back is the box, dented." },
  },
  {
    id: { pembuka: "Rapat ini seharusnya bisa jadi email.", punchline: "Email itu seharusnya bisa jadi diam." },
    en: { pembuka: "This meeting could have been an email.", punchline: "That email could have been silence." },
  },
  {
    id: { pembuka: "Kata orang, kerja keras tidak pernah membunuh siapa pun.", punchline: "Tapi kenapa harus kita yang jadi percobaan pertama?" },
    en: { pembuka: "They say hard work never killed anyone.", punchline: "But why should we be the first test case?" },
  },
  {
    id: { pembuka: "Orang bilang uang tidak bisa membeli kebahagiaan.", punchline: "Mereka belum pernah melihat wajah tim keuangan saat mutasi rekening cocok dengan BKM." },
    en: { pembuka: "People say money can't buy happiness.", punchline: "They've never seen finance's faces when the bank statement matches the receipts." },
  },
  {
    id: { pembuka: "Saya punya hubungan yang sehat dengan pekerjaan.", punchline: "Kami saling mengabaikan sampai jam empat sore, lalu panik bersama." },
    en: { pembuka: "I have a healthy relationship with my work.", punchline: "We ignore each other until four p.m., then panic together." },
  },
  {
    id: { pembuka: "Ukuran S habis. M habis. L habis.", punchline: "Tinggal XXL dan harapan. Dua-duanya kebesaran." },
    en: { pembuka: "Size S: sold out. M: sold out. L: sold out.", punchline: "All that's left is XXL and hope. Both are too big." },
  },
  {
    id: { pembuka: "'Ini cuma revisi kecil,' kata klien.", punchline: "Kalimat terakhir yang didengar desainer itu sebelum ia menjadi legenda." },
    en: { pembuka: "\"It's just a small revision,\" said the client.", punchline: "The last words that designer heard before becoming a legend." },
  },
  {
    id: { pembuka: "Kenapa printer kantor selalu rusak saat paling dibutuhkan?", punchline: "Karena ia juga karyawan di sini, dan ia juga sudah lelah." },
    en: { pembuka: "Why does the office printer always break when you need it most?", punchline: "Because it works here too, and it's tired as well." },
  },
  {
    id: { pembuka: "Hari ini saya akan sangat produktif.", punchline: "— kata saya kemarin. Dan kemarin lusa. Dan sepanjang 2019." },
    en: { pembuka: "Today I'm going to be extremely productive.", punchline: "— I said yesterday. And the day before. And all of 2019." },
  },
  {
    id: { pembuka: "Saya tidak takut mati.", punchline: "Saya takut mati sebelum stok opname selesai, lalu disuruh menghitung ulang di alam sana." },
    en: { pembuka: "I'm not afraid of dying.", punchline: "I'm afraid of dying mid stock count and being told to recount in the afterlife." },
  },
  {
    id: { pembuka: "Pesanan masuk tiga ratus dalam satu jam.", punchline: "Tim gudang tidak panik. Mereka hanya menatap dinding dengan sangat, sangat tenang." },
    en: { pembuka: "Three hundred orders came in within an hour.", punchline: "The warehouse didn't panic. They just stared at the wall, very, very calmly." },
  },
  {
    id: { pembuka: "Nasihat karier terbaik yang pernah saya terima:", punchline: "\"Jangan pernah bilang kamu bisa Excel.\"" },
    en: { pembuka: "The best career advice I ever got:", punchline: "\"Never admit you know Excel.\"" },
  },
  {
    id: { pembuka: "Saya tidak menunda pekerjaan.", punchline: "Saya memberinya waktu untuk merenung apakah ia benar-benar perlu dikerjakan." },
    en: { pembuka: "I don't procrastinate.", punchline: "I give the task time to reflect on whether it really needs doing." },
  },
  {
    id: { pembuka: "Kenapa kopi kantor rasanya pahit?", punchline: "Karena ia tahu apa yang menunggu kita setelah diminum." },
    en: { pembuka: "Why does office coffee taste so bitter?", punchline: "Because it knows what's waiting for us after we drink it." },
  },
  {
    id: { pembuka: "Gaji saya sudah naik.", punchline: "Sayangnya harga semua hal lain naik duluan, dan mereka tidak menunggu saya." },
    en: { pembuka: "I finally got a raise.", punchline: "Unfortunately everything else got one first, and didn't wait for me." },
  },
  {
    id: { pembuka: "Jangan pernah bilang \"tinggal sedikit lagi\" di depan Excel.", punchline: "Ia mendengar. Dan ia akan menutup diri tanpa menyimpan." },
    en: { pembuka: "Never say \"almost done\" in front of Excel.", punchline: "It hears you. And it will close without saving." },
  },
  {
    id: { pembuka: "Sudah cukup lama saya bekerja di sini.", punchline: "Cukup lama untuk tahu bahwa \"segera\" berarti kapan saja, kecuali segera." },
    en: { pembuka: "I've worked here long enough.", punchline: "Long enough to know \"ASAP\" means any time except soon." },
  },
  {
    id: { pembuka: "Kata sandi saya diganti setiap tiga bulan.", punchline: "Ingatan saya tidak pernah diganti. Di situlah masalahnya." },
    en: { pembuka: "My password gets changed every three months.", punchline: "My memory never does. That's the problem." },
  },
  {
    id: { pembuka: "Motivasi pagi: setiap hari adalah kesempatan baru.", punchline: "Untuk mengulangi kesalahan kemarin, kali ini dengan lebih percaya diri." },
    en: { pembuka: "Morning motivation: every day is a new chance.", punchline: "To repeat yesterday's mistakes, this time with more confidence." },
  },
  {
    id: { pembuka: "Kenapa tim sales selalu optimis?", punchline: "Karena target bulan ini pasti tercapai. Target bulan lalu juga pasti, katanya, waktu itu." },
    en: { pembuka: "Why is the sales team always optimistic?", punchline: "This month's target will definitely be hit. So was last month's, they said, last month." },
  },
  {
    id: { pembuka: "Lembur itu bukan pilihan.", punchline: "Lembur adalah gaya hidup yang dipilihkan deadline untukmu." },
    en: { pembuka: "Overtime isn't a choice.", punchline: "It's a lifestyle your deadline chose for you." },
  },
  {
    id: { pembuka: "Pekerjaan paling berbahaya di kantor ini?", punchline: "Membalas \"oke siap\" di grup sebelum membaca pesannya sampai habis." },
    en: { pembuka: "The most dangerous job in this office?", punchline: "Replying \"on it!\" in the group chat before reading the whole message." },
  },
  {
    id: { pembuka: "Hidup ini singkat.", punchline: "Tapi tidak sesingkat rapat yang dijanjikan \"lima menit saja\"." },
    en: { pembuka: "Life is short.", punchline: "Not as short as the meeting that promised \"just five minutes\"." },
  },
  {
    id: { pembuka: "Saya tidak butuh terapi.", punchline: "Saya cuma butuh semua angka di laporan ini cocok. Bedanya tipis." },
    en: { pembuka: "I don't need therapy.", punchline: "I just need every number in this report to reconcile. Same thing, really." },
  },
  {
    id: { pembuka: "Katanya AI akan menggantikan pekerjaan kita.", punchline: "Silakan mulai dari rapat hari Senin. Kami tidak akan protes." },
    en: { pembuka: "They say AI will replace our jobs.", punchline: "Please start with the Monday meeting. Nobody will object." },
  },
  {
    id: { pembuka: "Kenapa jam tiga sore terasa paling panjang?", punchline: "Karena kopi pagi sudah pensiun, dan kopi sore belum dilantik." },
    en: { pembuka: "Why does three p.m. last the longest?", punchline: "The morning coffee has retired, and the afternoon one hasn't been sworn in." },
  },
  {
    id: { pembuka: "Tips produktif: kerjakan yang paling menakutkan di pagi hari.", punchline: "Jadi saya membuka rekap piutang jam tujuh. Sisa hari itu saya habiskan untuk pulih." },
    en: { pembuka: "Productivity tip: do the scariest task first thing in the morning.", punchline: "So I opened the receivables report at seven. I spent the rest of the day recovering." },
  },
  {
    id: { pembuka: "Fashion itu berputar; yang lama pasti kembali.", punchline: "Sama seperti barang yang kita kira sudah laku minggu lalu." },
    en: { pembuka: "Fashion is a cycle; the old always comes back.", punchline: "Just like the stock we thought sold last week." },
  },
];

/** WIB = UTC+7, tanpa musim panas. Hari kalender WIB ke-n sejak 1970. */
function hariWib(saat: Date): number {
  return Math.floor((saat.getTime() + 7 * 3_600_000) / 86_400_000);
}

/** Lelucon hari ini: berganti tepat pukul 00.00 WIB, sama untuk semua orang. */
export function leluconHariIni(saat: Date = new Date()): Lelucon {
  const n = LELUCON.length;
  return LELUCON[((hariWib(saat) % n) + n) % n];
}

/**
 * Berapa lama sebuah kalimat perlu tampil supaya sempat dibaca dengan tenang.
 *
 * Sekitar 18 huruf per detik — lebih lambat dari kecepatan membaca biasa,
 * karena ini dibaca sekali lewat dan orang perlu sedetik untuk "sampai" di
 * punchline-nya. Dibatasi supaya kalimat pendek tidak lewat terlalu cepat dan
 * yang panjang tidak menahan orang terlalu lama.
 */
export function waktuBacaMs(teks: string): number {
  return Math.min(6500, Math.max(2200, 1200 + teks.length * 55));
}

/** Kartu cerita muncul sebelum kata pertama; lihat `layar-masuk.module.css`. */
export const CERITA_MASUK_MS = 560;
/** Jeda antar-kata saat pembuka muncul kata demi kata. */
export const JEDA_KATA_MS = 65;

/**
 * Lama dua "halaman" cerita: pembuka, lalu punchline.
 *
 * Pembuka baru mulai terbaca setelah kartunya muncul dan kata terakhirnya
 * mendarat, jadi keduanya ditambahkan di depan waktu bacanya. Punchline diberi
 * napas tambahan untuk tertawa — dan untuk reaksi yang melayang.
 */
export function durasiCerita(teks: { pembuka: string; punchline: string }): [number, number] {
  const kata = teks.pembuka.trim().split(/\s+/).length;
  return [
    CERITA_MASUK_MS + kata * JEDA_KATA_MS + waktuBacaMs(teks.pembuka),
    waktuBacaMs(teks.punchline) + 1200,
  ];
}
