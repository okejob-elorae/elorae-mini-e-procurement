import { describe, expect, it } from 'vitest';
import { bagiLencana } from './lencana';

/**
 * Pembagian lencana menu.
 *
 * Sudah salah DUA KALI, dan dua-duanya lolos type-check: sekali karena draft PO
 * ikut terhitung terlambat, sekali karena induk dan anak berbagi href sehingga
 * anak mewarisi total seluruh grupnya. Keduanya baru ketahuan karena ada yang
 * MELIHAT angkanya tidak masuk akal — bukan karena ada yang gagal.
 */

const GRUP = {
  overduePOs: '/backoffice/production/planning',
  submittedPOs: '/backoffice/production/planning',
  oversold: '/backoffice/inventory',
};

describe('bagiLencana', () => {
  it('menjumlahkan beberapa butir ke satu grup', () => {
    const { grup } = bagiLencana(
      [
        { key: 'overduePOs', href: '/backoffice/purchase-orders?status=overdue', count: 2 },
        { key: 'submittedPOs', href: '/backoffice/purchase-orders?status=SUBMITTED', count: 1 },
      ],
      GRUP,
    );
    expect(grup['/backoffice/production/planning']).toBe(3);
  });

  it('membuang query string supaya cocok dengan href di menu', () => {
    const { halaman } = bagiLencana(
      [{ key: 'overduePOs', href: '/backoffice/purchase-orders?status=overdue', count: 2 }],
      GRUP,
    );
    expect(halaman['/backoffice/purchase-orders']).toBe(2);
  });

  it('TIDAK menaruh total grup ke peta halaman', () => {
    /*
     * Inti bug kedua. Induk "Produksi" dan anak "Plan Kerja" dua-duanya
     * `/backoffice/production/planning`. Dengan satu peta, anak itu mewarisi
     * total grupnya dan memakai lencana untuk pekerjaan yang ada di halaman
     * lain — orang membuka Plan Kerja dan tidak menemukan apa pun.
     */
    const { halaman } = bagiLencana(
      [{ key: 'submittedPOs', href: '/backoffice/purchase-orders?status=SUBMITTED', count: 1 }],
      GRUP,
    );
    expect(halaman['/backoffice/production/planning']).toBeUndefined();
    expect(halaman['/backoffice/purchase-orders']).toBe(1);
  });

  it('total grup sama dengan jumlah halaman di dalamnya', () => {
    // Induk yang menyebut angka berbeda dari jumlah anaknya adalah persis
    // keluhan yang memulai ini.
    const butir = [
      { key: 'overduePOs', href: '/backoffice/purchase-orders?status=overdue', count: 2 },
      { key: 'submittedPOs', href: '/backoffice/purchase-orders?status=SUBMITTED', count: 1 },
    ];
    const { grup, halaman } = bagiLencana(butir, GRUP);
    expect(grup['/backoffice/production/planning']).toBe(
      halaman['/backoffice/purchase-orders'],
    );
  });

  it('mengabaikan butir yang tidak punya grup, tapi tetap menghitung halamannya', () => {
    // Sebuah butir bisa punya halaman tanpa induk di menu — lencananya tetap
    // harus muncul di halamannya sendiri.
    const { grup, halaman } = bagiLencana(
      [{ key: 'tanpaGrup', href: '/backoffice/entah', count: 5 }],
      GRUP,
    );
    expect(Object.keys(grup)).toHaveLength(0);
    expect(halaman['/backoffice/entah']).toBe(5);
  });
});
