# Analisis: webhook stok Jubelio menulis `end_qty` sebagai `qtyOnHand`

Tugas P5, bagian (3). **Analisis saja — tidak ada perubahan semantik.** Dasar: kode di
`apps/api/src/jubelio/handlers/stock.handler.ts`, `packages/db/src/stock-writer.ts`
(`applyJubelioStockAdjustment`), `apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts`,
`apps/web/lib/inventory/reconciliation-runner.ts`, dan `docs/BOUNDARY.md` §3.1 + D6/D7.

## 1. Dua arah, dua satuan

| Arah | Kode | Angka yang dipakai |
|---|---|---|
| ERP → Jubelio (push) | `stock-push.handler.ts` | `end_qty = max(0, qtyOnHand − reservedQty)` = **available** (BOUNDARY D6: "sends `available`, not raw `qtyOnHand`") |
| Jubelio → ERP (webhook stok) | `stock.handler.ts` → `applyJubelioStockAdjustment` | `product_skus[].end_qty` dari `GET /inventory/items/group/{id}` ditulis MUTLAK ke **`qtyOnHand`**; `reservedQty` tidak disentuh |

Jadi angka yang ERP kirim dalam satuan *available* kembali masuk dalam satuan *on-hand*.
Selisih kedua satuan itu persis `reservedQty`.

`applyJubelioStockAdjustment` menghitung `delta = newQty − prevQty` terhadap `qtyOnHand` dan
menulis `qtyOnHand = newQty`. Tidak ada penjaga gema (echo) di mana pun: penangan webhook
tidak membaca `JubelioOutbox`, tidak membandingkan dengan angka push terakhir, dan
`idempotencyKey`-nya (`<webhookRowId>:<jubelioItemId>`) hanya mencegah webhook yang SAMA
diproses dua kali, bukan webhook baru yang membawa angka yang baru saja kita kirim.

## 2. Apakah putaran push → webhook menurunkan `qtyOnHand` sebesar `reservedQty`?

**Ya, bila Jubelio memicu webhook stok setelah stoknya diubah lewat API** (lihat §3 — belum
diketahui). Contoh angka, satu varian:

| Langkah | Fisik di gudang | ERP onHand | ERP reserved | ERP available | Jubelio end_qty |
|---|---|---|---|---|---|
| Awal: 3 pesanan marketplace belum dikirim | 10 | 10 | 3 | 7 | 7 |
| GRN +5 → push | 15 | 15 | 3 | 12 | 12 |
| Gema webhook (end_qty 12 → onHand) | 15 | **12** | 3 | **9** | 12 |
| Perubahan berikutnya (mis. penyesuaian 0, push ulang 9) → gema | 15 | **9** | 3 | **6** | 9 |
| 3 pesanan dikirim (`consumeOrder` −3) | 12 | **6** | 0 | 6 | (push 6) |

Setiap putaran push→gema selagi ada cadangan menghapus `reservedQty` dari `qtyOnHand`.
Setelah dua putaran ERP mencatat 6, fisik 12 — selisih 2 × reservedQty. Kerusakannya
bertumpuk, tidak pulih sendiri, dan tercatat rapi sebagai `StockAdjustment`
`source = JUBELIO_WEBHOOK` bertanda NEGATIVE sebesar `reservedQty` — jadi kelihatan seperti
"Jubelio mengoreksi stok", bukan seperti bug.

Kondisi terjadinya:
1. barang punya `reservedQty > 0` saat gema diproses (cadangan marketplace, cadangan putus
   lapangan, inden yang sudah dirilis); barang tanpa cadangan aman — available = onHand;
2. Jubelio memicu webhook stok untuk perubahan yang datang dari API (`PUT
   /inventory/items/{group}/stock`) — **belum diketahui** (§3);
3. pemetaan barang benar sehingga push benar-benar mengenai SKU Jubelio yang tepat.

