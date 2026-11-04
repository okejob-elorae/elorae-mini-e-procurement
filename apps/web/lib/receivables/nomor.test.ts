import { describe, expect, it, vi } from 'vitest';

vi.mock('@elorae/db', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code = 'P2002';
      meta?: { target?: unknown };
      constructor(pesan: string, target?: unknown) {
        super(pesan);
        this.meta = { target };
      }
    },
  },
}));

const { Prisma } = await import('@elorae/db');
const { denganNomorUnik } = await import('./nomor');

type PembuatGalat = new (pesan: string, target?: unknown) => Error;
const P2002 = (target: unknown) =>
  new (Prisma.PrismaClientKnownRequestError as unknown as PembuatGalat)('bentrok', target);

describe('denganNomorUnik', () => {
  it('mengulang saat nomor mesin bentrok, lalu berhasil', async () => {
    // Inti perbaikannya: yang kalah balapan TIDAK kehilangan isiannya. Percobaan
    // kedua membaca nomor terakhir yang sudah berisi milik pemenang.
    let panggilan = 0;
    const hasil = await denganNomorUnik(async () => {
      panggilan++;
      if (panggilan === 1) throw P2002('PaymentClaim_docNo_key');
      return 'BKM/2026/0002';
    });
    expect(hasil).toBe('BKM/2026/0002');
    expect(panggilan).toBe(2);
  });

  it('membaca target berbentuk daftar kolom, bukan hanya nama constraint', async () => {
    // Postgres memberi nama constraint, MySQL memberi daftar kolom. Keduanya
    // harus terbaca tanpa penulisnya perlu tahu sedang di dialek mana.
    let panggilan = 0;
    await denganNomorUnik(async () => {
      panggilan++;
      if (panggilan === 1) throw P2002(['noNri']);
      return 'ok';
    });
    expect(panggilan).toBe(2);
  });

  it('TIDAK mengulang bentrok nomor yang diketik orang', async () => {
    /*
     * `noNrt` adalah nomor nota TOKO. Bentrok di sana berarti nomornya memang
     * sudah pernah dipakai toko itu; mengulang hanya gagal lagi dengan cara yang
     * sama sambil menyembunyikan sebabnya dari layar.
     */
    let panggilan = 0;
    await expect(
      denganNomorUnik(async () => {
        panggilan++;
        throw P2002('StoreReturn_storeId_noNrt_key');
      }),
    ).rejects.toThrow('bentrok');
    expect(panggilan).toBe(1);
  });

  it('meneruskan galat lain apa adanya tanpa satu pun pengulangan', async () => {
    let panggilan = 0;
    await expect(
      denganNomorUnik(async () => {
        panggilan++;
        throw new Error('koneksi putus');
      }),
    ).rejects.toThrow('koneksi putus');
    expect(panggilan).toBe(1);
  });

  it('menyerah setelah batas dan melempar bentrok terakhir', async () => {
    // Tiga kekalahan beruntun bukan lagi tabrakan kebetulan.
    let panggilan = 0;
    await expect(
      denganNomorUnik(async () => {
        panggilan++;
        throw P2002('CollectionNote_docNo_key');
      }),
    ).rejects.toThrow('bentrok');
    expect(panggilan).toBe(3);
  });
});
