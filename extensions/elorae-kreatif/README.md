# Elorae Kreatif — Pantau KOL (ekstensi Chrome, uji coba)

Ekstensi ini membuka halaman profil dan video TikTok KOL yang diminta Elorae, membaca angkanya
(pengikut, total like, jumlah video, serta views/like/komentar/share/save per video), lalu
mengirimkannya ke Elorae. Elorae yang menghitung ER dan menampilkannya di Kreatif → Pemantauan.
Selain berjalan otomatis, ekstensi juga menampilkan panel kecil di pojok kanan bawah setiap
halaman profil/video TikTok yang Anda buka sendiri, dengan tombol **Simpan ke Elorae**.

Uji coba ini hanya untuk TikTok. Angka yang tidak terbaca tidak pernah dikirim sebagai 0 —
pemeriksaan itu dicatat gagal (TIDAK TERBACA) dan dicoba lagi.

## Risiko — baca dulu

Syarat layanan TikTok melarang pengambilan data otomatis, jadi akun TikTok yang dipakai bisa
dibatasi atau diblokir. Karena itu pakai **profil Chrome tersendiri** dan **akun TikTok
tersendiri** (jangan akun pribadi atau akun toko), sebaiknya juga koneksi internet tersendiri.
Pemeriksaan otomatis hanya berjalan selama komputer dan Chrome menyala pada jam kerja
(bawaan 08.00–17.00 WIB). Bila TikTok mengubah halamannya, ekstensi bisa berhenti membaca angka
sampai diperbarui.

## Memasang

1. Buat profil Chrome baru khusus untuk pemantauan (ikon profil di kanan atas Chrome → Tambah).
   Di profil itu, masuk ke TikTok dengan akun TikTok khusus pemantauan.
2. Di profil yang sama, buka `chrome://extensions`.
3. Nyalakan **Mode pengembang** (kanan atas).
4. Klik **Muat ekstensi yang belum dikemas**, lalu pilih folder `extensions/elorae-kreatif`.
5. Klik ikon teka-teki di toolbar Chrome dan sematkan **Elorae Kreatif** supaya ikonnya selalu
   terlihat.

Setelah memperbarui berkas ekstensi, klik tombol muat ulang (panah melingkar) pada kartu ekstensi
di `chrome://extensions`, lalu muat ulang tab TikTok yang terbuka.

## Menyambungkan ke Elorae

1. Di Elorae, buka **Kreatif → Pemantauan → Sambungkan perangkat**, lalu salin kode sambungnya
   (8 huruf/angka, berlaku 15 menit, sekali pakai).
2. Klik ikon Elorae Kreatif di Chrome. Isi **Alamat Elorae** (`http://localhost:3000` untuk uji
   coba di komputer ini, atau `https://elorae.cloud`) dan **Kode sambung**, lalu klik
   **Sambungkan**.
3. Setelah tersambung, nyalakan **Pemantauan otomatis**.

Popup menampilkan jumlah pemeriksaan hari ini (selesai, gagal, kuota, sisa), keadaan
(berjalan, di luar jam kerja, dijeda, kuota habis, antrean kosong, istirahat), waktu pemeriksaan
berikutnya, dan masalah terakhir. **Putuskan** menghapus sambungan di ekstensi sekaligus mencabut
perangkatnya di Elorae. Kalau Elorae sedang tidak terjangkau, popup memberi tahu; cabut perangkatnya
dari Elorae → Kreatif → Pemantauan.

## Cara kerjanya

