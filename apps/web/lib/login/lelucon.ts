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
  {
    id: { pembuka: "Kenapa lakban selalu habis tepat saat paket menumpuk?", punchline: "Karena lakban juga butuh me time." },
    en: { pembuka: "Why does the tape run out exactly when the parcels pile up?", punchline: "Because tape needs me-time too." },
  },
  {
    id: { pembuka: "Kurir datang jam 16.59.", punchline: "Tim packing tidak tahu harus bersyukur atau menangis, jadi mereka melakukan keduanya sambil menyegel kardus." },
    en: { pembuka: "The courier shows up at 4:59 p.m.", punchline: "Packing can't decide whether to be grateful or cry, so they do both while sealing boxes." },
  },
  {
    id: { pembuka: "Resi dicetak, barang dibungkus, kurir sudah di depan.", punchline: "Lalu pembeli membatalkan pesanan. Kardus itu sekarang mempertanyakan arti hidupnya." },
    en: { pembuka: "Label printed, item packed, courier at the door.", punchline: "Then the buyer cancels. That box is now questioning the meaning of its life." },
  },
  {
    id: { pembuka: "Review bintang satu: \"Barang bagus, pengiriman cepat, penjual ramah.\"", punchline: "Kami masih mencari tahu apa salah kami." },
    en: { pembuka: "One-star review: \"Great product, fast shipping, friendly seller.\"", punchline: "We're still trying to work out what we did wrong." },
  },
  {
    id: { pembuka: "Flash sale jam dua belas malam.", punchline: "Servernya bertahan. Tim admin tidak." },
    en: { pembuka: "Midnight flash sale.", punchline: "The servers survived. The admin team did not." },
  },
  {
    id: { pembuka: "Pesan pembeli jam tiga pagi: \"P\"", punchline: "Tidak ada kata lain. Hanya \"P\". Sejak malam itu, hidup kami tidak pernah sama." },
    en: { pembuka: "A buyer's message at 3 a.m.: \"P\"", punchline: "Nothing else. Just \"P\". Our lives have never been the same." },
  },
  {
    id: { pembuka: "Live jualan selama dua jam.", punchline: "Penonton: tiga. Yang beli: nol. Yang minta giveaway: tiga." },
    en: { pembuka: "A two-hour selling livestream.", punchline: "Viewers: three. Buyers: zero. Giveaway requests: three." },
  },
  {
    id: { pembuka: "Ongkirnya lebih mahal dari barangnya.", punchline: "Pembeli tetap checkout. Kami tidak mengerti, dan kami memilih untuk tidak bertanya." },
    en: { pembuka: "Shipping costs more than the product.", punchline: "The buyer checks out anyway. We don't understand it, and we've chosen not to ask." },
  },
  {
    id: { pembuka: "Paket dikembalikan dengan catatan: \"warna tidak sesuai foto.\"", punchline: "Fotonya jujur. Yang tidak jujur adalah layar ponsel dengan kecerahan seratus persen." },
    en: { pembuka: "Returned with a note: \"colour doesn't match the photo.\"", punchline: "The photo was honest. The phone screen at 100% brightness was not." },
  },
  {
    id: { pembuka: "Pelanggan minta foto asli produknya.", punchline: "Kami kirim foto asli. \"Kok beda sama fotonya, Kak?\" Itu fotonya, Kak." },
    en: { pembuka: "A customer asks for a real photo of the product.", punchline: "We send one. \"Why doesn't it look like the photo?\" That is the photo." },
  },
  {
    id: { pembuka: "Deskripsi produk sudah ditulis selengkap mungkin.", punchline: "Tidak ada yang membacanya. Deskripsi produk adalah surat cinta yang tidak pernah dibuka." },
    en: { pembuka: "The product description is as complete as it can be.", punchline: "Nobody reads it. A product description is a love letter no one ever opens." },
  },
  {
    id: { pembuka: "Target penjualan 12.12 sudah ditetapkan.", punchline: "Dengan penuh optimisme, sedikit data, dan banyak sekali harapan." },
    en: { pembuka: "The 12.12 sales target has been set.", punchline: "With great optimism, a little data and an awful lot of hope." },
  },
  {
    id: { pembuka: "Pesanan grosir 500 potong datang tiba-tiba.", punchline: "Gudang: \"Stoknya cuma 480.\" Sales: \"Bisa diakali?\" Semesta: \"Tidak.\"" },
    en: { pembuka: "A surprise wholesale order for 500 pieces.", punchline: "Warehouse: \"We have 480.\" Sales: \"Can we make it work?\" The universe: \"No.\"" },
  },
  {
    id: { pembuka: "Rapat dimulai jam sembilan tepat.", punchline: "Kalimat itu terakhir kali benar pada tahun 2016." },
    en: { pembuka: "The meeting starts at nine sharp.", punchline: "That sentence was last true in 2016." },
  },
  {
    id: { pembuka: "\"Bisa dengar suara saya?\"", punchline: "Separuh umur setiap rapat online habis untuk menjawab pertanyaan itu." },
    en: { pembuka: "\"Can you hear me?\"", punchline: "Half of every online meeting's lifespan goes to answering that question." },
  },
  {
    id: { pembuka: "Seseorang lupa mematikan mikrofon.", punchline: "Sekarang seluruh kantor tahu ia makan kerupuk sepanjang presentasi direktur." },
    en: { pembuka: "Someone forgot to mute.", punchline: "Now the whole office knows they ate crackers through the director's entire presentation." },
  },
  {
    id: { pembuka: "Agenda rapat: membahas kenapa rapat kita terlalu banyak.", punchline: "Rapat lanjutannya dijadwalkan minggu depan." },
    en: { pembuka: "Meeting agenda: why we have too many meetings.", punchline: "A follow-up meeting has been scheduled for next week." },
  },
  {
    id: { pembuka: "Grup WhatsApp kantor punya 47 anggota.", punchline: "Yang membaca: 47. Yang membalas: satu. Itu pun stiker." },
    en: { pembuka: "The office group chat has 47 members.", punchline: "Read by: 47. Replied: one. And it was a sticker." },
  },
  {
    id: { pembuka: "\"Tolong dicek ya.\"", punchline: "Tiga kata yang bisa berarti lima menit atau lima hari, tergantung siapa yang mengirimnya." },
    en: { pembuka: "\"Please take a look.\"", punchline: "Three words that mean five minutes or five days, depending on who sent them." },
  },
  {
    id: { pembuka: "Subjek email: \"Re: Re: Fwd: Re: URGENT\"", punchline: "Tidak ada yang ingat lagi apa yang urgent. Tapi semua orang tetap panik." },
    en: { pembuka: "Email subject: \"Re: Re: Fwd: Re: URGENT\"", punchline: "Nobody remembers what was urgent anymore. Everyone panics anyway." },
  },
  {
    id: { pembuka: "Di kantor ini, \"sebentar\" adalah satuan waktu.", punchline: "Nilainya antara lima menit dan selamanya." },
    en: { pembuka: "In this office, \"a sec\" is a unit of time.", punchline: "Its value ranges from five minutes to forever." },
  },
  {
    id: { pembuka: "Wi-Fi kantor mati.", punchline: "Untuk pertama kalinya tahun ini kami saling mengobrol. Ternyata kami semua menyenangkan. Lalu Wi-Fi-nya menyala lagi." },
    en: { pembuka: "The office Wi-Fi went down.", punchline: "For the first time this year, we talked to each other. Turns out we're all lovely. Then the Wi-Fi came back." },
  },
  {
    id: { pembuka: "Ada kue di pantry.", punchline: "Tujuh menit kemudian, kue itu tinggal kenangan dan satu remah yang tidak ada yang berani mengambil." },
    en: { pembuka: "There's cake in the pantry.", punchline: "Seven minutes later it's a memory, plus one crumb nobody dares to take." },
  },
  {
    id: { pembuka: "AC kantor punya dua mode.", punchline: "Kutub Utara dan sauna. Tidak ada tombol untuk manusia." },
    en: { pembuka: "The office AC has two modes.", punchline: "North Pole and sauna. There is no setting for humans." },
  },
  {
    id: { pembuka: "Kursi kantor saya berderit setiap kali saya bergerak.", punchline: "Sekarang semua orang tahu setiap kali saya menyerah pada hidup." },
    en: { pembuka: "My office chair creaks every time I move.", punchline: "Now everyone knows each time I give up on life." },
  },
  {
    id: { pembuka: "Piutang itu seperti janji manis.", punchline: "Mudah dibuat, susah ditagih, dan selalu \"minggu depan pasti\"." },
    en: { pembuka: "Receivables are like sweet promises.", punchline: "Easy to make, hard to collect, and always \"definitely next week\"." },
  },
  {
    id: { pembuka: "\"Transfernya sudah, Kak. Dicek saja.\"", punchline: "Sudah kami cek tiga kali. Rekening kami tetap tenang seperti danau tanpa angin." },
    en: { pembuka: "\"I've already transferred it. Just check.\"", punchline: "We checked three times. Our account remains as calm as a windless lake." },
  },
  {
    id: { pembuka: "Laporan keuangan akhirnya balance.", punchline: "Tidak ada yang tahu kenapa, dan tidak ada yang berani menyentuhnya lagi." },
    en: { pembuka: "The financial report finally balances.", punchline: "Nobody knows why, and nobody dares touch it again." },
  },
  {
    id: { pembuka: "Selisihnya cuma satu rupiah.", punchline: "Tim keuangan akan menemukannya. Mereka punya waktu, tekad, dan persediaan kopi yang tidak terbatas." },
    en: { pembuka: "The difference is just one rupiah.", punchline: "Finance will find it. They have time, determination and an unlimited supply of coffee." },
  },
  {
    id: { pembuka: "Budget kuartal ini sudah disetujui.", punchline: "Lalu dipotong. Lalu dipotong lagi. Sekarang budget itu hanya sebuah perasaan." },
    en: { pembuka: "This quarter's budget has been approved.", punchline: "Then cut. Then cut again. Now the budget is just a feeling." },
  },
  {
    id: { pembuka: "Sampel pertama selalu sempurna.", punchline: "Produksi massal kemudian mengajarkan kita arti kata \"kurang lebih\"." },
    en: { pembuka: "The first sample is always perfect.", punchline: "Mass production then teaches us the meaning of \"more or less\"." },
  },
  {
    id: { pembuka: "Warna di layar: sage green.", punchline: "Warna di kain: hijau yang sedang ragu-ragu." },
    en: { pembuka: "Colour on screen: sage green.", punchline: "Colour on the fabric: a green having second thoughts." },
  },
  {
    id: { pembuka: "Desainer: \"Kita pakai font yang clean saja.\"", punchline: "Empat jam kemudian, masih memilih di antara dua font yang ternyata sama." },
    en: { pembuka: "Designer: \"Let's just use a clean font.\"", punchline: "Four hours later, still choosing between two fonts that turn out to be identical." },
  },
  {
    id: { pembuka: "Fotografer bilang ini foto terakhir.", punchline: "Itu foto ke-347. Masih ada \"satu lagi dari sudut sini\"." },
    en: { pembuka: "The photographer says this is the last shot.", punchline: "It's shot number 347. There's still \"one more from this angle\"." },
  },
  {
    id: { pembuka: "Tren fashion berganti setiap dua minggu.", punchline: "Stok kita berganti setiap dua bulan. Di situlah letak tragedinya." },
    en: { pembuka: "Fashion trends change every two weeks.", punchline: "Our stock changes every two months. Therein lies the tragedy." },
  },
  {
    id: { pembuka: "Kaus polos hitam: paling laku, paling membosankan, paling jarang dipuji.", punchline: "Kaus itu adalah kita semua." },
    en: { pembuka: "The plain black tee: best seller, most boring, least praised.", punchline: "That T-shirt is all of us." },
  },
  {
    id: { pembuka: "Di tabel ukuran tertulis \"All size\".", punchline: "Kenyataan di lapangan: \"Some size\"." },
    en: { pembuka: "The size chart says \"One size fits all\".", punchline: "Reality says \"One size fits some\"." },
  },
  {
    id: { pembuka: "Model tersenyum manis di depan kamera.", punchline: "Di belakang kamera: tiga orang memegang kipas, satu memegang jepitan, dan satu lagi mempertanyakan pilihan kariernya." },
    en: { pembuka: "The model smiles sweetly for the camera.", punchline: "Behind it: three people holding fans, one holding clips, and one questioning their career choices." },
  },
  {
    id: { pembuka: "Mesin jahit berdengung seperti biasa.", punchline: "Lalu diam. Seisi lantai produksi menahan napas seperti sedang menonton film horor." },
    en: { pembuka: "The sewing machine hums as usual.", punchline: "Then silence. The whole production floor holds its breath like it's watching a horror film." },
  },
  {
    id: { pembuka: "Kenapa QC selalu menemukan cacat?", punchline: "Karena itu tugasnya. Dan karena itu juga, semua jahitan takut padanya." },
    en: { pembuka: "Why does QC always find a defect?", punchline: "It's the job. And that's why every seam fears them." },
  },
  {
    id: { pembuka: "Sales ditanya kenapa target tidak tercapai.", punchline: "Jawabannya selalu cuaca. Hujan, panas, mendung, cerah — semuanya salah cuaca." },
    en: { pembuka: "Sales is asked why the target was missed.", punchline: "The answer is always the weather. Rain, heat, clouds, sunshine — all the weather's fault." },
  },
  {
    id: { pembuka: "GPS bilang tokonya tinggal dua menit lagi.", punchline: "Itu empat puluh menit yang lalu. Rupanya GPS saya juga sales." },
    en: { pembuka: "The GPS says the store is two minutes away.", punchline: "That was forty minutes ago. Turns out my GPS is in sales too." },
  },
  {
    id: { pembuka: "Toko langganan bilang, \"Nanti ya, pemiliknya lagi keluar.\"", punchline: "Pemiliknya selalu keluar. Kami mulai curiga pemiliknya hanya legenda." },
    en: { pembuka: "The regular store says, \"Come back later, the owner's out.\"", punchline: "The owner is always out. We're starting to suspect the owner is a legend." },
  },
  {
    id: { pembuka: "Konsinyasi itu seperti menitipkan anak.", punchline: "Dititipkan penuh harapan, ditanya kabarnya tiap bulan, dan jawabannya selalu \"belum laku\"." },
    en: { pembuka: "Consignment is like leaving your child with relatives.", punchline: "Dropped off full of hope, checked on monthly, and the answer is always \"not taken yet\"." },
  },
  {
    id: { pembuka: "Cuti sudah disetujui.", punchline: "Laptop tetap dibawa, \"untuk jaga-jaga\". Liburan pun berubah jadi rapat dengan pemandangan pantai." },
    en: { pembuka: "Leave approved.", punchline: "The laptop comes along \"just in case\". The holiday becomes a meeting with a beach view." },
  },
  {
    id: { pembuka: "Gajian tinggal tiga hari lagi.", punchline: "Saldo saya sudah pamit sejak minggu lalu." },
    en: { pembuka: "Payday is three days away.", punchline: "My balance said goodbye last week." },
  },
  {
    id: { pembuka: "Tanggal tua itu nyata.", punchline: "Ia datang setiap bulan, lebih tepat waktu dari rapat mana pun." },
    en: { pembuka: "The end-of-month crunch is real.", punchline: "It arrives every month, more punctual than any meeting." },
  },
  {
    id: { pembuka: "Saya sudah bekerja keras sepanjang minggu.", punchline: "Hasilnya: sekarang hari Jumat. Itu saja pencapaiannya, dan saya bangga." },
    en: { pembuka: "I've worked hard all week.", punchline: "The result: it's Friday. That's the whole achievement, and I'm proud." },
  },
  {
    id: { pembuka: "Jumat sore adalah waktu paling produktif.", punchline: "Untuk merencanakan akhir pekan." },
    en: { pembuka: "Friday afternoon is the most productive time.", punchline: "For planning the weekend." },
  },
  {
    id: { pembuka: "Seseorang menulis \"Selamat pagi\" di grup jam 10.30.", punchline: "Tidak ada yang berani mengoreksinya. Kami semua pernah menjadi orang itu." },
    en: { pembuka: "Someone posts \"Good morning\" in the group at 10:30.", punchline: "Nobody corrects them. We've all been that person." },
  },
  {
    id: { pembuka: "Terjebak macet tiga jam.", punchline: "Sampai kantor, rapatnya dibatalkan. Bertahan hidup di jalan adalah satu-satunya pencapaian hari ini." },
    en: { pembuka: "Three hours stuck in traffic.", punchline: "Arrived to find the meeting cancelled. Surviving the commute is today's only achievement." },
  },
  {
    id: { pembuka: "Kerja dari rumah itu enak.", punchline: "Sampai kamu sadar rumahmu sekarang kantor, dan kasurmu ruang rapat." },
    en: { pembuka: "Working from home is great.", punchline: "Until you realise your home is now the office and your bed is a meeting room." },
  },
  {
    id: { pembuka: "\"Saya mau resign.\"", punchline: "— kata saya setiap Senin jam sembilan. Setiap Jumat jam lima, saya berubah pikiran." },
    en: { pembuka: "\"I'm going to quit.\"", punchline: "— I say every Monday at nine. Every Friday at five, I change my mind." },
  },
  {
    id: { pembuka: "Lembur sampai jam sepuluh malam lagi.", punchline: "Satpam kantor sekarang tahu nama saya, nama kucing saya, dan semua masalah hidup saya." },
    en: { pembuka: "Overtime until ten p.m. again.", punchline: "The security guard now knows my name, my cat's name and all my life problems." },
  },
  {
    id: { pembuka: "KPI kita naik sepuluh persen.", punchline: "Konsumsi kopi kita naik empat puluh persen. Ada korelasinya, tapi tidak ada yang mau menelitinya." },
    en: { pembuka: "Our KPIs rose ten percent.", punchline: "Our coffee intake rose forty. There's a correlation, but nobody wants to study it." },
  },
  {
    id: { pembuka: "Kalender saya rapi sekali.", punchline: "Berwarna-warni, penuh rapat, dan tidak ada satu slot pun untuk benar-benar bekerja." },
    en: { pembuka: "My calendar is beautifully organised.", punchline: "Colour-coded, full of meetings, and not a single slot for actual work." },
  },
  {
    id: { pembuka: "To-do list saya berisi tiga puluh hal.", punchline: "Saya menambahkan \"bikin to-do list\" supaya bisa mencoret satu." },
    en: { pembuka: "My to-do list has thirty items.", punchline: "I added \"make a to-do list\" just so I could cross one off." },
  },
  {
    id: { pembuka: "Makan siang jam dua belas. Rapat jam 12.05.", punchline: "Hari ini, makan siang saya adalah harapan." },
    en: { pembuka: "Lunch at noon. Meeting at 12:05.", punchline: "Today, my lunch is hope." },
  },
  {
    id: { pembuka: "Laptop saya: \"Memperbarui 1 dari 47\".", punchline: "Tepat lima menit sebelum presentasi. Ia tahu. Ia selalu tahu." },
    en: { pembuka: "My laptop: \"Installing update 1 of 47\".", punchline: "Five minutes before my presentation. It knows. It always knows." },
  },
  {
    id: { pembuka: "Saya tidak lupa membalas pesanmu.", punchline: "Saya membacanya, membalasnya di kepala, lalu yakin sudah terkirim." },
    en: { pembuka: "I didn't forget to reply to you.", punchline: "I read it, replied in my head, and was sure I'd sent it." },
  },
  {
    id: { pembuka: "ERP baru sudah terpasang, lengkap dengan dasbor canggih.", punchline: "Pertanyaan pertama semua orang: \"Cara ekspor ke Excel gimana?\"" },
    en: { pembuka: "The new ERP is live, fancy dashboards and all.", punchline: "Everyone's first question: \"How do I export this to Excel?\"" },
  },
  {
    id: { pembuka: "Karyawan baru bertanya di mana SOP-nya.", punchline: "Kami saling pandang. Hari itu lahirlah SOP pertama kami: \"Tanya yang paling lama kerja di sini.\"" },
    en: { pembuka: "A new hire asks where the SOP is.", punchline: "We looked at each other. That day our first SOP was born: \"Ask whoever's been here longest.\"" },
  },
  {
    id: { pembuka: "File saya bernama \"Final\".", punchline: "Lalu \"Final_revisi\", \"Final_revisi2\", \"Final_BENERAN\", dan \"Final_BENERAN_pakai_ini\"." },
    en: { pembuka: "My file is called \"Final\".", punchline: "Then \"Final_v2\", \"Final_v2_edit\", \"Final_REAL\" and \"Final_REAL_use_this\"." },
  },
  {
    id: { pembuka: "Klien minta desain yang simpel tapi mewah, minimalis tapi ramai.", punchline: "Desainernya sekarang tinggal di gunung dan tidak menerima tamu." },
    en: { pembuka: "The client wants it simple but luxurious, minimalist but busy.", punchline: "The designer now lives on a mountain and accepts no visitors." },
  },
  {
    id: { pembuka: "Senin pagi: kopi pertama. Kopi kedua. Kopi ketiga.", punchline: "Senin siang: jantung berdebar-debar, dan bukan karena cinta." },
    en: { pembuka: "Monday morning: first coffee. Second. Third.", punchline: "Monday noon: heart racing, and not because of love." },
  },
  {
    id: { pembuka: "Presentasi disiapkan semalaman.", punchline: "Proyektornya menolak tersambung. Proyektor tidak pernah benar-benar ingin kita sukses." },
    en: { pembuka: "The presentation took all night to prepare.", punchline: "The projector refuses to connect. Projectors never truly want us to succeed." },
  },
  {
    id: { pembuka: "Kantor mengadakan team building.", punchline: "Berhasil: kami bersatu melawan musuh bersama, yaitu acara team building itu sendiri." },
    en: { pembuka: "The office held a team-building event.", punchline: "It worked: we united against a common enemy — the team-building event itself." },
  },
  {
    id: { pembuka: "Semua orang bilang, \"Nanti saya follow up.\"", punchline: "Follow up adalah dunia paralel tempat janji-janji kantor pergi dan tidak pernah kembali." },
    en: { pembuka: "Everyone says, \"I'll follow up.\"", punchline: "\"Follow up\" is a parallel universe where office promises go and never return." },
  },
  {
    id: { pembuka: "Hari ini libur nasional.", punchline: "Grup kantor: \"Maaf ganggu, cuma mau tanya satu hal kok.\"" },
    en: { pembuka: "Today is a public holiday.", punchline: "Office group chat: \"Sorry to bother you, just one quick question.\"" },
  },
  {
    id: { pembuka: "Bos minta laporannya secepatnya.", punchline: "Kami kirim dalam satu jam. Bos membacanya dua minggu kemudian." },
    en: { pembuka: "The boss wants the report ASAP.", punchline: "We sent it within an hour. The boss read it two weeks later." },
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
