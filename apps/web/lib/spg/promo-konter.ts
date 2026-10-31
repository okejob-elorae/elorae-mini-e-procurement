/**
 * Promo & diskon di konter SPG — aturan murni, tanpa basis data, supaya SATU
 * hitungan dipakai di tiga tempat: penulis nota (server, yang berwenang),
 * pratinjau keranjang, dan HP yang menjual tanpa sinyal (antrean luring).
 *
 * Bukan mesin promo pesanan toko (`@elorae/db/promo`): itu harga Elorae ke
 * TOKO; ini harga toko ke PEMBELI di konter. Keduanya tidak boleh tertukar.
 *
 * Aturan (pilihan bawaan, dijelaskan juga di layar kantor):
 *   1. Satu barang (satu potong) kena paling banyak SATU promo barang.
 *   2. Prioritas lebih tinggi didahulukan. Pada prioritas yang sama, setiap
 *      potong mengambil potongan terbesar dari promo persen/potongan/harga
 *      khusus; lalu promo "beli X gratis Y" memakai potong yang tersisa.
 *   3. "Beli X gratis Y" campur-pilih antar barang promo itu: potong diurutkan
 *      dari yang termahal, dikelompokkan per X+Y, dan Y potong termurah di
 *      setiap kelompok PENUH gratis. Potong di kelompok yang tidak penuh tetap
 *      bebas untuk promo berprioritas lebih rendah.
 *   4. Sesudah promo barang, SATU promo belanja (minimal belanja) — yang
 *      potongannya terbesar — dihitung dari nilai bersih barang yang ikut promo itu.
 *   5. Diskon manual SPG (kalau diaktifkan kantor) dihitung paling akhir, dari
 *      nilai bersih seluruh nota, dan tidak boleh melewati batas persen kantor.
 *
 * Tambahan 2026-10-20 (keputusan sementara 102–107):
 *   - Promo PAKET: satu harga untuk sekumpulan barang (barang tertentu atau
 *     "barang dari kategori X", masing-masing dengan jumlah). Pada prioritas
 *     yang sama paket dihitung PALING DULU, sebelum promo satuan dan "beli X
 *     gratis Y". Potong yang diambil adalah yang termahal di antara yang cocok
 *     (komponen barang tertentu dulu, lalu komponen kategori); paket hanya
 *     terbentuk kalau harganya di bawah harga normal potong-potong itu.
 *     Potongannya dibagi ke potong menurut harganya.
 *   - Promo "khusus member" hanya berlaku bila nota punya member.
 *   - Diskon member (persen tingkatnya) dihitung sesudah promo barang dan
 *     SEBELUM promo belanja — bawaan hanya dari potong yang tidak kena promo
 *     barang (`gabungPromo: false`).
 *
 * Semua hitungan dalam SEN (bilangan bulat) supaya pembulatan tidak menyimpang;
 * potongan dibulatkan ke rupiah utuh. Potongan promo belanja dan diskon manual
 * dibagi ke baris menurut nilai bersihnya (sisa terbesar), sehingga jumlah
 * nilai bersih baris SELALU sama dengan total nota — laporan per barang, target,
 * dan komisi membaca baris dan tidak pernah selisih dengan nota.
 */

export const JENIS_PROMO_KONTER = [
  "PERSEN",
  "POTONGAN",
  "HARGA_KHUSUS",
  "BELI_GRATIS",
  "MIN_BELANJA_PERSEN",
  "MIN_BELANJA_POTONGAN",
  "PAKET",
] as const;
export type JenisPromoKonter = (typeof JENIS_PROMO_KONTER)[number];

const PROMO_SATUAN: readonly JenisPromoKonter[] = ["PERSEN", "POTONGAN", "HARGA_KHUSUS"];
const PROMO_NOTA: readonly JenisPromoKonter[] = ["MIN_BELANJA_PERSEN", "MIN_BELANJA_POTONGAN"];

export function promoNota(type: JenisPromoKonter): boolean {
  return PROMO_NOTA.includes(type);
}