**Cek cepat (v0.9.0) — biarkan satu tab tiktok.com terbuka di Chrome ini.** Bila ada tab
www.tiktok.com yang Anda buka sendiri (boleh disematkan/pin, boleh tidak sedang dilihat), ekstensi
mengambil halaman setiap tugas DARI tab itu tanpa membuka tab baru: sekitar 2 detik per video, dan
satu putaran mengerjakan tugas terus-menerus (paling lama 10 menit, lalu dilanjutkan). 200 video
selesai dalam beberapa menit. Tab yang Anda buka sudah lolos pemeriksaan keamanan TikTok, sedangkan
tab latar baru tidak pernah lolos. Sesudah ekstensi diperbarui, muat ulang tab TikTok itu sekali.
Bila tab itu sendiri kena pemeriksaan, pemantauan berhenti sebentar dengan alasan "Diblokir TikTok":
muat ulang tab TikTok (selesaikan puzzle bila muncul), lalu tekan Cek sekarang di Elorae. Popup
menyebut apakah cek cepat sedang aktif.

Tanpa tab TikTok yang terbuka, ekstensi memakai cara lama di bawah.

Setiap menit ekstensi bertanya ke Elorae apakah ada tugas. Bila ada, ekstensi membuka halaman
TikTok itu di tab latar baru (tidak merebut layar Anda, suaranya dibisukan), menunggu angkanya
terbaca, mengirim hasilnya, lalu menutup tab. Di antara tugas ada jeda acak (bawaan 15–40 detik)
dan istirahat (bawaan 5–10 menit kira-kira setiap 45 menit). Kuota, jam kerja, jeda dan istirahat
diatur di Elorae. Satu tugas dikerjakan satu per satu; bila Elorae sedang tidak terjangkau, hasil
yang belum terkirim disimpan dan dikirim ulang (paling lama 30 menit).

## Bila pemantauan berhenti

- **Captcha** — TikTok meminta verifikasi. Buka TikTok di profil Chrome pemantauan ini,
  selesaikan captcha-nya, lalu tekan **Lanjutkan** pada perangkat ini di Elorae → Kreatif →
  Pemantauan. Ekstensi tidak melanjutkan sendiri sebelum Elorae melepas jedanya (Elorae juga
  melepasnya otomatis setelah waktu jeda otomatis, bawaan 60 menit).
- **Login** — TikTok meminta masuk. Masuk dengan akun TikTok khusus pemantauan di profil Chrome
  ini, lalu tekan **Lanjutkan** di Elorae.
- **Diblokir TikTok** — TikTok menjawab tab otomatis dengan halaman pemeriksaan keamanan, di
  halaman video maupun profil. Tugasnya langsung gagal (tidak diulang tiga kali, karena mengulang
  hanya memperdalam blokirnya) dan ekstensi berhenti selama jeda otomatis (bawaan 60 menit).
  **Cek sekarang** di Performa video mencoba lagi saat itu juga. Angka video itu tetap bisa masuk
  lewat panel: buka videonya di Chrome lalu tekan **Simpan ke Elorae**.
- **Gagal berturut-turut** — halaman tiga kali berturut-turut tidak bisa dimuat atau dibaca.
  Ekstensi berhenti 60 menit lalu mencoba lagi. Bila terus terjadi, kemungkinan TikTok mengubah
  halamannya; hubungi pengembang.
- **Elorae tidak terjangkau** — pastikan Elorae menyala; ekstensi mencoba lagi setiap menit.
- **Sambungan dicabut** — popup kembali menampilkan formulir; buat kode sambung baru di Elorae.
- Lencana merah **!** pada ikon ekstensi berarti ada yang perlu Anda tangani (captcha, login,
  diblokir TikTok, atau sambungan dicabut).

## Mode manual

