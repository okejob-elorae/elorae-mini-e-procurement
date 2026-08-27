# Model bahasa OCR

Dua berkas model Tesseract, **dibundel di repo dengan sengaja**.

Bawaan `tesseract.js` mengambil model ini dari CDN pada pemakaian pertama. Yang
berpindah memang cuma modelnya — bukan foto siapa pun — tapi ia membuat
pembacaan nota pertama bergantung pada jaringan keluar, dan sebuah server yang
dipagari firewall akan gagal membaca nota tanpa sebab yang jelas bagi
penggunanya.

| Berkas | Isi |
|---|---|
| `ind.traineddata.gz` | Bahasa Indonesia — nama barang |
| `eng.traineddata.gz` | Inggris — lebih akurat untuk kode SKU dan angka |

Keduanya varian **`4.0.0_fast`** dari <https://github.com/naptha/tessdata>,
dipilih karena ukurannya kecil dan nota retur berisi cetakan biasa, bukan
tulisan tangan bersambung yang menuntut model penuh.

`apps/web/lib/ocr/mesin.ts` menunjuk ke folder ini lewat `process.cwd()`, bisa
ditimpa dengan env `OCR_TESSDATA_PATH`. Folder ini **harus ikut disalin ke image
Docker** — barisnya sudah ada di `apps/web/Dockerfile`; kalau ia hilang, OCR
mati di produksi sementara semua tes lokal tetap hijau.