/** Satu komponen promo PAKET: `qty` potong dari barang tertentu atau dari satu kategori. */
export type KomponenPaket = { jenis: "ITEM" | "CATEGORY"; refId: string; qty: number };

/** Promo konter dalam bentuk yang aman dikirim ke HP (angka biasa, tanggal ISO). */
export type PromoKonter = {
  id: string;
  name: string;
  type: JenisPromoKonter;
  /** PERSEN: 0–100. POTONGAN: rupiah per potong. HARGA_KHUSUS: harga per potong. MIN_BELANJA_*: persen atau rupiah. PAKET: harga satu paket. */
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  /** Hanya promo belanja: nilai bersih minimal barang yang ikut. */
  minSubtotal: number | null;
  allItems: boolean;
  itemIds: string[];
  categoryIds: string[];
  allStores: boolean;
  storeIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  isActive: boolean;
  /**
   * Bagian TOKO dari potongan promo ini, 0–100 (keputusan pemilik 2026-10-03:
   * di toko konsinyasi potongan ditanggung penuh Elorae atau dibagi dengan
   * toko). Tidak ada / 0 = penuh Elorae.
   */
  storeSharePercent?: number;
  /** Hanya berlaku untuk pembeli member. Tidak ada = untuk semua pembeli. */
  memberOnly?: boolean;
  /** Hanya PAKET: isi satu paket. */
  komponen?: KomponenPaket[];
};

/**
 * Member pada nota, dari tingkatnya saat barang dijual. `diskonPersen` 0 (atau
 * diskon member dimatikan kantor) = tetap member — promo khusus member berlaku —
 * tanpa potongan member.
 */
export type AnggotaNota = {
  tingkat: string;
  diskonPersen: number;
  /** Benar = diskon member juga untuk potong yang sudah kena promo barang. */
  gabungPromo: boolean;
  /** Bagian toko konsinyasi dari diskon member, 0–100. */
  bagianTokoPersen: number;
};

export type BarisKeranjangPromo = {
  /** Kunci baris (barang + varian) — dikembalikan apa adanya. */
  key: string;
  itemId: string;
  categoryId: string | null;
  qty: number;
  /** Harga jual per potong sebelum potongan (rupiah). */
  unitPrice: number;
};

export type AturanDiskonManual = { aktif: boolean; maksPersen: number; bagianTokoPersen?: number };
export type DiskonManual = { jenis: "PERSEN" | "RUPIAH"; nilai: number };

/**
 * Bagian satu promo di satu baris. BARANG: promo barang (paket, satuan,
 * beli-gratis) — `qty` = potong yang ikut promo itu, termasuk potong berbayar di
 * kelompok beli-gratis. BELANJA: bagian promo belanja di baris ini — `qty` =
 * seluruh potong baris.
 */
export type RincianPromoBaris = {
  promoId: string;
  name: string;
  kind: "BARANG" | "BELANJA";
  qty: number;
  potongan: number;
  potonganToko: number;
};

export type HasilBarisPromo = {
  key: string;
  /** qty × harga (rupiah). */
  kotor: number;
  /** Potongan promo barang di baris ini (rupiah). */
  potonganPromo: number;
  /** Seluruh potongan baris: promo barang + bagian promo belanja + bagian diskon manual. */
  potongan: number;
  /** kotor − potongan. Jumlah seluruh baris = total nota. */
  bersih: number;
  /** Bagian TOKO dari `potongan` (sisanya ditanggung Elorae). */
  potonganToko: number;
  promoId: string | null;
  promoName: string | null;
  /** Potong yang gratis karena "beli X gratis Y". */
  gratis: number;
  /** Bagian diskon member di baris ini (rupiah). */
  potonganMember: number;
  /** Bagian diskon manual SPG di baris ini (rupiah). */
  potonganManual: number;
  /** Rincian per promo (promo barang lalu promo belanja). Jumlah potongannya = potongan − member − manual. */
  rincian: RincianPromoBaris[];
};