Butir 3 penting untuk rilis ini: sebelum perbaikan (2) di tugas yang sama, penangan push
mengirim `item_code = InventoryValue.variantSku` — untuk barang hasil ingest katalog itu
kunci gaya-ukuran (`27000101P-XL`), bukan kode Jubelio (`27000101P-BLK-XL`). Kalau Jubelio
mengabaikan/menolak kode yang tidak dikenal, push varian semacam itu selama ini tidak
pernah mengubah apa pun di Jubelio, sehingga gema juga tidak pernah terjadi. **Begitu
perbaikan kode varian di-deploy, push mulai mengenai SKU yang benar — dan kalau gema itu
nyata, penurunan `qtyOnHand` di atas mulai terjadi untuk barang-barang itu.** Verifikasi §3
sebaiknya dilakukan sebelum atau bersamaan dengan deploy itu.

Bukan hanya gema: setiap webhook stok yang SAH dari sisi Jubelio (staf mengubah stok di
Jubelio, atau Jubelio sendiri menurunkan stok saat pesanan marketplace) juga ditulis ke
`qtyOnHand` dalam satuan available, jadi juga kehilangan `reservedQty` barang itu.

### 2a. Baris kembar null/"" pada barang sederhana (ditambahkan peninjau)

Penangan push kini menjumlah available semua baris yang menuju kode Jubelio yang sama
(baris `null` dan `""` barang sederhana), lalu clamp 0 sesudah dijumlah — dulu dua entri
ber-`item_code` sama dikirim dalam satu PUT dan yang terakhir menang. Tapi webhook stok
menulis balik HANYA ke baris `variantSku = erpVariantSku` (`""`, `findUnique`). Contoh:
baris `null` onHand 5, baris `""` onHand 3, cadangan 0 → push 8 → kalau ada gema, baris
`""` menjadi 8 sementara baris `null` tetap 5: total ERP 13, fisik 8. Ini kerusakan gema
yang sama dengan §2, ditambah satu bentuk lagi; tidak terjadi bila gema tidak ada. Usulan B
menutup keduanya. Perbaikan datanya tetap sama: satukan baris kembar menjadi satu baris.

## 3. Yang belum diketahui — perlu verifikasi live

Tidak ada di repo (spesifikasi OpenAPI `reference/jubelio-openAPI.yaml` tidak ada di mesin
ini; dokumen tidak menyebut perilaku gema). Yang harus dipastikan di Jubelio sungguhan:

1. **Apakah `PUT /inventory/items/{group}/stock` memicu webhook stok** ke
   `https://api.elorae.cloud/webhooks/jubelio/stock`? Cara uji: push satu barang uji yang
   punya cadangan, lalu lihat `JubelioWebhookEvent` (event `stock`) dalam 1–2 menit untuk
   `item_group_id` yang sama.
2. **Arti `end_qty` di detail grup**: stok fisik di lokasi, atau stok tersedia sesudah
   pesanan Jubelio yang belum dikirim? Dan kapan Jubelio menurunkannya untuk pesanan
   marketplace — saat pesanan masuk, saat diproses, atau saat dikirim?
3. Apakah `end_qty` yang dikembalikan sama persis dengan angka yang kita PUT (absolut),
   atau Jubelio mengurangkan sendiri pesanan terbukanya (yang berarti marketplace melihat
   cadangan dikurangkan DUA kali — sekali oleh ERP di push, sekali oleh Jubelio).

Kueri bukti di prod (hanya baca; jalankan dengan `--skip-ssl` dan
`SET SESSION max_statement_time = 30`): penyesuaian webhook yang muncul tak lama setelah
push stok untuk barang yang sama dan besarnya sama dengan cadangan saat itu —

