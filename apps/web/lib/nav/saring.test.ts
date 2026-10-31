import { describe, expect, it } from 'vitest';
import { grupTerbuka, saringNav, type ItemTerlabel } from './saring';

const MENU: ItemTerlabel[] = [
  { href: '/beranda', label: 'Beranda' },
  {
    href: '/keuangan',
    label: 'Buku Besar',
    anak: [
      { href: '/jurnal', label: 'Jurnal' },
      { href: '/coa', label: 'Bagan Akun' },
      { href: '/arus-kas', label: 'Klasifikasi Arus Kas' },
    ],
  },
  {
    href: '/konsi',
    label: 'Konsinyasi',
    anak: [{ href: '/konsi/siklus', label: 'Siklus' }],
  },
];

describe('saringNav', () => {
  it('mengembalikan semuanya saat kueri kosong, tanpa membuka grup apa pun', () => {
    // Membuka semua grup saat kotaknya kosong mengubah menu jadi daftar 53
    // baris — persis yang mau dihindari.
    const r = saringNav(MENU, '');
    expect(r).toHaveLength(3);
    expect(r.every((x) => !x.paksaBuka)).toBe(true);
  });

  it('menemukan anak yang terkubur di grup tertutup, dan MEMBUKANYA', () => {
    /*
     * Inilah gunanya: "Klasifikasi Arus Kas" ada di bawah Buku Besar, bukan
     * Laporan, dan tebakan itu salah separuh waktu.
     */
    const r = saringNav(MENU, 'arus kas');
    expect(r).toHaveLength(1);
    expect(r[0].item.href).toBe('/keuangan');
    expect(r[0].anak.map((a) => a.href)).toEqual(['/arus-kas']);
    expect(r[0].paksaBuka).toBe(true);
  });

  it('induk yang cocok membawa SELURUH anaknya', () => {
    // Mengetik nama bagian berarti mencari bagian itu. Mengosongkan isinya
    // karena tidak ada anak yang bernama sama adalah jawaban yang benar secara
    // teknis dan tidak berguna sama sekali.
    const r = saringNav(MENU, 'buku besar');
    expect(r[0].anak).toHaveLength(3);
  });

  it('mengabaikan huruf besar-kecil', () => {
    expect(saringNav(MENU, 'JURNAL')[0].anak[0].href).toBe('/jurnal');
    expect(saringNav(MENU, 'jurnal')[0].anak[0].href).toBe('/jurnal');
  });

  it('mengabaikan diakritik', () => {
    // Cacat yang sama dengan pencarian Pantone, tapi di sini tidak ada dialek
    // basis data yang menyelamatkan kalau lupa.
    const aksen: ItemTerlabel[] = [{ href: '/e', label: 'ELORAÉ' }];
    expect(saringNav(aksen, 'elorae')).toHaveLength(1);
    expect(saringNav(aksen, 'ELORAÉ')).toHaveLength(1);
  });

  it('menemukan item datar tanpa anak', () => {
    const r = saringNav(MENU, 'beranda');
    expect(r).toHaveLength(1);
    expect(r[0].item.href).toBe('/beranda');
  });

  it('mengembalikan kosong kalau tidak ada yang cocok', () => {
    // Kosong, bukan semuanya. Penyaring yang menyerah dan menampilkan segalanya
    // membuat orang mengira pencariannya rusak.
    expect(saringNav(MENU, 'zzz')).toEqual([]);
  });

  it('mengabaikan spasi di ujung kueri', () => {
    expect(saringNav(MENU, '  jurnal  ')).toHaveLength(1);
  });

  it('mencocokkan di tengah kata, bukan hanya awalannya', () => {
    // Orang mengingat potongan nama, bukan awalannya.
    expect(saringNav(MENU, 'kas')[0].anak[0].href).toBe('/arus-kas');
    expect(saringNav(MENU, 'siklus')[0].item.href).toBe('/konsi');
  });
});

describe("grupTerbuka", () => {
  it("saat mencari, grup yang lolos saringan terbuka — anak yang cocok terlihat tanpa klik", () => {
    const hasil = saringNav(
      [{ href: "/laporan", label: "Laporan", anak: [{ href: "/laba-rugi", label: "Laba Rugi" }] }],
      "laba",
    );
    expect(grupTerbuka("/laporan", null, true, hasil.some((h) => h.item.href === "/laporan"))).toBe(true);
  });

  it("tanpa pencarian, hanya grup pilihan yang terbuka", () => {
    expect(grupTerbuka("/laporan", null, false, true)).toBe(false);
    expect(grupTerbuka("/laporan", "/laporan", false, true)).toBe(true);
  });

  it("saat mencari, grup yang tidak lolos tetap tertutup walau tadinya dipilih", () => {
    expect(grupTerbuka("/laporan", "/laporan", true, false)).toBe(false);
  });
});