export type HasilPromoKonter = {
  baris: HasilBarisPromo[];
  subtotal: number;
  potonganBaris: number;
  promoNota: { id: string; name: string; potongan: number } | null;
  /** Member nota ini (null = bukan member). `potongan` 0 kalau diskon member tidak berlaku. */
  member: { tingkat: string; potongan: number } | null;
  diskonManual: number;
  potonganTotal: number;
  /** Bagian toko dari seluruh potongan nota. */
  potonganToko: number;
  total: number;
  /** Promo yang sedang berlaku di toko ini (untuk spanduk di layar jual), termasuk yang khusus member. */
  berlaku: { id: string; name: string; type: JenisPromoKonter; memberOnly: boolean }[];
};

export type GagalPromoKonter = { ok: false; code: "DISKON_MANUAL_NONAKTIF" | "DISKON_MANUAL_LEWAT_BATAS" | "DISKON_MANUAL_TIDAK_VALID" };

const keSen = (rupiah: number) => Math.round(rupiah * 100);
const keRupiah = (sen: number) => sen / 100;
/** Bulatkan ke rupiah utuh (kelipatan 100 sen). */
const rupiahUtuh = (sen: number) => Math.round(sen / 100) * 100;

/** Promo berlaku untuk toko ini pada waktu ini. */
export function promoBerlaku(p: PromoKonter, storeId: string, waktu: Date): boolean {
  if (!p.isActive) return false;
  if (!p.allStores && !p.storeIds.includes(storeId)) return false;
  const t = waktu.getTime();
  if (p.startsAt && new Date(p.startsAt).getTime() > t) return false;
  if (p.endsAt && new Date(p.endsAt).getTime() < t) return false;
  return true;
}

function barangIkut(p: PromoKonter, itemId: string, categoryId: string | null): boolean {
  if (p.allItems) return true;
  if (p.itemIds.includes(itemId)) return true;
  return categoryId !== null && p.categoryIds.includes(categoryId);
}

/** Potongan satu potong (sen) dari promo persen/potongan/harga khusus. */
export function potonganSatuan(p: PromoKonter, hargaSen: number): number {
  const v = p.value ?? 0;
  if (hargaSen <= 0 || v <= 0) return 0;
  switch (p.type) {
    case "PERSEN":
      return Math.min(hargaSen, rupiahUtuh((hargaSen * Math.min(v, 100)) / 100));
    case "POTONGAN":
      return Math.min(hargaSen, keSen(v));
    case "HARGA_KHUSUS":
      return Math.max(0, hargaSen - keSen(v));
    default:
      return 0;
  }
}

/** Urutan tetap supaya hasil yang sama untuk keranjang yang sama, di server maupun HP. */
const urutId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Bagi `jumlah` sen ke bobot-bobot (sisa terbesar). Bobot 0 tidak mendapat bagian. */
export function bagiSisaTerbesar(jumlah: number, bobot: number[]): number[] {
  const total = bobot.reduce((s, b) => s + Math.max(0, b), 0);
  if (jumlah <= 0 || total <= 0) return bobot.map(() => 0);
  const mentah = bobot.map((b) => (Math.max(0, b) * jumlah) / total);
  const bagian = mentah.map(Math.floor);
  let sisa = jumlah - bagian.reduce((s, b) => s + b, 0);
  const urut = mentah.map((m, i) => ({ i, pecahan: m - Math.floor(m) })).sort((a, b) => b.pecahan - a.pecahan || a.i - b.i);
  for (const { i } of urut) {
    if (sisa <= 0) break;
    if (bobot[i] <= 0) continue;
    bagian[i] += 1;
    sisa -= 1;
  }
  return bagian;
}

type Potong = { baris: number; hargaSen: number; itemId: string; categoryId: string | null; promo: PromoKonter | null; potonganSen: number; gratis: boolean };

const cocokKomponen = (k: KomponenPaket, u: Potong) => (k.jenis === "ITEM" ? u.itemId === k.refId : u.categoryId !== null && u.categoryId === k.refId);