```sql
SELECT o.entityId AS itemId, o.processedAt AS pushSelesai, a.createdAt AS webhookPada,
       a.qtyChange, a.prevQty, a.newQty
FROM JubelioOutbox o
JOIN StockAdjustment a
  ON a.itemId = o.entityId
 AND a.source = 'JUBELIO_WEBHOOK'
 AND a.createdAt BETWEEN o.processedAt AND o.processedAt + INTERVAL 3 MINUTE
WHERE o.entityType = 'stock_push' AND o.status = 'DONE'
  AND o.processedAt >= NOW() - INTERVAL 30 DAY
ORDER BY o.processedAt DESC
LIMIT 200;
```

Banyak baris dengan `qtyChange` negatif yang besarnya cocok dengan `reservedQty` barang
itu = gema terbukti. Nol baris padahal ada push DONE = Jubelio tidak menggema (atau push
selama ini tidak mengenai SKU yang benar — lihat §2 butir 3).

## 4. Temuan terkait (bukan bagian tugas ini)

`apps/web/lib/inventory/reconciliation-runner.ts` membandingkan `qtyOnHand` ERP dengan
qty Jubelio (`eloraeQty = Number(inv.qtyOnHand)`), padahal BOUNDARY §3.1 menyatakan
rekonsiliasi WAJIB memakai available. Akibatnya setiap barang bercadangan ditandai selisih
sebesar `reservedQty`, dan mode `MATCH_JUBELIO` (saat ini dorman, `FLAG_ONLY`) akan
menulis `qtyOnHand = qty Jubelio` — kerusakan yang sama dengan §2. Perbaiki sebelum
auto-correct dinyalakan.

## 5. Usulan perbaikan (sesudah §3 terjawab)

**Usulan A — baca `end_qty` sebagai available** (sesuai model BOUNDARY: Jubelio hilir dari
ERP dan menerima available). Di `applyJubelioStockAdjustment`, dalam transaksi yang sama:
`onHandBaru = end_qty + reservedQty` (reservedQty dibaca dari baris yang dikunci), delta
dan `StockAdjustment` dihitung terhadap `onHandBaru`. Gema murni menjadi delta 0 (tidak
menulis penyesuaian); perubahan sah di Jubelio (−2) menjadi −2 di onHand.
Risiko yang harus dibuktikan dulu: urutan webhook pesanan vs webhook stok. Kalau Jubelio
menurunkan `end_qty` saat pesanan masuk dan webhook stok tiba SEBELUM webhook pesanan
mencadangkan, onHand turun sementara lalu cadangan bertambah — available terhitung dua
kali sampai push berikutnya. Butuh jawaban §3 butir 2.

**Usulan B — tekan gema saja** (tanpa mengubah arti end_qty): penangan push menyimpan angka
yang terkirim per kode di `JubelioOutbox.payload` (mis. `terkirim: [{ item_code, end_qty }]`,
JSON, tanpa migrasi). Penangan webhook melewati varian yang `end_qty`-nya sama dengan push
DONE terakhir untuk kode itu dalam jendela waktu pendek (mis. 10 menit), dengan alasan lewati
`echo_of_push`. Aman terhadap urutan pesanan, tapi webhook sah tetap ditulis dalam satuan
available (masalah sisa yang sama).

Rekomendasi: B dulu (mencegah kerusakan yang bertumpuk, risiko rendah), A sesudah §3 butir 2
dan 3 terjawab.

Tes yang dibutuhkan (packages/db + api, dengan angka nyata):
- gema: onHand 10, reserved 3, push 7, webhook end_qty 7 → onHand tetap 10, tanpa
  `StockAdjustment` (A) / webhook dilewati `echo_of_push` (B);
- perubahan sah: onHand 10, reserved 3, webhook end_qty 5 → onHand 8 (A); B: tetap ditulis;
- dua gema berturut-turut tidak menumpuk (onHand tetap 10 setelah dua putaran);
- B: webhook dengan end_qty berbeda dari push terakhir tidak dilewati; push lebih tua dari
  jendela tidak menekan webhook;
