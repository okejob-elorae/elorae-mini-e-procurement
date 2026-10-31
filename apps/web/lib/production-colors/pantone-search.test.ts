import { describe, expect, it } from 'vitest';
import { listPantoneColors } from './queries';

/**
 * Pencarian Pantone, terhadap basis data sungguhan.
 *
 * Ada karena cacatnya TIDAK BISA ditangkap tes murni: `contains` milik Prisma
 * berperilaku berbeda antar dialek. Di MariaDB ia abai huruf besar-kecil karena
 * collation bawaannya; di PostgreSQL ia peka. Kodenya ditulis untuk yang
 * pertama dan dijalankan di yang kedua, jadi mengetik "lime" menemukan NOL dari
 * 23 warna lime yang benar-benar ada.
 *
 * Type-check lolos, seluruh tes murni lolos, dan kotak pencariannya diam-diam
 * tidak berguna. Hanya kueri sungguhan yang bisa membuktikannya.
 */
describe('pencarian Pantone', () => {
  it('menemukan warna walau diketik huruf kecil semua', async () => {
    const kecil = await listPantoneColors({ search: 'lime' }, { page: 1, pageSize: 48 });
    expect(kecil.totalCount).toBeGreaterThan(0);
  });

  it('memberi hasil yang SAMA untuk huruf kecil, besar, dan campuran', async () => {
    // Inilah bentuk cacatnya: dulu hanya ejaan persis seperti di basis data
    // yang berhasil, dan tidak ada yang bisa menebak ejaan itu.
    const [kecil, besar, campur] = await Promise.all([
      listPantoneColors({ search: 'lime' }, { page: 1, pageSize: 48 }),
      listPantoneColors({ search: 'LIME' }, { page: 1, pageSize: 48 }),
      listPantoneColors({ search: 'LiMe' }, { page: 1, pageSize: 48 }),
    ]);
    expect(besar.totalCount).toBe(kecil.totalCount);
    expect(campur.totalCount).toBe(kecil.totalCount);
  });

  it('masih menemukan menurut kode TCX', async () => {
    const r = await listPantoneColors({ search: '13-0443' }, { page: 1, pageSize: 48 });
    expect(r.colors.some((c) => c.tcx === '13-0443')).toBe(true);
  });

  it('masih menemukan menurut hex, dengan atau tanpa pagar', async () => {
    const a = await listPantoneColors({ search: 'c0db3a' }, { page: 1, pageSize: 48 });
    const b = await listPantoneColors({ search: '#C0DB3A' }, { page: 1, pageSize: 48 });
    expect(a.totalCount).toBeGreaterThan(0);
    // Pagar dibuang dan hurufnya diabaikan — dua ejaan yang sama-sama wajar.
    expect(b.totalCount).toBe(a.totalCount);
  });

  it('mengembalikan kosong untuk yang benar-benar tidak ada', async () => {
    // Penjagaannya harus tetap menyaring; membuatnya abai huruf tidak boleh
    // berarti membuatnya menerima apa saja.
    const r = await listPantoneColors({ search: 'zzzqqq' }, { page: 1, pageSize: 48 });
    expect(r.totalCount).toBe(0);
  });
});