/**
 * Bentuk paket sebanyak mungkin dari potong yang belum kena promo. Komponen
 * barang tertentu diisi dulu (supaya komponen kategori tidak mengambil barang
 * yang memang disebut), lalu komponen kategori; di tiap komponen potong yang
 * termahal didahulukan. Berhenti begitu paket tidak lengkap atau harganya tidak
 * lagi di bawah harga normal — potong yang lebih murah tidak akan menolong.
 */
function bentukPaket(p: PromoKonter, potong: Potong[]): void {
  const harga = keSen(p.value ?? 0);
  const komponen = (p.komponen ?? [])
    .filter((k) => Number.isInteger(k.qty) && k.qty >= 1)
    .slice()
    .sort((a, b) => (a.jenis === b.jenis ? 0 : a.jenis === "ITEM" ? -1 : 1));
  if (harga <= 0 || komponen.length === 0) return;
  for (let putaran = 0; putaran < 1000; putaran += 1) {
    const dipilih = new Set<Potong>();
    for (const k of komponen) {
      const calon = potong
        .filter((u) => !u.promo && u.hargaSen > 0 && !dipilih.has(u) && cocokKomponen(k, u))
        .sort((a, b) => b.hargaSen - a.hargaSen || a.baris - b.baris);
      if (calon.length < k.qty) return;
      for (const u of calon.slice(0, k.qty)) dipilih.add(u);
    }
    const isi = [...dipilih];
    const kotor = isi.reduce((s, u) => s + u.hargaSen, 0);
    if (kotor <= harga) return;
    const potongan = kotor - harga;
    // Rupiah utuh kalau potongannya rupiah utuh, supaya nilai bersih baris juga utuh.
    const satuan = potongan % 100 === 0 ? 100 : 1;
    const bagian = bagiSisaTerbesar(potongan / satuan, isi.map((u) => u.hargaSen)).map((x) => x * satuan);
    isi.forEach((u, j) => {
      u.promo = p;
      u.potonganSen = bagian[j];
    });
  }
}

/**
 * Hitung promo & diskon satu keranjang. `waktu` = saat barang dijual (untuk
 * penjualan tanpa sinyal: waktu di HP, bukan waktu terkirim), supaya promo
 * yang berakhir tengah malam tetap berlaku untuk nota jam sembilan malam yang
 * baru terkirim besok pagi.
 */