- spesifikasi `stock.handler.spec.ts` yang ada tetap lulus; tes `stock-writer` di
  packages/db untuk P2002/idempoten tetap lulus.

Implementasi TIDAK dilakukan di tugas ini: perilaku Jubelio (§3) belum terbukti, dan berkas
yang harus diubah (`packages/db/src/stock-writer.ts`, `apps/api/src/jubelio/handlers/stock.handler.ts`)
bukan milik tugas ini.

## Hasil penutup (tugas Z4, 2026-10-06)

### Yang diterapkan — Usulan B (tanpa skema, tanpa mengubah arti `end_qty`)

**Push (`apps/api/src/jubelio/outbox/handlers/stock-push.handler.ts`).** Sesudah SETIAP PUT
per grup Jubelio yang berhasil, angka yang diterima Jubelio disimpan di
`JubelioOutbox.payload.terkirim = [{ item_code, end_qty, pada }]` (isi lama `sumber`/`ref`
dipertahankan; `pada` = ISO waktu PUT; `end_qty` = angka sesudah clamp, persis yang dikirim).
Dicatat per grup, bukan sekali di akhir: kalau grup kedua gagal, gema grup pertama tetap
dikenali. Percobaan ulang mengganti catatan kode yang dikirim ulang, kode lain dipertahankan.
Gagal menyimpan catatan TIDAK menggagalkan push (Jubelio sudah menerima angkanya) — hanya
dicatat ke log; akibatnya gema push itu tidak ditekan (perilaku lama). Pembaca bersama:
`bacaStokTerkirim(payload)` (payload lama/rusak → entri dibuang, tidak dilempar).

**Webhook (`apps/api/src/jubelio/handlers/stock.handler.ts`).** Sesudah detail grup diambil,
per varian: kalau `end_qty` SAMA dengan push stok TERAKHIR untuk kode Jubelio itu, varian
dilewati. Syarat push itu masih menekan:
- diterima Jubelio paling lama `JENDELA_GEMA_PUSH_MS` = 10 menit SEBELUM webhook ini diterima
  (`JubelioWebhookEvent.receivedAt`, atau sekarang bila lebih awal; dihitung dari `pada`, bukan
  status baris; push lebih tua tidak menekan apa pun) — *diubah peninjau, lihat di bawah*;
- status baris outbox tidak menentukan: `DONE`/`SKIPPED` (processedAt dalam jendela), `DEAD`
  (deadAt dalam jendela — grup lain gagal sesudah grup ini diterima), atau masih
  `PENDING`/`PROCESSING` (angka sudah diterima Jubelio sebelum `markDone`; gema bisa tiba
  lebih dulu);
- belum ada webhook stok yang benar-benar DITERAPKAN untuk kode itu sesudah push
  (`StockAdjustment` `JUBELIO_WEBHOOK`, `externalRef = <grup>/<kode>`, `createdAt ≥ pada`).
  Tanpa syarat ini, urutan sah 7 → 5 → 7 di Jubelio membuat angka 7 kedua ditekan dan ERP
  tertinggal di 5.

Semua varian gema → webhook `SKIPPED` dengan `skipReason = echo_of_push`
(`ALASAN_GEMA_PUSH`; konstanta lokal di stock.handler.ts karena `SKIP_REASONS` di
`queue/webhook-status.ts` bukan milik tugas ini). Campuran gema + perubahan → `PROCESSED`,
varian gema hanya dicatat ke log api (`echo_of_push — <kode>=<qty> …`). `end_qty` yang berbeda
ditulis persis seperti dulu. `packages/db/src/stock-writer.ts` TIDAK diubah: keputusan gema
butuh format catatan push (milik api) dan tidak menulis apa pun, jadi tempat paling tepat
adalah penangan webhook, sebelum penulis dipanggil.

Menutup juga §2a (baris kembar null/"" barang sederhana): gema angka jumlahan tidak lagi
ditulis ke baris `""`.

