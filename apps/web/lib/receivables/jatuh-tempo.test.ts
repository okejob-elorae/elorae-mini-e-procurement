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

describe("P46 — nota sebagian ditahan yang bagian bebasnya lewat tempo", () => {
  const hariIni = new Date("2026-10-06T10:00:00+07:00");

  it("lewatTempoDiLuarTahanan: tertahan, bebas, tanpa kontrabon, lewat 30 hari", async () => {
    const { lewatTempoDiLuarTahanan } = await import("./jatuh-tempo");
    expect(
      lewatTempoDiLuarTahanan({ keadaan: "tertahan", bebas: 400_000, adaKontrabon: false, dueDate: jt("2026-09-06"), hariIni }),
    ).toEqual({ hari: 30, nilai: 400_000 });
  });

  it("lewatTempoDiLuarTahanan: kontrabon, jatuh tempo hari ini, bebas nol, atau keadaan lain → null", async () => {
    const { lewatTempoDiLuarTahanan } = await import("./jatuh-tempo");
    const dasar = { keadaan: "tertahan" as const, bebas: 400_000, adaKontrabon: false, dueDate: jt("2026-09-06"), hariIni };
    expect(lewatTempoDiLuarTahanan({ ...dasar, adaKontrabon: true })).toBeNull();
    expect(lewatTempoDiLuarTahanan({ ...dasar, dueDate: jt("2026-10-06") })).toBeNull();
    expect(lewatTempoDiLuarTahanan({ ...dasar, bebas: 0 })).toBeNull();
    expect(lewatTempoDiLuarTahanan({ ...dasar, keadaan: "belum" })).toBeNull();
  });

  it("kalimatTertahan memisahkan yang menunggu, yang tetap, dan yang lewat tempo", async () => {
    const { kalimatTertahan } = await import("./jatuh-tempo");
    expect(kalimatTertahan({ nilaiTertahan: 300_000, ditahanRetur: 300_000, sebabDitahan: "BELUM_DIHITUNG" })).toEqual({
      tunggu: { nilai: 300_000, sebab: "BELUM_DIHITUNG" },
      tetap: null,
      lewatTempo: null,
    });
    expect(kalimatTertahan({ nilaiTertahan: 500_000, ditahanRetur: 300_000, sebabDitahan: "MENUNGGU_BEBAN" })).toEqual({
      tunggu: { nilai: 300_000, sebab: "MENUNGGU_BEBAN" },
      tetap: 200_000,
      lewatTempo: null,
    });
    expect(kalimatTertahan({ nilaiTertahan: 300_000, lewatTempoDiLuarTahanan: { hari: 45, nilai: 300_000 } })).toEqual({
      tunggu: null,
      tetap: 300_000,
      lewatTempo: { nilai: 300_000, hari: 45 },
    });
    expect(
      kalimatTertahan({
        nilaiTertahan: 300_000,
        ditahanRetur: 300_000,
        sebabDitahan: "CAMPURAN",
        lewatTempoDiLuarTahanan: { hari: 30, nilai: 400_000 },
      }),
    ).toEqual({ tunggu: { nilai: 300_000, sebab: "CAMPURAN" }, tetap: null, lewatTempo: { nilai: 400_000, hari: 30 } });
  });

  it("masukLewatJatuhTempo / nilaiLewatJatuhTempo", async () => {
    const { masukLewatJatuhTempo, nilaiLewatJatuhTempo } = await import("./jatuh-tempo");
    const jatuh = { keadaanTampil: "jatuh_tempo" as const, outstanding: 1_000 };
    const sebagian = { keadaanTampil: "tertahan" as const, outstanding: 700, alasan: { lewatTempoDiLuarTahanan: { hari: 30, nilai: 400 } } };
    const tertahan = { keadaanTampil: "tertahan" as const, outstanding: 500, alasan: {} };
    expect(masukLewatJatuhTempo(jatuh)).toBe(true);
    expect(nilaiLewatJatuhTempo(jatuh)).toBe(1_000);
    expect(masukLewatJatuhTempo(sebagian)).toBe(true);
    expect(nilaiLewatJatuhTempo(sebagian)).toBe(400);
    expect(masukLewatJatuhTempo(tertahan)).toBe(false);
    expect(nilaiLewatJatuhTempo(tertahan)).toBeNull();
  });

  /*
   * Satu susunan untuk kantor, HP, dan dasbor (Q15/P46). Bagian "tagih lewat BKM berikutnya" dulu
   * hanya ada di HP: baris tetap yang belum lewat tempo terbaca berbeda di kantor.
   */
  it("bagianKalimatTertahan: menunggu, tetap, lalu lewat tempo — atau tagih lewat BKM bila tetap belum lewat tempo", async () => {
    const { bagianKalimatTertahan } = await import("./jatuh-tempo");
    expect(bagianKalimatTertahan({ nilaiTertahan: 300, ditahanRetur: 300, sebabDitahan: "BELUM_DIHITUNG" })).toEqual([
      { jenis: "TUNGGU", sebab: "BELUM_DIHITUNG", nilai: 300 },
    ]);
    expect(bagianKalimatTertahan({ nilaiTertahan: 500, ditahanRetur: 300, sebabDitahan: "CAMPURAN" })).toEqual([
      { jenis: "TUNGGU", sebab: "CAMPURAN", nilai: 300 },
      { jenis: "TETAP", nilai: 200 },
      { jenis: "TAGIH_BKM" },
    ]);
    expect(bagianKalimatTertahan({ nilaiTertahan: 150 })).toEqual([{ jenis: "TETAP", nilai: 150 }, { jenis: "TAGIH_BKM" }]);
    expect(
      bagianKalimatTertahan({ nilaiTertahan: 300, ditahanRetur: 300, sebabDitahan: "MENUNGGU_BEBAN", lewatTempoDiLuarTahanan: { hari: 4, nilai: 400 } }),
    ).toEqual([
      { jenis: "TUNGGU", sebab: "MENUNGGU_BEBAN", nilai: 300 },
      { jenis: "LEWAT_TEMPO", adaTunggu: true, nilai: 400, hari: 4 },
    ]);
    // Ada bagian lewat tempo: kalimat "tagih lewat BKM" tidak ikut (sama dengan HP).
    expect(bagianKalimatTertahan({ nilaiTertahan: 200, lewatTempoDiLuarTahanan: { hari: 9, nilai: 700 } })).toEqual([
      { jenis: "TETAP", nilai: 200 },
      { jenis: "LEWAT_TEMPO", adaTunggu: false, nilai: 700, hari: 9 },
    ]);
    expect(bagianKalimatTertahan({})).toEqual([{ jenis: "UMUM", nilai: 0 }]);
  });
});