export function hitungPromoKonter(input: {
  baris: readonly BarisKeranjangPromo[];
  promos: readonly PromoKonter[];
  storeId: string;
  waktu: Date;
  diskonManual?: DiskonManual | null;
  aturanManual?: AturanDiskonManual;
  /** Member pada nota ini, atau null/tidak ada. */
  anggota?: AnggotaNota | null;
}): ({ ok: true } & HasilPromoKonter) | GagalPromoKonter {
  const tersedia = input.promos.filter((p) => promoBerlaku(p, input.storeId, input.waktu));
  const anggota = input.anggota ?? null;
  // Promo khusus member hanya dipakai bila nota punya member; spanduk tetap menyebutnya.
  const berlaku = tersedia.filter((p) => !p.memberOnly || anggota !== null);

  // 1. Pecah keranjang menjadi potong.
  const potong: Potong[] = [];
  input.baris.forEach((b, i) => {
    const hargaSen = keSen(b.unitPrice);
    for (let n = 0; n < Math.max(0, Math.floor(b.qty)); n += 1) {
      potong.push({ baris: i, hargaSen, itemId: b.itemId, categoryId: b.categoryId, promo: null, potonganSen: 0, gratis: false });
    }
  });

  // 2. Promo barang, per tingkat prioritas (tertinggi dulu).
  const promoBarang = berlaku.filter((p) => !promoNota(p.type));
  const tingkat = [...new Set(promoBarang.map((p) => p.priority))].sort((a, b) => b - a);
  for (const prioritas of tingkat) {
    for (const p of promoBarang.filter((x) => x.priority === prioritas && x.type === "PAKET").sort(urutId)) bentukPaket(p, potong);

    const satuan = promoBarang.filter((p) => p.priority === prioritas && PROMO_SATUAN.includes(p.type)).sort(urutId);
    for (const u of potong) {
      if (u.promo) continue;
      let terbaik: PromoKonter | null = null;
      let nilai = 0;
      for (const p of satuan) {
        if (!barangIkut(p, u.itemId, u.categoryId)) continue;
        const d = potonganSatuan(p, u.hargaSen);
        if (d > nilai) {
          terbaik = p;
          nilai = d;
        }
      }
      if (terbaik) {
        u.promo = terbaik;
        u.potonganSen = nilai;
      }
    }

    const beliGratis = promoBarang.filter((p) => p.priority === prioritas && p.type === "BELI_GRATIS").sort(urutId);
    for (const p of beliGratis) {
      const beli = Math.max(0, Math.floor(p.buyQty ?? 0));
      const gratis = Math.max(0, Math.floor(p.freeQty ?? 0));
      const besar = beli + gratis;
      if (beli < 1 || gratis < 1) continue;
      const calon = potong
        .filter((u) => !u.promo && u.hargaSen > 0 && barangIkut(p, u.itemId, u.categoryId))
        .sort((a, b) => b.hargaSen - a.hargaSen || a.baris - b.baris);
      const kelompok = Math.floor(calon.length / besar);
      for (let k = 0; k < kelompok; k += 1) {
        const isi = calon.slice(k * besar, (k + 1) * besar);
        isi.forEach((u, j) => {
          u.promo = p;
          if (j >= beli) {
            u.gratis = true;
            u.potonganSen = u.hargaSen;
          }
        });
      }
    }
  }

  // 3. Rekap per baris.
  const n = input.baris.length;
  const kotorSen = input.baris.map((b) => keSen(b.unitPrice) * Math.max(0, Math.floor(b.qty)));
  const promoSen = new Array<number>(n).fill(0);
  const gratisQty = new Array<number>(n).fill(0);
  const promoPerBaris = new Array<Map<string, { promo: PromoKonter; sen: number; qty: number }>>(n);
  for (let i = 0; i < n; i += 1) promoPerBaris[i] = new Map();
  for (const u of potong) {
    if (!u.promo) continue;
    promoSen[u.baris] += u.potonganSen;
    if (u.gratis) gratisQty[u.baris] += 1;
    const peta = promoPerBaris[u.baris];
    const ada = peta.get(u.promo.id);
    if (ada) {
      ada.sen += u.potonganSen;
      ada.qty += 1;
    } else peta.set(u.promo.id, { promo: u.promo, sen: u.potonganSen, qty: 1 });
  }

  // 3b. Diskon member — dari potong yang tidak kena promo barang (kecuali digabung).
  const dasarMember = new Array<number>(n).fill(0);
  for (const u of potong) {
    if (anggota && (anggota.gabungPromo || !u.promo)) dasarMember[u.baris] += u.hargaSen - u.potonganSen;
  }
  const persenMember = anggota ? Math.min(100, Math.max(0, Number.isFinite(anggota.diskonPersen) ? anggota.diskonPersen : 0)) : 0;
  const jumlahDasarMember = dasarMember.reduce((s, v) => s + v, 0);
  const memberSen = persenMember > 0 ? Math.min(jumlahDasarMember, rupiahUtuh((jumlahDasarMember * persenMember) / 100)) : 0;
  const bagianMember = bagiSisaTerbesar(memberSen, dasarMember);
  const bersihSen = kotorSen.map((k, i) => k - promoSen[i] - bagianMember[i]);

  // 4. Satu promo belanja — potongan terbesar.
  let promoNotaTerpilih: { promo: PromoKonter; sen: number; ikut: boolean[] } | null = null;
  for (const p of berlaku.filter((x) => promoNota(x.type)).sort((a, b) => b.priority - a.priority || urutId(a, b))) {
    const ikut = input.baris.map((b) => barangIkut(p, b.itemId, b.categoryId));
    const dasar = bersihSen.reduce((s, v, i) => s + (ikut[i] ? v : 0), 0);
    if (dasar <= 0 || dasar < keSen(p.minSubtotal ?? 0)) continue;
    const v = p.value ?? 0;
    if (v <= 0) continue;
    const sen =
      p.type === "MIN_BELANJA_PERSEN" ? Math.min(dasar, rupiahUtuh((dasar * Math.min(v, 100)) / 100)) : Math.min(dasar, keSen(v));
    if (!promoNotaTerpilih || sen > promoNotaTerpilih.sen) promoNotaTerpilih = { promo: p, sen, ikut };
  }
  const bagianNota = promoNotaTerpilih
    ? bagiSisaTerbesar(
        promoNotaTerpilih.sen,
        bersihSen.map((v, i) => (promoNotaTerpilih!.ikut[i] ? v : 0)),
      )
    : new Array<number>(n).fill(0);
  const sesudahNota = bersihSen.map((v, i) => v - bagianNota[i]);
  const dasarManual = sesudahNota.reduce((s, v) => s + v, 0);

  // 5. Diskon manual SPG.
  let manualSen = 0;
  const m = input.diskonManual;
  if (m && m.nilai > 0) {
    const aturan = input.aturanManual ?? { aktif: false, maksPersen: 0 };
    if (!aturan.aktif) return { ok: false, code: "DISKON_MANUAL_NONAKTIF" };
    if (!Number.isFinite(m.nilai) || (m.jenis === "PERSEN" && m.nilai > 100)) return { ok: false, code: "DISKON_MANUAL_TIDAK_VALID" };
    manualSen = m.jenis === "PERSEN" ? rupiahUtuh((dasarManual * m.nilai) / 100) : keSen(m.nilai);
    const batas = Math.floor((dasarManual * Math.max(0, aturan.maksPersen)) / 100);
    if (manualSen > batas) return { ok: false, code: "DISKON_MANUAL_LEWAT_BATAS" };
  }
  const bagianManual = bagiSisaTerbesar(manualSen, sesudahNota);

  // Bagian toko per baris: tiap sumber potongan dikali bagian tokonya sendiri.
  const persenToko = (v: number | undefined) => Math.min(100, Math.max(0, v ?? 0)) / 100;
  const tokoSen = input.baris.map((_, i) => {
    let s = 0;
    for (const { promo, sen } of promoPerBaris[i].values()) s += sen * persenToko(promo.storeSharePercent);
    s += bagianMember[i] * persenToko(anggota?.bagianTokoPersen);
    s += bagianNota[i] * persenToko(promoNotaTerpilih?.promo.storeSharePercent);
    s += bagianManual[i] * persenToko(input.aturanManual?.bagianTokoPersen);
    return Math.round(s);
  });

  // Rincian per promo per baris. Bagian toko baris dibagi ke sumbernya (sisa
  // terbesar dari bagian persisnya), supaya jumlah rincian sama dengan baris.
  const rincianBaris: RincianPromoBaris[][] = input.baris.map((b, i) => {
    const sumber: { promo: PromoKonter; kind: "BARANG" | "BELANJA"; qty: number; sen: number; toko: number }[] = [
      ...[...promoPerBaris[i].values()]
        .sort((a, c) => c.sen - a.sen || urutId(a.promo, c.promo))
        .map((x) => ({ promo: x.promo, kind: "BARANG" as const, qty: x.qty, sen: x.sen, toko: x.sen * persenToko(x.promo.storeSharePercent) })),
      ...(promoNotaTerpilih && bagianNota[i] > 0
        ? [
            {
              promo: promoNotaTerpilih.promo,
              kind: "BELANJA" as const,
              qty: Math.max(0, Math.floor(b.qty)),
              sen: bagianNota[i],
              toko: bagianNota[i] * persenToko(promoNotaTerpilih.promo.storeSharePercent),
            },
          ]
        : []),
    ];
    const lain = bagianMember[i] * persenToko(anggota?.bagianTokoPersen) + bagianManual[i] * persenToko(input.aturanManual?.bagianTokoPersen);
    const bobot = [...sumber.map((x) => x.toko), lain];
    const toko = bagiSisaTerbesar(tokoSen[i], bobot);
    return sumber.map((x, j) => ({
      promoId: x.promo.id,
      name: x.promo.name,
      kind: x.kind,
      qty: x.qty,
      potongan: keRupiah(x.sen),
      potonganToko: keRupiah(toko[j]),
    }));
  });

  const baris: HasilBarisPromo[] = input.baris.map((b, i) => {
    const urutPromo = [...promoPerBaris[i].values()].sort((a, c) => c.sen - a.sen || urutId(a.promo, c.promo));
    const potonganSen = promoSen[i] + bagianMember[i] + bagianNota[i] + bagianManual[i];
    return {
      key: b.key,
      kotor: keRupiah(kotorSen[i]),
      potonganPromo: keRupiah(promoSen[i]),
      potongan: keRupiah(potonganSen),
      bersih: keRupiah(kotorSen[i] - potonganSen),
      potonganToko: keRupiah(tokoSen[i]),
      promoId: urutPromo[0]?.promo.id ?? null,
      promoName: urutPromo.length ? urutPromo.map((x) => x.promo.name).join(" + ") : null,
      gratis: gratisQty[i],
      potonganMember: keRupiah(bagianMember[i]),
      potonganManual: keRupiah(bagianManual[i]),
      rincian: rincianBaris[i],
    };
  });

  const subtotalSen = kotorSen.reduce((s, v) => s + v, 0);
  const potonganBarisSen = promoSen.reduce((s, v) => s + v, 0);
  const notaSen = promoNotaTerpilih?.sen ?? 0;
  const potonganTotalSen = potonganBarisSen + memberSen + notaSen + manualSen;
  return {
    ok: true,
    baris,
    subtotal: keRupiah(subtotalSen),
    potonganBaris: keRupiah(potonganBarisSen),
    promoNota: promoNotaTerpilih
      ? { id: promoNotaTerpilih.promo.id, name: promoNotaTerpilih.promo.name, potongan: keRupiah(notaSen) }
      : null,
    member: anggota ? { tingkat: anggota.tingkat, potongan: keRupiah(memberSen) } : null,
    diskonManual: keRupiah(manualSen),
    potonganTotal: keRupiah(potonganTotalSen),
    potonganToko: keRupiah(tokoSen.reduce((s, v) => s + v, 0)),
    total: keRupiah(subtotalSen - potonganTotalSen),
    berlaku: tersedia.map((p) => ({ id: p.id, name: p.name, type: p.type, memberOnly: p.memberOnly === true })),
  };
}

