import { describe, expect, it } from 'vitest';
import {
  bacaKeadaanTampil,
  hariLewatJatuhTempo,
  keadaanTampil,
  URUT_KEADAAN_TAMPIL,
} from './jatuh-tempo';

/*
 * Faktur yang lewat JATUH TEMPO tanpa kontrabon dulu berlabel "Siap
 * dikontrabon — tidak ada tunggakan". Tanda "lewat" hanya dihitung dari janji
 * bayar kontrabon, jadi tunggakan jenis ini tidak muncul di mana pun.
 *
 * Tanggal jatuh tempo disimpan tengah malam WIB (17.00 UTC hari sebelumnya).
 */
const jt = (tgl: string) => new Date(`${tgl}T00:00:00+07:00`);

describe('hariLewatJatuhTempo', () => {
  const hariIni = new Date('2026-10-06T10:00:00+07:00');

  it('menghitung hari kalender WIB sejak jatuh tempo untuk faktur tanpa kontrabon', () => {
    // INV/IMP/001 jatuh tempo 20 Sep 2026, dibaca 6 Okt 2026.
    expect(hariLewatJatuhTempo({ keadaan: 'belum', dueDate: jt('2026-09-20'), hariIni })).toBe(16);
    expect(hariLewatJatuhTempo({ keadaan: 'belum', dueDate: jt('2026-09-25'), hariIni })).toBe(11);
  });

  it('hari jatuh temponya sendiri belum lewat — baru lewat keesokan harinya', () => {
    expect(hariLewatJatuhTempo({ keadaan: 'belum', dueDate: jt('2026-10-06'), hariIni })).toBeNull();
    expect(hariLewatJatuhTempo({ keadaan: 'belum', dueDate: jt('2026-10-05'), hariIni })).toBe(1);
  });

  it('tidak bergeser karena jam: 00.30 WIB sudah hari berikutnya', () => {
    // 00.30 WIB 7 Okt = 17.30 UTC 6 Okt. Dibandingkan per instan UTC, faktur
    // yang jatuh tempo 6 Okt akan terbaca belum lewat.
    const dini = new Date('2026-10-06T17:30:00Z');
    expect(hariLewatJatuhTempo({ keadaan: 'belum', dueDate: jt('2026-10-06'), hariIni: dini })).toBe(1);
  });

  it('keadaan lain tidak pernah diberi tanda jatuh tempo', () => {
    // Kontrabon berjalan: janji bayarnya yang berlaku. Klaim menunggu: sales
    // sudah melapor. Tertahan retur: uangnya ditahan aturan, bukan ditunggak.
    for (const keadaan of ['lunas', 'klaim', 'tertahan', 'lewat', 'tt'] as const) {
      expect(hariLewatJatuhTempo({ keadaan, dueDate: jt('2026-09-20'), hariIni })).toBeNull();
    }
  });
});

describe('keadaanTampil', () => {
  it('memisahkan faktur lewat jatuh tempo dari yang belum dikontrabon', () => {
    expect(keadaanTampil({ keadaan: 'belum', hariLewatJatuhTempo: 16 })).toBe('jatuh_tempo');
    expect(keadaanTampil({ keadaan: 'belum', hariLewatJatuhTempo: null })).toBe('belum');
    expect(keadaanTampil({ keadaan: 'lewat', hariLewatJatuhTempo: null })).toBe('lewat');
  });
});

describe('bacaKeadaanTampil', () => {
  it('menerima tujuh keadaan dari alamat, menolak sisanya', () => {
    for (const k of URUT_KEADAAN_TAMPIL) expect(bacaKeadaanTampil(k)).toBe(k);
    expect(bacaKeadaanTampil('jatuh_tempo')).toBe('jatuh_tempo');
    expect(bacaKeadaanTampil('LEWAT')).toBeNull();
    expect(bacaKeadaanTampil(undefined)).toBeNull();
    expect(bacaKeadaanTampil('')).toBeNull();
  });
});