Saat Anda membuka profil atau video TikTok sendiri, panel Elorae di kanan bawah menampilkan
angka yang terbaca. **Simpan ke Elorae** mengirim angka itu ke KOL yang cocok ("Tersimpan untuk
…"). Yang belum ada di Elorae langsung dibuat, tanpa isian: profil baru menjadi KOL bernama
"@handle" dengan akun TikTok-nya; video baru masuk ke kolaborasi berjalan KOL itu (atau kolaborasi
baru tanpa fee), sama seperti "Tempel link" di Performa video. Membuat KOL butuh izin mengelola
Kreatif milik orang yang menyambungkan ekstensi. Simpan manual tidak memakai kuota.
Bila Anda berpindah halaman di TikTok tanpa memuat ulang, panel meminta Anda menekan F5 dulu
supaya angka yang dibaca memang milik halaman itu. Panel bisa dikecilkan dengan tombol –.

Di profil, panel lengkap juga menampilkan:

- **Median views, views/pengikut, video/minggu** — median tidak terangkat oleh satu video viral.
- **Periode 7H / 30H / 90H / Atur** — video yang diunggah dalam periode itu (jumlah, total, rata-rata
  dan median views, like, komentar, share, simpan, ER) dibanding periode yang sama sebelumnya, dengan
  ▲/▼. Semua baris memakai video yang sama. 7H/30H/90H berakhir 48 jam lalu, karena video yang lebih
  baru masih mengumpulkan views. **Atur** membuka kalender panel sendiri (warna mengikuti tema panel):
  pilihan cepat, lalu ketuk tanggal awal dan akhir atau tekan dan tarik. Atur menghitung PERSIS tanggal
  yang dipilih, termasuk video yang baru diunggah; panel menyebut berapa video yang berumur < 48 jam
  (views-nya masih naik). Median views tidak terangkat satu video viral — bila total turun jauh tetapi
  median tidak, penyebabnya satu video viral di periode pembanding. Grafik
  di atas tabel menunjukkan views per hari unggah: garis warna = periode ini, garis putus = periode
  sebelumnya. Bila video lama belum termuat, panel menggulir daftar video sendiri (lalu mengembalikan
  posisi halaman) sampai periode pembanding tercakup; ekstensi menyimpan paling banyak 200 video per
  profil, jadi 90H untuk akun yang sangat sering mengunggah bisa tetap tanpa pembanding.
- **Harga per video** — dari data Elorae sendiri, bukan tebakan. Elorae menghitung harga per
  1.000 views setiap kolaborasi berbayar yang sudah tayang (fee yang disepakati ÷ views video
  TikTok-nya yang tercatat ≥ 7 hari sesudah tayang × 1.000), lalu panel memakai kuartil bawah–atas
  angka itu: perkiraan = median views akun × rentang itu. Patokan baru muncul bila ada paling sedikit
  5 kolaborasi seperti itu; sebelum itu panel hanya menghitung harga per 1.000 views dari harga yang
  Anda ketik (mis. `15jt`), tanpa menilai murah atau mahal.

**Tampilan** diatur di popup ekstensi → "Tampilan panel di TikTok": tema (otomatis mengikuti
TikTok, terang, gelap), warna, ukuran lengkap/ringkas, dan posisi kiri/kanan bawah. Tombol ⤡ di
panel juga berganti lengkap/ringkas.

## Untuk pengembang

- JavaScript polos (modul ES), Manifest V3, tanpa dependensi dan tanpa langkah build. Folder ini
  sengaja di luar workspace pnpm.
- `lib/pengurai.js` — pengurai murni halaman TikTok (data `__UNIVERSAL_DATA_FOR_REHYDRATION__`,
  respons `/api/post/item_list/`, deteksi captcha/login/tidak ditemukan/privat). Bila TikTok
  mengubah halamannya, tanda-tanda halaman ada di SATU konstanta: `POLA_HALAMAN`.
- `lib/aturan.js` — keputusan putaran otomatis (boleh mengambil tugas, jeda, istirahat,
  menunggu halaman). `background.js` hanya menjalankan keputusan itu.
- `halaman-utama.js` — skrip dunia MAIN yang menangkap respons daftar video profil;
  `konten.js` — skrip dunia ISOLATED (pembaca halaman + panel manual).
- Tes: `node --test extensions/elorae-kreatif/test/` dari akar repo (atau `npm test` di folder
  ini). Contoh data di `test/fixtures/` dibuat tangan mengikuti struktur publik TikTok; berkas tes
  baru harus didaftarkan di `test/index.js`.
- Kontrak API ada di `docs/superpowers/specs/2026-10-08-pantau-kol-ekstensi-design.md`.