const rp = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

/** Satu kalimat yang menjelaskan promo — dipakai kantor, spanduk HP, dan nota. Selalu bahasa Indonesia. */
export function ringkasPromoKonter(p: Pick<PromoKonter, "type" | "value" | "buyQty" | "freeQty" | "minSubtotal"> & { komponen?: readonly KomponenPaket[] }): string {
  const v = p.value ?? 0;
  switch (p.type) {
    case "PERSEN":
      return `Diskon ${v}%`;
    case "POTONGAN":
      return `Potongan ${rp(v)} per potong`;
    case "HARGA_KHUSUS":
      return `Harga khusus ${rp(v)}`;
    case "BELI_GRATIS":
      return `Beli ${p.buyQty ?? 0} gratis ${p.freeQty ?? 0}`;
    case "MIN_BELANJA_PERSEN":
      return `Belanja min. ${rp(p.minSubtotal ?? 0)} diskon ${v}%`;
    case "MIN_BELANJA_POTONGAN":
      return `Belanja min. ${rp(p.minSubtotal ?? 0)} potongan ${rp(v)}`;
    case "PAKET": {
      const isi = (p.komponen ?? []).reduce((s, k) => s + (Number.isFinite(k.qty) ? k.qty : 0), 0);
      return `Paket ${isi} potong ${rp(v)}`;
    }
  }
}