**Rekonsiliasi (`apps/web/lib/inventory/reconciliation-runner.ts`).**
- Angka ERP yang dibandingkan = `tersediaErpUntukPemetaan`: Σ(onHand − reserved) baris yang
  dikirim push ke kode itu (kunci dipangkas/abai huruf, null = ""), lalu clamp 0 — persis yang
  didorong push. `ReconciliationResult.eloraeQty` kini AVAILABLE.
- `applyMatchJubelio` (MATCH_JUBELIO, dorman): onHand baru = qty Jubelio + reserved; reserved
  tidak disentuh. Baris dicari toleran null/"" (dulu `findUnique ""` melewatkan baris null
  diam-diam — butir CLAUDE.md "NULL-variant strict lookup in reconciliation-runner.ts"
  tertutup); baris kembar dijumlah, selisih ditulis ke baris onHand terbesar.
- `runReconciliation(trigger, startedById, { itemIds })` — cakupan opsional untuk tes di basis
  data bersama; pemanggil lama tidak berubah.
- Fragmen i18n `i18n-t3c-Z4-penahan-gema-webhook-stok.json`: kolom "Qty Elorae" → "Tersedia
  Elorae" (angkanya memang available sekarang).

### Tes (angka nyata) dan mutasi

- `stock.handler.spec.ts` (+14): onHand 10, ditahan 3, push 7, webhook 7 → `echo_of_push`,
  onHand tetap 10, tanpa penyesuaian; dua gema berturut-turut dan dua gema serentak
  (`Promise.all`) tidak menumpuk; webhook 5 → ditulis (onHand 5, −5); push 15 menit lalu →
  tidak menekan; baris PROCESSING macet dengan PUT 15 menit lalu → tidak menekan; push 7 lalu
  9 → 9 ditekan, 7 ditulis; 7 → 5 (diterapkan) → 7 ditulis; penyesuaian kode lain tidak
  membatalkan; payload lama/rusak tidak menekan; campuran gema + perubahan.
- `stock-push.handler.spec.ts` (+8): catatan sesudah PUT (onHand 10, ditahan 3 → 7), sesudah
  clamp, tidak ada catatan bila PUT gagal, grup pertama tercatat walau grup kedua gagal,
  percobaan ulang, gagal simpan tidak menggagalkan push, pembaca payload rusak.
- `reconciliation-runner.test.ts` (baru, 13, basis data uji): available vs onHand, clamp,
  baris kembar, MATCH 10/3 vs Jubelio 5 → onHand 8, baris null, run tercakup → IN_SYNC.
- Mutasi yang dibunuh: penekan dimatikan, jendela dihapus, pembatalan oleh webhook diterapkan
  dihapus, push tertua menang, baris PROCESSING diabaikan, catatan push dihapus/payload lama
  dibuang/catatan lama dilupakan/gagal simpan dilempar; rekonsiliasi tanpa reserved, tanpa
  clamp, MATCH menulis onHand = Jubelio, pencarian baris null ketat, runner kembali ke onHand,
  baris kembar terkecil.
- `outbox-processor.service.spec.ts` sudah gagal 4 tes SEBELUM tugas ini (mock tanpa
  `updateMany` sejak klaim atomik d45bf580) — mock-nya diperbaiki, kini lulus.

### Yang masih butuh verifikasi live (jangan dijalankan dari sesi agen)

1. §3 butir 1–3 tetap terbuka: apakah Jubelio menggema `PUT /inventory/items/{group}/stock`,
   arti `end_qty`, dan apakah Jubelio mengurangkan pesanannya sendiri. Kueri §3 tetap berlaku
   untuk data SEBELUM deploy ini.
2. Sesudah deploy, bukti penekan bekerja (hanya baca, `--skip-ssl`,
   `SET SESSION max_statement_time = 30`):