export type MasalahPromoKonter =
  | "NAMA_WAJIB"
  | "JENIS_TIDAK_DIKENAL"
  | "NILAI_TIDAK_VALID"
  | "PERSEN_LEWAT_100"
  | "BELI_GRATIS_TIDAK_VALID"
  | "MIN_BELANJA_TIDAK_VALID"
  | "TANGGAL_TERBALIK"
  | "BARANG_KOSONG"
  | "TOKO_KOSONG"
  | "PAKET_TIDAK_VALID";

/** Batas isi promo paket. */
export const PAKET_MAKS_KOMPONEN = 10;
export const PAKET_MAKS_QTY_KOMPONEN = 20;
export const PAKET_MAKS_POTONG = 50;

/** Komponen paket sah: jenis dikenal, id terisi dan tidak kembar, jumlah bulat 1–20, total 2–50 potong. */
export function komponenPaketSah(komponen: readonly KomponenPaket[] | null | undefined): boolean {
  if (!Array.isArray(komponen) || komponen.length === 0 || komponen.length > PAKET_MAKS_KOMPONEN) return false;
  const kunci = new Set<string>();
  let total = 0;
  for (const k of komponen) {
    if (!k || (k.jenis !== "ITEM" && k.jenis !== "CATEGORY") || typeof k.refId !== "string" || !k.refId) return false;
    if (!Number.isInteger(k.qty) || k.qty < 1 || k.qty > PAKET_MAKS_QTY_KOMPONEN) return false;
    const id = `${k.jenis}:${k.refId}`;
    if (kunci.has(id)) return false;
    kunci.add(id);
    total += k.qty;
  }
  return total >= 2 && total <= PAKET_MAKS_POTONG;
}