```sql
-- catatan push terisi
SELECT id, processedAt, JSON_EXTRACT(payload, '$.terkirim') AS terkirim
FROM JubelioOutbox
WHERE entityType = 'stock_push' AND status = 'DONE'
ORDER BY processedAt DESC LIMIT 20;

-- webhook yang ditekan
SELECT COUNT(*) FROM JubelioWebhookEvent
WHERE event = 'stock' AND status = 'SKIPPED' AND skipReason = 'echo_of_push'
  AND receivedAt >= NOW() - INTERVAL 7 DAY;

-- sisa kerusakan: penyesuaian webhook ≤ 3 menit sesudah push yang besarnya = cadangan
-- (kueri §3) harus turun ke nol untuk barang yang angkanya sama dengan push.
```
   Webhook campuran (sebagian varian gema) tetap `PROCESSED`; varian gemanya hanya tampak di
   log container api (`echo_of_push —`).
3. Celah yang diketahui: (a) jeda milidetik antara jawaban PUT dan tersimpannya catatan —
   gema yang diproses di jeda itu tidak ditekan (praktis kecil: penangan webhook membaca
   catatan SESUDAH satu GET ke Jubelio); (b) ~~antrean webhook yang tertunda > 10 menit tidak
   ditekan~~ — DITUTUP peninjau, jendela kini diukur dari `receivedAt`; tersisa: gema yang
   DITERIMA > 10 menit sesudah push-nya tetap ditulis (perilaku lama); (c) kode Jubelio yang
   pindah grup tetap dikenali (pembatalan memakai bagian kode `externalRef`, bukan grupnya);
   (d) dua baris push untuk barang yang sama diproses serentak dan PUT-nya tiba di Jubelio
   terbalik urutan → "terakhir" menurut `pada` bisa bukan angka yang berlaku di Jubelio; gema
   angka yang berlaku tidak ditekan (perilaku lama).
4. **Temuan peninjau — penyaring duplikat di pintu masuk webhook.** `webhooks.service.ts`
   menolak setiap webhook yang badannya IDENTIK dengan webhook lama (`@@unique([event,
   payloadHash])`, sha256 badan mentah) — selamanya, tanpa jendela waktu. Badan webhook stok
   yang kita kenal (`{ action, item_group_id, item_ids, location_id }`) tidak membawa qty atau
   waktu. Kalau Jubelio memang mengirim badan yang sama untuk setiap perubahan grup yang sama,
   hanya webhook PERTAMA per (grup, daftar item) yang pernah diproses: perubahan sah berikutnya
   dan gema berikutnya sama-sama dibuang di pintu (log api: `Duplicate webhook stock hash=… —
   skipped`). Ini mengubah cara membaca kueri §3: nol penyesuaian sesudah push bisa berarti
   "dibuang sebagai duplikat", bukan "Jubelio tidak menggema". Verifikasi live: hitung baris
   log `Duplicate webhook stock` di container api, dan bandingkan dua badan webhook stok untuk
   grup yang sama. Bukan berkas tugas ini — perlu tugas sendiri bila terbukti.

### Apakah Usulan A masih perlu?

Ya, tapi tidak mendesak lagi dan tetap menunggu §3 butir 2–3. B menghentikan putaran gema
yang BERTUMPUK (kerusakan utama, dan satu-satunya yang muncul tanpa ada perubahan apa pun di
Jubelio). Yang tersisa hanya bisa ditutup A: webhook stok yang SAH dari sisi Jubelio (staf
mengubah stok di Jubelio, atau Jubelio menurunkan stok untuk pesanan marketplace) masih
ditulis ke `qtyOnHand` dalam satuan available, jadi masih kehilangan `reservedQty` barang itu
sekali per perubahan. Kalau verifikasi live menunjukkan Jubelio tidak pernah menggema, B
tidak berbuat apa-apa (aman) dan A menjadi satu-satunya perbaikan yang relevan. Kalau Jubelio
mengurangkan pesanannya sendiri dari `end_qty` (§3 butir 3), A harus memperhitungkannya agar
cadangan tidak dikurangkan dua kali.