/** Periksa isian promo sebelum disimpan kantor. Kosong = sah. */
export function periksaPromoKonter(p: {
  name: string;
  type: string;
  value: number | null;
  buyQty: number | null;
  freeQty: number | null;
  minSubtotal: number | null;
  allItems: boolean;
  itemIds: readonly string[];
  categoryIds: readonly string[];
  allStores: boolean;
  storeIds: readonly string[];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  komponen?: readonly KomponenPaket[] | null;
}): MasalahPromoKonter[] {
  const masalah: MasalahPromoKonter[] = [];
  if (!p.name.trim()) masalah.push("NAMA_WAJIB");
  if (!(JENIS_PROMO_KONTER as readonly string[]).includes(p.type)) {
    masalah.push("JENIS_TIDAK_DIKENAL");
    return masalah;
  }
  const type = p.type as JenisPromoKonter;
  const v = p.value;
  if (type === "BELI_GRATIS") {
    const beli = p.buyQty ?? 0;
    const gratis = p.freeQty ?? 0;
    if (!Number.isInteger(beli) || !Number.isInteger(gratis) || beli < 1 || gratis < 1 || beli + gratis > 50) {
      masalah.push("BELI_GRATIS_TIDAK_VALID");
    }
  } else {
    if (v === null || !Number.isFinite(v) || v <= 0) masalah.push("NILAI_TIDAK_VALID");
    else if ((type === "PERSEN" || type === "MIN_BELANJA_PERSEN") && v > 100) masalah.push("PERSEN_LEWAT_100");
  }
  if (promoNota(type) && (p.minSubtotal === null || !Number.isFinite(p.minSubtotal) || p.minSubtotal < 0)) {
    masalah.push("MIN_BELANJA_TIDAK_VALID");
  }
  if (p.startsAt && p.endsAt && new Date(p.startsAt).getTime() > new Date(p.endsAt).getTime()) masalah.push("TANGGAL_TERBALIK");
  if (type === "PAKET" && (p.allItems || !komponenPaketSah(p.komponen))) masalah.push("PAKET_TIDAK_VALID");
  if (!p.allItems && p.itemIds.length === 0 && p.categoryIds.length === 0) masalah.push("BARANG_KOSONG");
  if (!p.allStores && p.storeIds.length === 0) masalah.push("TOKO_KOSONG");
  return masalah;
}