### Tinjauan adversarial (2026-10-06)

Diperiksa ulang: contoh angka, pemanggil lain, mutasi (setiap mutasi dipasang, dijalankan, dan
dipulihkan dalam satu perintah; checksum berkas dicocokkan sesudahnya). Yang diperbaiki:

1. **Celah tes — penerapan SEBELUM push.** Mutasi "setiap penyesuaian `JUBELIO_WEBHOOK` dalam
   jendela membatalkan tekanan" (`createdAt ≥ pada` → `true`) LOLOS semua tes. Akibatnya nyata:
   webhook sah 4 menit lalu (onHand → 5), lalu GRN +10 (onHand 15, ditahan 3) → push 12 →
   gema 12 akan DITULIS (onHand 12, cadangan 3 hilang). Tes baru dengan angka itu; mutasi kini
   tertangkap.
2. **Jendela diukur dari waktu webhook DITERIMA**, bukan waktu proses (`Math.min(receivedAt,
   sekarang) − 10 menit`). Gema yang tertahan di antrean, dihidupkan sweeper (macet ≥ 5 menit,
   sapuan tiap 10 menit), atau dicoba ulang admin dari halaman Jubelio dulu ditulis begitu
   prosesnya lewat 10 menit dari push. Tes: push 14 menit lalu, webhook diterima 13 menit lalu
   → ditekan; push 13 menit lalu, webhook diterima 2 menit lalu (11 menit sesudah push) → tetap
   ditulis (jendela tetap terbatas).
3. **Baris push DEAD ikut dibaca.** Dulu hanya `DONE` + `PENDING`/`PROCESSING`; baris yang
   mati karena grup KEDUA ditolak (NonRetryableError) membuang catatan grup pertama yang sudah
   diterima Jubelio — klaim "grup pertama tetap dikenali" hanya benar untuk galat yang dicoba
   ulang. Kini kueri memakai `processedAt ≥ batas` ATAU `deadAt ≥ batas` ATAU
   `PENDING`/`PROCESSING`, tanpa syarat status; `pada` tetap penentu jendela. Tes baris DEAD.
4. **Rekonsiliasi — oversell tidak lagi menambah stok fiktif.** `applyMatchJubelio` dengan
   onHand 1, ditahan 4 (available −3, push mengirim 0) dan Jubelio 0 menulis onHand 4 (+3 pcs
   yang tidak ada) — terjangkau lewat "Selesaikan → samakan Jubelio" pada hasil FLAGGED lama.
   Kini: bila available ERP yang di-clamp 0 sudah sama dengan Jubelio → tidak menulis apa pun.
   Tes DB (onHand 1/4 vs 0 → tetap 1, tanpa penyesuaian; onHand 10/3 vs 0 → onHand 3).

Hasil: api `stock.handler` + `stock-push` + `outbox-processor` 59/59; web
`reconciliation-runner.test.ts` + `reconciliation.test.ts` 25/25; mutasi M4 (penerapan sebelum
push), jendela dari waktu proses, DEAD diabaikan, penjaga oversell dihapus, baris kembar terkecil
— semuanya tertangkap. Type-check api bersih; type-check web tercakup (Z4-tsconfig) 0 galat;
ESLint web bersih. Bed lokal bersih dari fixture (RC-/RR-/recon-uji-/RUNNING = 0).

Masih terbuka (bukan berkas tugas ini atau butuh keputusan): penyaring duplikat di pintu masuk
(butir 4 di atas); `echo_of_push` belum masuk `SKIP_REASONS`; baris kembar pada MATCH_JUBELIO
menulis seluruh selisih ke baris onHand terbesar sehingga baris itu bisa negatif bila selisih
melebihi isinya (total tetap benar; dorman).
